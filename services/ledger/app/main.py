import json
import logging
import os
import re
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from decimal import Decimal

from collections import Counter

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from . import ha_push, import_tx, webpush

pool = ConnectionPool(os.environ["DATABASE_URL"], kwargs={"row_factory": dict_row}, open=False)
app = FastAPI(title="ledger")
log = logging.getLogger("ledger")

NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "")


# Page ouverte au toucher d'une notification Web Push, selon l'événement
PUSH_URL = {"solde_bas": "/alertes", "prevision": "/alertes", "anomalie": "/transactions", "plafond": "/budget",
            "paie": "/budget", "test": "/alertes"}


def push_all(title: str, message: str, url: str = "/", tag: str | None = None) -> int:
    """Web Push vers les appareils abonnés, sur une connexion dédiée (l'appelant peut être au milieu d'une transaction)."""
    if not webpush.enabled():
        return 0
    try:
        with pool.connection() as pc:
            return webpush.send_all(pc, title, message, url, tag)
    except Exception as e:  # base indisponible : la notif ntfy part quand même
        log.warning("web push: %s", e)
        return 0


def notify(title: str, message: str, priority: int = 3, tags: str = "moneybag", event: str = "alerte") -> bool:
    """Push ntfy (JSON publish), Web Push (PWA) puis, indépendamment, webhook Home Assistant (HA_EVENTS_WEBHOOK_URL).
    Sans NTFY_TOPIC ni abonnement Web Push : l'alerte reste visible dans l'appli (et part vers HA si configuré)."""
    pushed = push_all(title, message, PUSH_URL.get(event, "/"), event) > 0
    ha_url = os.environ.get("HA_EVENTS_WEBHOOK_URL", "")
    if ha_url:
        try:
            body = json.dumps({"event": event, "title": title, "message": message, "priority": priority,
                               "tags": tags.split(","), "ts": datetime.now(timezone.utc).isoformat()}).encode()
            urllib.request.urlopen(urllib.request.Request(ha_url, data=body, headers={"Content-Type": "application/json"}),
                                   timeout=5).close()
        except Exception as e:  # HA hors ligne : on journalise, la synchro continue
            log.warning("webhook HA: %s", e)
    if not NTFY_TOPIC:
        return pushed
    body = json.dumps({"topic": NTFY_TOPIC, "title": title, "message": message,
                       "priority": priority, "tags": tags.split(",")}).encode()
    req = urllib.request.Request(NTFY_URL, data=body, headers={"Content-Type": "application/json"})
    if NTFY_TOKEN:
        req.add_header("Authorization", f"Bearer {NTFY_TOKEN}")
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:  # une notif ratée ne doit jamais faire échouer la synchro
        log.warning("ntfy: %s", e)
        return pushed


def evaluate_alerts(c, account_id: int) -> list[dict]:
    """Compare le dernier solde réel aux règles applicables ; déclenche au franchissement vers le bas."""
    acc = c.execute(
        """SELECT a.id, a.name, a.institution, a.type, v.balance FROM accounts a
           JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated
                         ORDER BY day DESC LIMIT 1) v ON true WHERE a.id = %s""", (account_id,)).fetchone()
    if not acc:
        return []
    rules = c.execute(
        """SELECT r.id, r.threshold, COALESCE(s.below, false) AS was_below FROM alert_rules r
           LEFT JOIN alert_state s ON s.rule_id = r.id AND s.account_id = %s
           WHERE r.enabled AND (r.account_id = %s OR r.account_type = %s)
           ORDER BY r.threshold""", (account_id, account_id, acc["type"])).fetchall()
    fired = []
    for r in rules:
        below = acc["balance"] < r["threshold"]
        c.execute("""INSERT INTO alert_state VALUES (%s,%s,%s)
                     ON CONFLICT (rule_id, account_id) DO UPDATE SET below = EXCLUDED.below""",
                  (r["id"], account_id, below))
        if below and not r["was_below"]:
            fired.append(r)
    if fired:
        # une seule notif, pour le seuil le plus bas franchi
        worst = min(fired, key=lambda r: r["threshold"])
        ok = notify(f"Solde bas : {acc['name']}",
                    f"{acc['institution']} : {acc['balance']:.2f} € (sous {worst['threshold']:.0f} €)",
                    priority=5 if worst["threshold"] <= 0 else 4, tags="warning", event="solde_bas")
        for r in fired:
            c.execute("""INSERT INTO alert_events (rule_id, account_id, balance, threshold, notified)
                         VALUES (%s,%s,%s,%s,%s)""", (r["id"], account_id, acc["balance"], r["threshold"], ok))
    return fired


MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR", "/srv/migrations"))


def migrate():
    """Applique les migrations SQL en attente (ordre des fichiers), chacune dans sa transaction.
    Verrou consultatif : plusieurs réplicas peuvent démarrer en même temps sans conflit.
    Base existante sans suivi (créée par l'initdb docker ou restaurée d'un dump) : on marque les
    fichiers comme déjà appliqués (baseline) au lieu de les rejouer."""
    files = sorted(MIGRATIONS.glob("*.sql"))
    with pool.connection() as c:
        c.execute("SELECT pg_advisory_lock(424242)")
        try:
            tracked = c.execute("SELECT to_regclass('schema_migrations') IS NOT NULL AS t").fetchone()["t"]
            populated = c.execute("SELECT to_regclass('accounts') IS NOT NULL AS t").fetchone()["t"]
            c.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            c.commit()
            if not tracked and populated:
                for f in files:
                    c.execute("INSERT INTO schema_migrations (version) VALUES (%s) ON CONFLICT DO NOTHING", (f.name,))
                c.commit()
                log.warning("migrations : baseline de %d fichiers sur une base existante", len(files))
                return
            done = {r["version"] for r in c.execute("SELECT version FROM schema_migrations").fetchall()}
            for f in files:
                if f.name in done:
                    continue
                with c.transaction():
                    c.execute(f.read_text())
                    c.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (f.name,))
                log.warning("migration appliquée : %s", f.name)
        finally:
            c.execute("SELECT pg_advisory_unlock(424242)")
            c.commit()


@app.on_event("startup")
def _open():
    pool.open()
    if MIGRATIONS.is_dir():
        migrate()


class AccountIn(BaseModel):
    external_id: str
    source: str = "enablebanking"
    institution: str | None = None
    name: str
    type: str
    currency: str = "EUR"
    balance: Decimal
    day: date


class TransactionIn(BaseModel):
    external_id: str
    booked_on: date
    amount: Decimal
    label: str | None = None


def evaluate_caps(c) -> int:
    """Plafonds par catégorie (foyer, cycle en cours) : notifie une fois au seuil d'alerte, une fois au dépassement."""
    sent = 0
    cycle = c.execute("SELECT budget_cycle(current_date) AS c").fetchone()["c"]
    for k in c.execute("SELECT * FROM caps_status(NULL)").fetchall():
        level = 100 if k["pct"] >= 100 else (k["alert_pct"] if k["pct"] >= k["alert_pct"] else 0)
        prev = c.execute("SELECT level FROM cap_alert_state WHERE category = %s AND cycle = %s",
                         (k["category"], cycle)).fetchone()
        if level > (prev["level"] if prev else 0):
            over = level == 100
            notify(f"{'Plafond dépassé' if over else 'Plafond bientôt atteint'} : {k['label']}",
                   f"{k['spent']:.0f} € dépensés sur {k['monthly']:.0f} € ce cycle ({k['pct']:.0f} %). "
                   f"Projection fin de cycle : {k['projected']:.0f} €.",
                   priority=4 if over else 3, tags="chart_with_upwards_trend", event="plafond")
            sent += 1
        c.execute("""INSERT INTO cap_alert_state VALUES (%s,%s,%s)
                     ON CONFLICT (category, cycle) DO UPDATE SET level = GREATEST(cap_alert_state.level, EXCLUDED.level)""",
                  (k["category"], cycle, level))
    return sent


def evaluate_anomalies(c, since) -> int:
    """Dépenses nettement au-dessus des habitudes (marchand ou catégorie) parmi les opérations tout juste importées."""
    rows = c.execute(
        """INSERT INTO anomalies (tx_id, reason, reference)
           SELECT tx_id, reason, reference FROM detect_anomalies(%s) ON CONFLICT DO NOTHING
           RETURNING tx_id, reason, reference""", (since,)).fetchall()
    for r in rows:
        t = c.execute("SELECT merchant, amount, booked_on FROM transactions WHERE id = %s", (r["tx_id"],)).fetchone()
        ref = "d'habitude ~{:.0f} € chez ce marchand".format(r["reference"]) if r["reason"] == "marchand" \
            else "au-delà de 2× tes plus grosses dépenses de la catégorie ({:.0f} €)".format(r["reference"])
        ok = notify(f"Dépense inhabituelle : {t['merchant']}", f"{-t['amount']:.2f} € le {t['booked_on']:%d/%m} — {ref}.",
                    priority=3, tags="mag", event="anomalie")
        c.execute("UPDATE anomalies SET notified = %s WHERE tx_id = %s", (ok, r["tx_id"]))
    return len(rows)


def evaluate_forecast(c) -> int:
    """Alerte anticipée : si le solde prévu à la paie passe sous le plus haut seuil d'alerte (> 0), une fois par cycle."""
    sent = 0
    cycle = c.execute("SELECT budget_cycle(current_date) AS c").fetchone()["c"]
    for f in c.execute("SELECT * FROM balance_forecast(NULL)").fetchall():
        if f["days_left"] <= 0:
            continue
        thr = c.execute(
            """SELECT max(threshold) AS t FROM alert_rules WHERE enabled AND threshold > 0
               AND (account_id = %s OR account_type = 'courant')""", (f["account_id"],)).fetchone()["t"]
        if thr is None or f["projected"] >= thr:
            continue
        if c.execute("INSERT INTO forecast_alert_state VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING 1",
                     (f["account_id"], cycle)).fetchone():
            notify(f"Prévision : {f['name']} sous {thr:.0f} € avant la paie",
                   f"Solde {f['balance']:.0f} € aujourd'hui, prélèvements attendus {f['upcoming']:.0f} €, "
                   f"rythme habituel {f['daily_rate']:.0f} €/jour sur {f['days_left']} j : environ {f['projected']:.0f} € le {f['ends']:%d/%m}.",
                   priority=4, tags="crystal_ball", event="prevision")
            sent += 1
    return sent


@app.get("/health")
def health():
    with pool.connection() as c:
        c.execute("SELECT 1")
    return {"status": "ok"}


@app.put("/accounts/sync")
def upsert_account(a: AccountIn):
    """Upsert compte + valorisation du jour. Idempotent."""
    with pool.connection() as c:
        acc_id = c.execute(
            """INSERT INTO accounts (external_id, source, institution, name, type, currency, last_sync_at)
               VALUES (%s,%s,%s,%s,%s,%s,now())
               ON CONFLICT (external_id) DO UPDATE SET
                 name = CASE WHEN accounts.name_locked THEN accounts.name ELSE EXCLUDED.name END,
                 institution=EXCLUDED.institution, currency=EXCLUDED.currency,
                 -- un compte saisi à la main est déclaré par l'utilisateur : son type peut être corrigé (jamais celui d'un compte bancaire)
                 type = CASE WHEN accounts.source = 'manuel' THEN EXCLUDED.type::account_type ELSE accounts.type END,
                 last_sync_at=now()
               RETURNING id""",
            (a.external_id, a.source, a.institution, a.name, a.type, a.currency),
        ).fetchone()["id"]
        c.execute(
            """INSERT INTO valuations (account_id, day, balance) VALUES (%s,%s,%s)
               ON CONFLICT (account_id, day) DO UPDATE SET balance=EXCLUDED.balance""",
            (acc_id, a.day, a.balance),
        )
        fired = evaluate_alerts(c, acc_id)
    return {"id": acc_id, "alerts": len(fired)}


def insert_transactions(c, acc_id: int, rows: list[tuple[str, date, Decimal, str | None]]) -> dict:
    """Insère (external_id, jour, montant, libellé) sans doublon, puis valorisations, catégories et alertes."""
    since = c.execute("SELECT now() AS t").fetchone()["t"]
    with c.cursor() as cur:
        cur.executemany(
            """INSERT INTO transactions (account_id, external_id, booked_on, amount, label)
               VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
            [(acc_id, *r) for r in rows],
        )
    backfilled = c.execute("SELECT backfill_valuations(%s) AS n", (acc_id,)).fetchone()["n"]
    categorized = c.execute("SELECT categorize(FALSE) AS n").fetchone()["n"]
    for t in c.execute(  # paie reçue : opérations insérées par cet appel et datées des 7 derniers jours (jamais l'historique importé)
            """SELECT t.amount, COALESCE((SELECT p.name FROM account_holders h JOIN persons p ON p.id = h.person_id
                          WHERE h.account_id = t.account_id ORDER BY h.person_id LIMIT 1), '') AS who
               FROM transactions t WHERE t.account_id = %s AND t.inserted_at >= %s AND t.category = 'salaire'
                 AND t.amount > 0 AND t.booked_on >= current_date - 7""", (acc_id, since)).fetchall():
        notify("Paie reçue", f"Paie reçue : {t['who']} {t['amount']:.2f} €".replace("  ", " "),
               priority=3, tags="moneybag", event="paie")
    caps = evaluate_caps(c)
    unusual = evaluate_anomalies(c, since)
    forecast = evaluate_forecast(c)
    return {"received": len(rows), "backfilled": backfilled, "categorized": categorized,
            "cap_alerts": caps, "anomalies": unusual, "forecast_alerts": forecast}


@app.post("/accounts/{external_id}/transactions")
def add_transactions(external_id: str, txs: list[TransactionIn]):
    with pool.connection() as c:
        acc_id = c.execute("SELECT id FROM accounts WHERE external_id=%s", (external_id,)).fetchone()["id"]
        res = insert_transactions(c, acc_id, [(t.external_id, t.booked_on, t.amount, t.label) for t in txs])
    ha_push.trigger_async()  # après le commit : HA se met à jour sans attendre le CronJob (non bloquant, 1 / 2 min)
    return res


@app.get("/integrations/ha")
def integration_ha():
    """Lien vers le tableau de bord HA (HA_DASHBOARD_URL) et fraîcheur du dernier push réussi."""
    with pool.connection() as c:
        row = c.execute("SELECT last_ok, detail FROM integrations WHERE kind = 'ha'").fetchone()
    last = row["last_ok"] if row else None
    return {"url": os.environ.get("HA_DASHBOARD_URL") or None,
            "configured": bool(os.environ.get("HA_WEBHOOK_URL")),
            "last_push": last,
            "ok": bool(last and (datetime.now(timezone.utc) - last).total_seconds() <= 3600)}


def _import(account_id: int, raw: bytes, filename: str | None, mode: str, dry_run: bool) -> dict:
    try:
        lu = import_tx.parse(raw, filename)
    except import_tx.ImportErreur as e:
        raise HTTPException(422, str(e))
    lignes = lu.lignes
    jours = [l.booked_on for l in lignes]
    with pool.connection() as c:
        acc = c.execute("SELECT id, name, source FROM accounts WHERE id = %s", (account_id,)).fetchone()
        if not acc:
            raise HTTPException(404, "Compte introuvable")
        if acc["source"] == "manuel":
            raise HTTPException(422, "Compte saisi à la main : pas d'opérations à importer")
        premiere = c.execute("SELECT min(booked_on) AS d FROM transactions WHERE account_id = %s", (account_id,)).fetchone()["d"]
        existantes = Counter()
        if mode == "all":
            for r in c.execute("""SELECT booked_on, amount, label FROM transactions
                                  WHERE account_id = %s AND booked_on BETWEEN %s AND %s""",
                               (account_id, min(jours), max(jours))).fetchall():
                existantes[(r["booked_on"], r["amount"], import_tx.norm(r["label"] or ""))] += 1
        try:
            nouvelles, ignorees = import_tx.planifier(lignes, mode, premiere, existantes)
        except import_tx.ImportErreur as e:
            raise HTTPException(422, str(e))
        warnings = list(lu.warnings[:10])
        if len(lu.warnings) > 10:
            warnings.append(f"… et {len(lu.warnings) - 10} autres lignes ignorées")
        if mode == "extend" and ignorees.get("deja_couvert"):
            warnings.append("Le fichier recouvre la période déjà connue : seules les opérations plus anciennes sont importées "
                            "(les libellés d'un export et de l'API bancaire peuvent différer, d'où cette règle).")
        if not nouvelles:
            warnings.append("Rien de nouveau à importer.")
        exemples = sorted(nouvelles or [(None, l) for l in lignes], key=lambda x: x[1].booked_on)
        if len(exemples) > 8:
            exemples = exemples[:4] + exemples[-4:]
        out = {
            "format": lu.format, "mode": mode, "dry_run": dry_run, "account": acc["name"],
            "read": len(lignes), "new": len(nouvelles), "skipped": sum(ignorees.values()),
            "skipped_reasons": [{"code": k, "label": import_tx.MOTIFS[k], "n": n} for k, n in ignorees.items()],
            "period": {"from": min(jours), "to": max(jours)},
            "first_known": premiere,
            "examples": [{"booked_on": l.booked_on, "amount": l.amount, "label": l.label, "new": i is not None}
                         for i, l in exemples],
            "warnings": warnings,
        }
        if not dry_run and nouvelles:
            avant = c.execute("SELECT count(*) AS n FROM transactions WHERE account_id = %s", (account_id,)).fetchone()["n"]
            res = insert_transactions(c, account_id, [(i, l.booked_on, l.amount, l.label or None) for i, l in nouvelles])
            apres = c.execute("SELECT count(*) AS n FROM transactions WHERE account_id = %s", (account_id,)).fetchone()["n"]
            res["inserted"] = apres - avant
            out["result"] = res
        return out


@app.post("/accounts/{account_id}/import")
async def import_history(account_id: int, request: Request, mode: str = "extend", dry_run: int = 1, filename: str | None = None):
    """Import d'un export CSV/OFX (octets bruts en corps). dry_run=1 (défaut) : analyse sans rien écrire ; dry_run=0 pour importer."""
    if mode not in ("extend", "all"):
        raise HTTPException(422, "Mode inconnu (extend ou all)")
    raw = await request.body()
    if len(raw) > import_tx.MAX_BYTES:
        raise HTTPException(413, "Fichier trop volumineux (8 Mo maximum)")
    return await run_in_threadpool(_import, account_id, raw, filename, mode, bool(dry_run))


@app.get("/accounts")
def list_accounts():
    with pool.connection() as c:
        return c.execute(
            """SELECT a.*, v.balance, v.day,
                      COALESCE((SELECT json_agg(json_build_object('person_id', p.id, 'name', p.name, 'share', h.share)
                                                ORDER BY p.id)
                                FROM account_holders h JOIN persons p ON p.id = h.person_id
                                WHERE h.account_id = a.id), '[]') AS holders
               FROM accounts a
               LEFT JOIN LATERAL (SELECT balance, day FROM valuations
                                  WHERE account_id=a.id AND NOT estimated ORDER BY day DESC LIMIT 1) v ON true
               ORDER BY a.type, a.name"""
        ).fetchall()


@app.get("/networth")
def networth():
    with pool.connection() as c:
        return c.execute("SELECT * FROM networth_daily ORDER BY day DESC LIMIT 1").fetchone() or {}


@app.get("/stale")
def stale():
    with pool.connection() as c:
        return c.execute("SELECT * FROM stale_accounts").fetchall()


# --- Lecture pour l'UI : tous les agrégats sont calculés en SQL ---

def weights(person: int | None) -> tuple[str, list]:
    """Périmètre : None = tous les comptes, -1 = foyer (compte commun seul), id = comptes personnels de la personne.
    Même définition que la fonction SQL account_weights (migration 025)."""
    return "SELECT account_id, w FROM account_weights(%s)", [person]


@app.get("/persons")
def list_persons():
    with pool.connection() as c:
        return c.execute(
            """SELECT p.id, p.name, p.email, count(h.account_id) AS accounts
               FROM persons p LEFT JOIN account_holders h ON h.person_id = p.id
               GROUP BY p.id ORDER BY p.id"""
        ).fetchall()


class PersonIn(BaseModel):
    name: str
    email: str | None = None


@app.put("/persons/{person_id}")
def update_person(person_id: int, p: PersonIn):
    with pool.connection() as c:
        c.execute("UPDATE persons SET name = %s, email = NULLIF(%s, '') WHERE id = %s", (p.name, p.email, person_id))
    return {"ok": True}


class HoldersIn(BaseModel):
    holders: dict[int, Decimal]   # person_id -> quote-part


@app.put("/accounts/{account_id}/holders")
def set_holders(account_id: int, body: HoldersIn):
    if body.holders and sum(body.holders.values()) != 1:
        raise HTTPException(422, "La somme des quotes-parts doit valoir 1")
    with pool.connection() as c:
        c.execute("DELETE FROM account_holders WHERE account_id = %s", (account_id,))
        for pid, share in body.holders.items():
            c.execute("INSERT INTO account_holders VALUES (%s,%s,%s)", (account_id, pid, share))
    return {"ok": True}


@app.get("/summary")
def summary(person: int | None = None):
    w, args = weights(person)
    with pool.connection() as c:
        return c.execute(
            f"""WITH w AS ({w}),
                 last AS (SELECT max(day) AS day FROM valuations)
               SELECT
                 (SELECT sum(v.balance * w.w) FROM valuations v JOIN w USING (account_id), last
                   WHERE v.day = last.day) AS networth,
                 (SELECT day FROM last) AS as_of,
                 (SELECT count(*) FROM w) AS accounts,
                 (SELECT count(*) FROM stale_accounts s JOIN w ON w.account_id = s.id) AS stale,
                 COALESCE(sum(t.amount * w.w) FILTER (WHERE t.amount > 0), 0) AS income_30d,
                 COALESCE(-sum(t.amount * w.w) FILTER (WHERE t.amount < 0), 0) AS expense_30d,
                 COALESCE(sum(t.amount * w.w), 0) AS net_30d
               FROM transactions t JOIN w USING (account_id)
               WHERE t.booked_on > current_date - 30""",
            args,
        ).fetchone()


@app.get("/networth/history")
def networth_history(days: int = 365, person: int | None = None):
    """Patrimoine quotidien sur le périmètre actuel. Chaque compte porte son dernier solde connu (un compte saisi
    à la main n'est valorisé qu'à l'occasion) ; avant sa première valorisation, il est rétro-calculé à ce premier
    solde (marqué « estimé »), pour qu'un compte ajouté ne crée ni saut ni fausse hausse. Ventilation par classe :
    comptes courants / livrets / placements (assurance-vie, PEA, PER, CTO, autre), pour des graphes lisibles."""
    w, args = weights(person)
    with pool.connection() as c:
        return c.execute(
            f"""WITH w AS ({w}),
                 days AS (SELECT d::date AS day FROM generate_series(current_date - (%s::int - 1), current_date, interval '1 day') d),
                 bal AS (
                   SELECT d.day, a.type, w.w,
                          COALESCE(
                            (SELECT v.balance FROM valuations v WHERE v.account_id = a.id AND v.day <= d.day ORDER BY v.day DESC LIMIT 1),
                            (SELECT v.balance FROM valuations v WHERE v.account_id = a.id ORDER BY v.day LIMIT 1)) AS balance,
                          NOT EXISTS (SELECT 1 FROM valuations v WHERE v.account_id = a.id AND v.day <= d.day) AS backcast,
                          COALESCE((SELECT v.estimated FROM valuations v WHERE v.account_id = a.id AND v.day <= d.day
                                    ORDER BY v.day DESC LIMIT 1), false) AS est
                   FROM days d CROSS JOIN w JOIN accounts a ON a.id = w.account_id)
               SELECT day,
                      round(sum(balance * w), 2) AS total,
                      round(COALESCE(sum(balance * w) FILTER (WHERE type = 'courant'), 0), 2) AS courant,
                      round(COALESCE(sum(balance * w) FILTER (WHERE type = 'livret'), 0), 2) AS livret,
                      round(COALESCE(sum(balance * w) FILTER (WHERE type NOT IN ('courant', 'livret')), 0), 2) AS placements,
                      bool_or(est OR backcast) AS estimated,
                      count(*) FILTER (WHERE NOT backcast) AS known
               FROM bal WHERE balance IS NOT NULL GROUP BY day ORDER BY day""",
            [*args, days],
        ).fetchall()


@app.get("/networth/accounts")
def networth_accounts(days: int = 365, step: int = 7, person: int | None = None):
    """Solde de chaque compte, un point tous les `step` jours (dernier solde connu ; avant la première valorisation,
    premier solde connu, marqué estimé). Sert aux graphes par compte et par classe du rapport mensuel."""
    w, args = weights(person)
    with pool.connection() as c:
        return c.execute(
            f"""WITH w AS ({w}),
                 days AS (SELECT (current_date - o)::date AS day FROM generate_series(0, %s::int - 1, %s::int) o)
               SELECT d.day, a.id AS account_id, a.name, a.institution, a.type,
                      round(COALESCE(
                        (SELECT v.balance FROM valuations v WHERE v.account_id = a.id AND v.day <= d.day ORDER BY v.day DESC LIMIT 1),
                        (SELECT v.balance FROM valuations v WHERE v.account_id = a.id ORDER BY v.day LIMIT 1)) * w.w, 2) AS balance,
                      NOT EXISTS (SELECT 1 FROM valuations v WHERE v.account_id = a.id AND v.day <= d.day) AS estimated
               FROM days d CROSS JOIN w JOIN accounts a ON a.id = w.account_id
               ORDER BY d.day, a.id""",
            [*args, days, max(step, 1)],
        ).fetchall()


# --- Rapports mensuels (classeur Excel) ---

@app.put("/reports/{month}")
async def put_report(month: str, request: Request, filename: str = "situation.xlsx"):
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(422, "mois attendu au format AAAA-MM")
    body = await request.body()
    if not body.startswith(b"PK"):          # un .xlsx est une archive zip
        raise HTTPException(422, "classeur Excel attendu")
    if len(body) > 15_000_000:
        raise HTTPException(413, "classeur trop volumineux")
    with pool.connection() as c:
        c.execute(
            """INSERT INTO monthly_reports (month, filename, content, created_at) VALUES (%s,%s,%s,now())
               ON CONFLICT (month) DO UPDATE SET filename = EXCLUDED.filename, content = EXCLUDED.content, created_at = now()""",
            (month, filename, body))
    return {"month": month, "size": len(body)}


@app.get("/reports")
def list_reports():
    with pool.connection() as c:
        return c.execute("SELECT month, filename, size_bytes, created_at FROM monthly_reports ORDER BY month DESC").fetchall()


@app.get("/reports/{month}/download")
def download_report(month: str):
    with pool.connection() as c:
        r = c.execute("SELECT filename, content FROM monthly_reports WHERE month = %s", (month,)).fetchone()
    if not r:
        raise HTTPException(404, "aucun rapport pour ce mois")
    return Response(bytes(r["content"]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{r["filename"]}"'})


@app.get("/cashflow/monthly")
def cashflow_monthly(months: int = 12, person: int | None = None):
    w, args = weights(person)
    with pool.connection() as c:
        return c.execute(
            f"""WITH w AS ({w})
               SELECT to_char(date_trunc('month', t.booked_on), 'YYYY-MM') AS month,
                      COALESCE(sum(t.amount * w.w) FILTER (WHERE t.amount > 0), 0) AS income,
                      COALESCE(-sum(t.amount * w.w) FILTER (WHERE t.amount < 0), 0) AS expense,
                      sum(t.amount * w.w) AS net
               FROM transactions t JOIN w USING (account_id)
               WHERE t.booked_on >= date_trunc('month', current_date) - make_interval(months => %s - 1)
               GROUP BY 1 ORDER BY 1""",
            [*args, months],
        ).fetchall()


@app.get("/transactions")
def list_transactions(q: str | None = None, account_id: int | None = None, person: int | None = None,
                      direction: str | None = None, category: str | None = None,
                      limit: int = 50, offset: int = 0):
    where, args = ["TRUE"], []
    if person:
        where.append("t.account_id IN (SELECT account_id FROM account_weights(%s))")
        args.append(person)
    if q:
        where.append("t.label ILIKE %s"); args.append(f"%{q}%")
    if account_id:
        where.append("t.account_id = %s"); args.append(account_id)
    if category:
        where.append("t.category = %s"); args.append(category)
    if direction == "in":
        where.append("t.amount > 0")
    elif direction == "out":
        where.append("t.amount < 0")
    sql_where = " AND ".join(where)
    with pool.connection() as c:
        total = c.execute(f"SELECT count(*) AS n FROM transactions t WHERE {sql_where}", args).fetchone()["n"]
        rows = c.execute(
            f"""SELECT t.id, t.booked_on, t.label, t.merchant, t.amount, t.category, t.category_source,
                       c.label AS category_label, c.kind, a.name AS account, a.institution
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                LEFT JOIN categories c ON c.code = t.category
                WHERE {sql_where} ORDER BY t.booked_on DESC, t.id DESC LIMIT %s OFFSET %s""",
            [*args, min(limit, 500), offset],
        ).fetchall()
    return {"total": total, "items": rows}


@app.get("/networth/breakdown")
def networth_breakdown(person: int | None = None):
    """Répartition du patrimoine par compte (dernier solde réel, pondéré par la quote-part)."""
    with pool.connection() as c:
        return c.execute(
            """SELECT a.id, a.name, a.institution, a.type, round(v.balance * w.w, 2) AS value,
                      COALESCE((SELECT string_agg(p.name, ' / ' ORDER BY p.id) FROM account_holders h
                                JOIN persons p ON p.id = h.person_id WHERE h.account_id = a.id), '') AS holders
               FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id
               JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated
                             ORDER BY day DESC LIMIT 1) v ON true
               ORDER BY value DESC""",
            (person,),
        ).fetchall()


# --- Alertes ---

class AlertRuleIn(BaseModel):
    threshold: Decimal
    account_id: int | None = None
    account_type: str | None = None


@app.get("/alerts/rules")
def alert_rules():
    with pool.connection() as c:
        return c.execute(
            """SELECT r.*, a.name AS account_name FROM alert_rules r
               LEFT JOIN accounts a ON a.id = r.account_id ORDER BY r.threshold DESC"""
        ).fetchall()


@app.post("/alerts/rules")
def add_alert_rule(r: AlertRuleIn):
    if (r.account_id is None) == (r.account_type is None):
        raise HTTPException(422, "Préciser un compte OU un type de compte")
    with pool.connection() as c:
        row = c.execute(
            "INSERT INTO alert_rules (account_id, account_type, threshold) VALUES (%s,%s,%s) RETURNING *",
            (r.account_id, r.account_type, r.threshold)).fetchone()
        # état initial : pas d'alerte rétroactive pour un solde déjà sous le seuil
        c.execute(
            """INSERT INTO alert_state (rule_id, account_id, below)
               SELECT %s, a.id, v.balance < %s FROM accounts a
               JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated
                             ORDER BY day DESC LIMIT 1) v ON true
               WHERE a.id = %s OR a.type::text = %s""",
            (row["id"], r.threshold, r.account_id, r.account_type))
    return row


@app.patch("/alerts/rules/{rule_id}")
def toggle_alert_rule(rule_id: int, enabled: bool):
    with pool.connection() as c:
        c.execute("UPDATE alert_rules SET enabled = %s WHERE id = %s", (enabled, rule_id))
    return {"ok": True}


@app.delete("/alerts/rules/{rule_id}")
def delete_alert_rule(rule_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM alert_rules WHERE id = %s", (rule_id,))
    return {"ok": True}


@app.get("/alerts/events")
def alert_events(limit: int = 50):
    with pool.connection() as c:
        unread = c.execute("SELECT count(*) AS n FROM alert_events WHERE read_at IS NULL").fetchone()["n"]
        items = c.execute(
            """SELECT e.*, a.name AS account_name, a.institution FROM alert_events e
               JOIN accounts a ON a.id = e.account_id ORDER BY e.fired_at DESC LIMIT %s""", (limit,)).fetchall()
    return {"unread": unread, "items": items}


@app.post("/alerts/events/read")
def mark_alerts_read():
    with pool.connection() as c:
        c.execute("UPDATE alert_events SET read_at = now() WHERE read_at IS NULL")
    return {"ok": True}


@app.get("/alerts/channel")
def alert_channel():
    with pool.connection() as c:
        n = c.execute("SELECT count(*) AS n FROM push_subscriptions").fetchone()["n"]
    return {"ntfy": bool(NTFY_TOPIC), "server": NTFY_URL if NTFY_TOPIC else None, "webpush": webpush.enabled(), "devices": n}


@app.post("/alerts/test")
def alert_test():
    ok = notify("Patrimoine : test", "Les notifications fonctionnent.", priority=3, tags="white_check_mark", event="test")
    if not ok:
        raise HTTPException(503, "Notification non envoyée (ni ntfy ni appareil abonné joignable)")
    return {"ok": True}


# --- Web Push (PWA) ----------------------------------------------------------------------------------------
class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys


class PushMessage(BaseModel):
    title: str
    body: str
    url: str = "/"
    tag: str | None = None


@app.get("/push/key")
def push_key():
    return {"enabled": webpush.enabled(), "public_key": webpush.public_key()}


@app.post("/push/subscribe")
def push_subscribe(sub: PushSubscriptionIn, request: Request):
    if not webpush.enabled():
        raise HTTPException(503, "Web Push non configuré (VAPID_PRIVATE_KEY absente)")
    if not sub.endpoint.startswith("https://") or len(sub.endpoint) > 1000:
        raise HTTPException(422, "endpoint invalide")
    with pool.connection() as c:
        row = c.execute(
            """INSERT INTO push_subscriptions (endpoint, p256dh, auth, device) VALUES (%s,%s,%s,%s)
               ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0
               RETURNING id""",
            (sub.endpoint, sub.keys.p256dh, sub.keys.auth, webpush.device_label(request.headers.get("user-agent", "")))).fetchone()
    return {"id": row["id"]}


@app.post("/push/unsubscribe")
def push_unsubscribe(sub: PushSubscriptionIn):
    with pool.connection() as c:
        n = c.execute("DELETE FROM push_subscriptions WHERE endpoint = %s", (sub.endpoint,)).rowcount
    return {"deleted": n}


@app.get("/push/devices")
def push_devices():
    with pool.connection() as c:
        return c.execute("""SELECT id, device, created_at, last_ok_at, failures FROM push_subscriptions
                            ORDER BY created_at""").fetchall()


@app.delete("/push/devices/{sub_id}")
def push_device_delete(sub_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM push_subscriptions WHERE id = %s", (sub_id,))
    return {"ok": True}


@app.post("/push/send")
def push_send(m: PushMessage):
    """Envoi interne (récap hebdo, rapport mensuel, consentement bancaire) ; bloqué côté nginx (jamais exposé)."""
    return {"sent": push_all(m.title, m.body, m.url, m.tag)}
