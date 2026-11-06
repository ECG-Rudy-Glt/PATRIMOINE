"""allocation-engine : placements, allocation cible, filtre fiscal (règle dure), plan d'investissement, marchés.
Tous les chiffres sont produits ici ou en SQL (migration 013) ; le conseiller IA ne fait que les lire."""
import csv
import io
import os
from datetime import date
from decimal import Decimal

import httpx
from fastapi import Body, FastAPI, HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

BUDGET = os.environ.get("BUDGET_URL", "http://budget-engine:8000")
pool = ConnectionPool(os.environ["DATABASE_URL"], kwargs={"row_factory": dict_row}, open=False)
app = FastAPI(title="allocation-engine")

EXPOSURES = {
    "actions_monde": "Actions monde", "actions_europe": "Actions Europe", "actions_usa": "Actions USA",
    "actions_emergents": "Actions émergentes", "obligations": "Obligations", "fonds_euro": "Fonds euros",
    "monetaire": "Monétaire", "or": "Or", "immobilier": "Immobilier (SCPI…)", "crypto": "Crypto",
    "liquidites": "Liquidités (courants + livrets)", "autre": "Autre",
}
ENVELOPES = {"pea": "PEA", "assurance_vie": "Assurance-vie", "per": "PER", "cto": "Compte-titres", "livret": "Livret",
             "courant": "Compte courant"}


@app.on_event("startup")
def _open():
    pool.open()


@app.get("/health")
def health():
    with pool.connection() as c:
        c.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/alloc/exposures")
def exposures():
    return EXPOSURES


# ------------------------------------------------------------------ positions

@app.get("/alloc/holdings")
def holdings(person: int | None = None):
    with pool.connection() as c:
        rows = c.execute("SELECT * FROM holdings(%s)", (person,)).fetchall()
        # filtre fiscal appliqué aux positions existantes
        for r in rows:
            chk = c.execute("SELECT * FROM envelope_allows(%s, %s, %s)",
                            (r["account_type"], r["exposure"], r["pea_eligible"])).fetchone()
            r["envelope_ok"], r["envelope_issue"] = chk["allowed"], chk["reason"]
    total = sum((r["value"] or 0) for r in rows)
    invested = sum((r["invested"] or 0) for r in rows)
    return {"total": total, "invested": invested, "gain": total - invested,
            "gain_pct": round(100 * (total / invested - 1), 2) if invested else None, "items": rows}


@app.get("/alloc/portfolio/history")
def portfolio_history(person: int | None = None, days: int = 365):
    with pool.connection() as c:
        return c.execute("SELECT * FROM portfolio_history(%s, %s)", (person, days)).fetchall()


class AssetIn(BaseModel):
    name: str
    isin: str | None = None
    asset_class: str = "etf"
    exposure: str
    pea_eligible: bool = False
    data_symbol: str | None = None
    ter: Decimal | None = None
    currency: str = "EUR"


@app.get("/alloc/assets")
def assets():
    with pool.connection() as c:
        return c.execute("SELECT * FROM assets ORDER BY name").fetchall()


@app.post("/alloc/assets")
def add_asset(a: AssetIn):
    if a.exposure not in EXPOSURES:
        raise HTTPException(422, "exposition inconnue")
    with pool.connection() as c:
        return c.execute(
            """INSERT INTO assets (name, isin, asset_class, exposure, pea_eligible, data_symbol, ter, currency)
               VALUES (%s,%s,%s,%s,%s,NULLIF(%s,''),%s,%s)
               ON CONFLICT (isin) DO UPDATE SET name = EXCLUDED.name, exposure = EXCLUDED.exposure,
                 pea_eligible = EXCLUDED.pea_eligible, data_symbol = EXCLUDED.data_symbol, ter = EXCLUDED.ter
               RETURNING *""",
            (a.name, a.isin or None, a.asset_class, a.exposure, a.pea_eligible, a.data_symbol, a.ter, a.currency)).fetchone()


class AccountIn(BaseModel):
    name: str
    type: str                  # pea | cto | assurance_vie | per
    institution: str | None = None
    holders: dict[int, Decimal] = {}


@app.post("/alloc/accounts")
def add_account(a: AccountIn):
    """Compte de placement géré à la main (en attendant la synchro woob) ; valorisé chaque jour par ingestion-market."""
    if a.type not in ("pea", "cto", "assurance_vie", "per"):
        raise HTTPException(422, "type de compte de placement attendu")
    with pool.connection() as c:
        acc = c.execute(
            """INSERT INTO accounts (external_id, source, institution, name, type, last_sync_at)
               VALUES ('manuel:' || gen_random_uuid(), 'manuel', %s, %s, %s, now()) RETURNING id""",
            (a.institution, a.name, a.type)).fetchone()["id"]
        for pid, share in a.holders.items():
            c.execute("INSERT INTO account_holders VALUES (%s,%s,%s)", (acc, pid, share))
    return {"id": acc}


class TradeIn(BaseModel):
    account_id: int
    asset_id: int
    day: date
    kind: str = "achat"
    quantity: Decimal = Decimal(0)
    price: Decimal | None = None
    fees: Decimal = Decimal(0)
    note: str | None = None


def check_envelope(c, account_id: int, asset_id: int):
    """Règle dure : refuse un ordre qu'une enveloppe ne peut pas détenir."""
    r = c.execute("""SELECT e.* FROM accounts a, assets s, envelope_allows(a.type, s.exposure, s.pea_eligible) e
                     WHERE a.id = %s AND s.id = %s""", (account_id, asset_id)).fetchone()
    if not r:
        raise HTTPException(404, "compte ou actif inconnu")
    if not r["allowed"]:
        raise HTTPException(422, r["reason"])


@app.get("/alloc/trades")
def trades(limit: int = 100):
    with pool.connection() as c:
        return c.execute(
            """SELECT t.*, s.name AS asset, a.name AS account FROM trades t JOIN assets s ON s.id = t.asset_id
               JOIN accounts a ON a.id = t.account_id ORDER BY t.day DESC, t.id DESC LIMIT %s""", (limit,)).fetchall()


@app.post("/alloc/trades")
def add_trade(t: TradeIn):
    if t.kind not in ("achat", "vente", "dividende", "frais"):
        raise HTTPException(422, "type d'opération inconnu")
    with pool.connection() as c:
        if t.kind == "achat":
            check_envelope(c, t.account_id, t.asset_id)
        tid = c.execute(
            """INSERT INTO trades (account_id, asset_id, day, kind, quantity, price, fees, note)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (t.account_id, t.asset_id, t.day, t.kind, t.quantity, t.price, t.fees, t.note)).fetchone()["id"]
        # cours de l'ordre = premier point de cotation si l'actif n'est pas coté automatiquement
        if t.price:
            c.execute("""INSERT INTO price_history (asset_id, day, close, source) VALUES (%s,%s,%s,'ordre')
                         ON CONFLICT (asset_id, day) DO NOTHING""", (t.asset_id, t.day, t.price))
    return {"id": tid}


@app.delete("/alloc/trades/{trade_id}")
def delete_trade(trade_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM trades WHERE id = %s", (trade_id,))
    return {"ok": True}


@app.post("/alloc/trades/import")
def import_trades(account_id: int, csv_text: str = Body(..., media_type="text/plain")):
    """Import CSV (export courtier) — colonnes : date;isin;nom;type;quantite;prix;frais ; séparateur ; ou ,
    Les actifs inconnus sont créés avec l'exposition « autre » (à préciser ensuite)."""
    sample = csv_text[:500]
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=";" if sample.count(";") > sample.count(",") else ",")
    n, errors = 0, []
    with pool.connection() as c:
        for i, row in enumerate(reader, start=2):
            try:
                row = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
                dec = lambda s: Decimal(s.replace(" ", "").replace(",", ".")) if s else Decimal(0)
                asset = c.execute("SELECT id FROM assets WHERE isin = %s", (row["isin"],)).fetchone() or \
                    c.execute("""INSERT INTO assets (name, isin, asset_class, exposure) VALUES (%s,%s,'etf','autre')
                                 RETURNING id""", (row.get("nom") or row["isin"], row["isin"])).fetchone()
                kind = {"buy": "achat", "sell": "vente", "dividend": "dividende"}.get(row["type"].lower(), row["type"].lower())
                c.execute("""INSERT INTO trades (account_id, asset_id, day, kind, quantity, price, fees, source)
                             VALUES (%s,%s,%s,%s,%s,%s,%s,'import')""",
                          (account_id, asset["id"], row["date"], kind, dec(row.get("quantite", "")),
                           dec(row.get("prix", "")) or None, dec(row.get("frais", ""))))
                n += 1
            except Exception as e:
                errors.append(f"ligne {i} : {e}")
    return {"imported": n, "errors": errors}


# ------------------------------------------------------------------ allocation

@app.get("/alloc/current")
def current(person: int | None = None):
    with pool.connection() as c:
        rows = c.execute("SELECT * FROM allocation_current(%s)", (person,)).fetchall()
    for r in rows:
        r["label"] = EXPOSURES.get(r["exposure"], r["exposure"])
    return rows


@app.get("/alloc/targets")
def targets():
    with pool.connection() as c:
        return c.execute("SELECT * FROM allocation_targets ORDER BY target_pct DESC").fetchall()


class TargetIn(BaseModel):
    exposure: str
    target_pct: Decimal
    band_pct: Decimal = Decimal(5)


@app.put("/alloc/targets")
def set_targets(items: list[TargetIn]):
    if items and sum(t.target_pct for t in items) != 100:
        raise HTTPException(422, "La somme des cibles doit faire 100 %")
    with pool.connection() as c:
        c.execute("DELETE FROM allocation_targets")
        for t in items:
            if t.exposure not in EXPOSURES:
                raise HTTPException(422, f"exposition inconnue : {t.exposure}")
            c.execute("INSERT INTO allocation_targets VALUES (%s,%s,%s)", (t.exposure, t.target_pct, t.band_pct))
    return targets()


@app.get("/alloc/plan")
def plan(person: int | None = None, monthly: Decimal | None = None):
    """Où placer le montant mensuel : combler d'abord les expositions sous leur cible (rééquilibrage par les
    apports, sans vendre), puis choisir l'enveloppe fiscalement préférée parmi celles détenues (règle dure)."""
    with pool.connection() as c:
        setting = c.execute("SELECT value FROM settings WHERE key = 'invest_monthly'").fetchone()["value"]
        alloc = c.execute("SELECT * FROM allocation_current(%s)", (person,)).fetchall()
        owned = {r["type"] for r in c.execute(
            "SELECT DISTINCT a.type FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id", (person,)).fetchall()}
        prefs = c.execute("SELECT * FROM envelope_preference ORDER BY exposure, rank").fetchall()
    source = "paramètre"
    if monthly is None:
        monthly = setting
        if not monthly:
            q = f"?person={person}" if person else ""
            monthly = Decimal(str(httpx.get(f"{BUDGET}/budget/summary{q}", timeout=30).json().get("investable") or 0))
            source = "budget (investissable)"
    else:
        source = "simulation"
    targeted = [a for a in alloc if a["target_pct"] is not None]
    if not targeted:
        return {"monthly": monthly, "source": source, "items": [], "note": "Définis une allocation cible pour obtenir un plan."}
    total = sum(a["value"] for a in alloc)
    after = total + monthly
    deficits = {a["exposure"]: max(Decimal(0), a["target_pct"] / 100 * after - a["value"]) for a in targeted}
    base = sum(deficits.values())
    weights = deficits if base > 0 else {a["exposure"]: a["target_pct"] for a in targeted}
    wsum = sum(weights.values()) or 1
    items = []
    for exp, w in sorted(weights.items(), key=lambda kv: -kv[1]):
        amount = round(monthly * w / wsum, 2)
        if amount <= 0:
            continue
        cands = [p for p in prefs if p["exposure"] == exp]
        best = next((p for p in cands if p["account_type"] in owned), None)
        items.append({
            "exposure": exp, "label": EXPOSURES.get(exp, exp), "amount": amount,
            "envelope": ENVELOPES.get(best["account_type"]) if best else None,
            "envelope_why": best["why"] if best else None,
            "to_open": None if best else (ENVELOPES.get(cands[0]["account_type"]) if cands else None),
            "to_open_why": None if best or not cands else cands[0]["why"],
        })
    return {"monthly": monthly, "source": source, "total_before": total, "items": items}


# ------------------------------------------------------------------ frais (L3, migration 016)
# Coût annuel = encours × (gestion + TER pondéré des supports) + versements × frais d'entrée + arbitrages + tenue.
# Manque à gagner sur N ans = valeur finale sans frais (ou avec le repère à frais réduits) − valeur finale avec frais,
# même encours de départ et mêmes versements mensuels, au rendement brut hypothétique (settings.fees_gross_return_pct).

INVEST_TYPES = ("pea", "cto", "assurance_vie", "per")
HORIZONS = (10, 20)


def project(value: float, monthly: float, years: int, gross_pct: float, prop_pct: float = 0, entry_pct: float = 0,
            fixed_eur: float = 0) -> float:
    """Valeur après `years` ans, pas mensuel : versement (net des frais d'entrée) en début de mois, rendement brut
    et frais proportionnels annuels convertis en taux mensuels équivalents, forfaits annuels prélevés par douzièmes."""
    g = (1 + gross_pct / 100) ** (1 / 12)
    k = (1 - prop_pct / 100) ** (1 / 12)
    v = value
    for _ in range(12 * years):
        v = max(0.0, (v + monthly * (1 - entry_pct / 100)) * g * k - fixed_eur / 12)
    return v


def r2(x) -> float:
    return round(float(x), 2)


def bank_fees(person: int | None) -> dict:
    """Frais bancaires des comptes courants : coût mensuel réel de la catégorie frais_bancaires (budget-engine, /budget/avoidable :
    calculé sur la période couverte, donc disponible même sans cycle budgétaire complet)."""
    q = f"?person={person}" if person else ""
    try:
        groups = httpx.get(f"{BUDGET}/budget/avoidable{q}", timeout=30).raise_for_status().json()["groups"]
    except (httpx.HTTPError, KeyError, ValueError):
        return {"available": False, "monthly": None, "annual": None}
    monthly = sum(float(i["monthly"]) for g in groups for i in g["items"] if i["category"] == "frais_bancaires")
    return {"available": True, "monthly": r2(monthly), "annual": r2(monthly * 12)}


@app.get("/alloc/fees")
def fees(person: int | None = None):
    with pool.connection() as c:
        gross = float(c.execute("SELECT value FROM settings WHERE key = 'fees_gross_return_pct'").fetchone()["value"])
        bench = {r["account_type"]: r for r in c.execute("SELECT * FROM fee_benchmarks").fetchall()}
        accounts = c.execute(
            """SELECT a.id, a.name, a.type, a.institution, w.w, f.*,
                      v.balance AS last_balance,
                      (SELECT COALESCE(sum(CASE t.kind WHEN 'achat' THEN t.quantity * t.price + t.fees
                                                       ELSE -t.quantity * t.price END), 0)
                       FROM trades t WHERE t.account_id = a.id AND t.kind IN ('achat','vente')
                         AND t.day > current_date - 365
                         AND t.day > (SELECT min(day) FROM trades WHERE account_id = a.id)) AS net_buys_12m
               FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id AND a.type::text = ANY(%s)
               LEFT JOIN account_fees f ON f.account_id = a.id
               LEFT JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated
                                  ORDER BY day DESC LIMIT 1) v ON true
               ORDER BY a.type, a.name""", (person, list(INVEST_TYPES))).fetchall()
        pos = c.execute(
            """SELECT h.account_id, h.asset_id, h.asset, h.value, s.ter FROM holdings(%s) h
               JOIN assets s ON s.id = h.asset_id""", (person,)).fetchall()
    out = []
    for a in accounts:
        w = float(a["w"])
        lines = [p for p in pos if p["account_id"] == a["id"]]
        value = sum(float(p["value"] or 0) for p in lines) if lines else float(a["last_balance"] or 0) * w
        ter_eur = sum(float(p["value"] or 0) * float(p["ter"] or 0) / 100 for p in lines)
        ter_missing = [p["asset"] for p in lines if p["ter"] is None]
        ter_pct = 100 * ter_eur / value if value else 0.0
        if a["monthly_contribution"] is not None:
            monthly, source = float(a["monthly_contribution"]) * w, "saisi"
        else:
            monthly, source = max(0.0, float(a["net_buys_12m"]) * w / 12), "achats nets des 12 derniers mois"
        mgmt, entry = float(a["mgmt_pct"] or 0), float(a["entry_pct"] or 0)
        custody = float(a["custody_eur"] or 0) * w
        notes = []
        switch_part = float(a["switch_pct"] or 0) / 100 * float(a["switch_amount_eur"] or 0)
        if a["switch_pct"] and a["switches_per_year"] and a["switch_amount_eur"] is None:
            notes.append("Montant arbitré non renseigné : la part en % des frais d'arbitrage est ignorée")
        switch = float(a["switches_per_year"] or 0) * (float(a["switch_eur"] or 0) + switch_part) * w
        if a["account_id"] is None:
            notes.append("Barème de frais non saisi : seuls les frais courants des supports sont comptés, "
                         "pas de comparaison au repère")
        if not lines and value:
            notes.append("Supports non détaillés : frais courants (TER) inconnus")
        if ter_missing:
            notes.append(f"TER non renseigné pour : {', '.join(ter_missing)}")
        annual = {"gestion": value * mgmt / 100, "supports": ter_eur, "versements": 12 * monthly * entry / 100,
                  "arbitrages": switch, "tenue": custody}
        total = sum(annual.values())
        b = bench.get(a["type"])
        b_ter = float(b["ter_pct"]) if b and b["ter_pct"] is not None else ter_pct
        b_mgmt, b_entry, b_custody = (float(b["mgmt_pct"]), float(b["entry_pct"]), float(b["custody_eur"])) if b else (0, 0, 0)
        b_annual = value * (b_mgmt + b_ter) / 100 + 12 * monthly * b_entry / 100 + b_custody
        proj = {}
        for n in HORIZONS:
            without = project(value, monthly, n, gross)
            with_fees = project(value, monthly, n, gross, mgmt + ter_pct, entry, custody + switch)
            with_bench = project(value, monthly, n, gross, b_mgmt + b_ter, b_entry, b_custody)
            proj[n] = {"sans_frais": r2(without), "avec_frais": r2(with_fees), "repere": r2(with_bench),
                       "verse": r2(value + 12 * n * monthly), "manque": r2(without - with_fees),
                       "vs_repere": r2(with_bench - with_fees) if a["account_id"] else None}
        out.append({
            "account_id": a["id"], "name": a["name"], "type": a["type"], "envelope": ENVELOPES.get(a["type"]),
            "institution": a["institution"], "weight": w, "value": r2(value),
            "schedule": {k: a[k] for k in ("mgmt_pct", "entry_pct", "switch_pct", "switch_eur", "switches_per_year",
                                           "switch_amount_eur", "custody_eur", "monthly_contribution", "note")}
                        if a["account_id"] else None,
            "monthly_contribution": r2(monthly), "contribution_source": source,
            "ter_pct": round(ter_pct, 3), "ter_missing": ter_missing,
            "annual": {k: r2(v) for k, v in annual.items()}, "annual_total": r2(total),
            "annual_pct": round(100 * total / value, 3) if value else None,
            "benchmark": {"label": b["label"] if b else None, "mgmt_pct": b_mgmt, "entry_pct": b_entry,
                          "custody_eur": b_custody, "ter_pct": round(b_ter, 3), "annual_total": r2(b_annual)},
            "projection": proj, "notes": notes,
        })
    bank = bank_fees(person)
    tot = {"annual": r2(sum(a["annual_total"] for a in out)), "value": r2(sum(a["value"] for a in out))}
    for n in HORIZONS:
        tot[f"manque_{n}"] = r2(sum(a["projection"][n]["manque"] for a in out))
        tot[f"vs_repere_{n}"] = r2(sum(a["projection"][n]["vs_repere"] or 0 for a in out))
    tot["annual_pct"] = round(100 * tot["annual"] / tot["value"], 3) if tot["value"] else None
    tot["all_annual"] = r2(tot["annual"] + (bank["annual"] or 0))
    return {"gross_return_pct": gross, "horizons": list(HORIZONS), "accounts": out, "totals": tot, "bank": bank}


class FeesIn(BaseModel):
    mgmt_pct: Decimal = Decimal(0)
    entry_pct: Decimal = Decimal(0)
    switch_pct: Decimal = Decimal(0)
    switch_eur: Decimal = Decimal(0)
    switches_per_year: Decimal = Decimal(0)
    switch_amount_eur: Decimal | None = None
    custody_eur: Decimal = Decimal(0)
    monthly_contribution: Decimal | None = None
    note: str | None = None


@app.put("/alloc/fees/accounts/{account_id}")
def set_fees(account_id: int, f: FeesIn):
    with pool.connection() as c:
        t = c.execute("SELECT type FROM accounts WHERE id = %s", (account_id,)).fetchone()
        if not t or t["type"] not in INVEST_TYPES:
            raise HTTPException(422, "compte de placement attendu")
        c.execute(
            """INSERT INTO account_fees (account_id, mgmt_pct, entry_pct, switch_pct, switch_eur, switches_per_year,
                                         switch_amount_eur, custody_eur, monthly_contribution, note)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NULLIF(%s,''))
               ON CONFLICT (account_id) DO UPDATE SET mgmt_pct = EXCLUDED.mgmt_pct, entry_pct = EXCLUDED.entry_pct,
                 switch_pct = EXCLUDED.switch_pct, switch_eur = EXCLUDED.switch_eur,
                 switches_per_year = EXCLUDED.switches_per_year, switch_amount_eur = EXCLUDED.switch_amount_eur,
                 custody_eur = EXCLUDED.custody_eur, monthly_contribution = EXCLUDED.monthly_contribution,
                 note = EXCLUDED.note, updated_at = now()""",
            (account_id, f.mgmt_pct, f.entry_pct, f.switch_pct, f.switch_eur, f.switches_per_year,
             f.switch_amount_eur, f.custody_eur, f.monthly_contribution, f.note))
    return {"ok": True}


class BenchmarkIn(BaseModel):
    account_type: str
    label: str
    mgmt_pct: Decimal = Decimal(0)
    entry_pct: Decimal = Decimal(0)
    custody_eur: Decimal = Decimal(0)
    ter_pct: Decimal | None = None


class FeeParamsIn(BaseModel):
    gross_return_pct: Decimal
    benchmarks: list[BenchmarkIn] = []


@app.get("/alloc/fees/params")
def fee_params():
    with pool.connection() as c:
        return {"gross_return_pct": c.execute(
                    "SELECT value FROM settings WHERE key = 'fees_gross_return_pct'").fetchone()["value"],
                "benchmarks": c.execute("SELECT * FROM fee_benchmarks ORDER BY account_type").fetchall()}


@app.put("/alloc/fees/params")
def set_fee_params(p: FeeParamsIn):
    if not 0 <= p.gross_return_pct <= 15:
        raise HTTPException(422, "rendement brut hypothétique entre 0 et 15 %")
    with pool.connection() as c:
        c.execute("""INSERT INTO settings VALUES ('fees_gross_return_pct', %s)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", (p.gross_return_pct,))
        for b in p.benchmarks:
            if b.account_type not in INVEST_TYPES:
                raise HTTPException(422, f"type d'enveloppe inconnu : {b.account_type}")
            c.execute("""INSERT INTO fee_benchmarks VALUES (%s,%s,%s,%s,%s,%s)
                         ON CONFLICT (account_type) DO UPDATE SET label = EXCLUDED.label, mgmt_pct = EXCLUDED.mgmt_pct,
                           entry_pct = EXCLUDED.entry_pct, custody_eur = EXCLUDED.custody_eur, ter_pct = EXCLUDED.ter_pct""",
                      (b.account_type, b.label, b.mgmt_pct, b.entry_pct, b.custody_eur, b.ter_pct))
    return fee_params()


@app.put("/alloc/assets/{asset_id}/ter")
def set_ter(asset_id: int, ter: Decimal | None = Body(None, embed=True)):
    """Frais courants (TER, % annuel) d'un support ; null = inconnu."""
    if ter is not None and not 0 <= ter <= 10:
        raise HTTPException(422, "TER entre 0 et 10 %")
    with pool.connection() as c:
        if not c.execute("UPDATE assets SET ter = %s WHERE id = %s RETURNING id", (ter, asset_id)).fetchone():
            raise HTTPException(404, "support inconnu")
    return {"ok": True}


# ------------------------------------------------------------------ marchés

@app.get("/alloc/markets")
def markets():
    with pool.connection() as c:
        return {
            "signals": c.execute("SELECT * FROM market_signals()").fetchall(),
            "macro": c.execute("SELECT * FROM macro_indicators()").fetchall(),
            "series": c.execute(
                """SELECT s.*, (SELECT count(*) FROM market_points p WHERE p.code = s.code) AS points,
                          (SELECT max(day) FROM market_points p WHERE p.code = s.code) AS last_day
                   FROM market_series s ORDER BY s.kind, s.code""").fetchall(),
        }


@app.get("/alloc/markets/series")
def series(codes: str, days: int = 365):
    """Points de plusieurs séries, avec la moyenne mobile 200 jours (calculée ici, pas dans le navigateur)."""
    with pool.connection() as c:
        return c.execute(
            """SELECT code, day, value,
                      round(avg(value) OVER (PARTITION BY code ORDER BY day ROWS BETWEEN 199 PRECEDING AND CURRENT ROW), 2) AS ma200
               FROM market_points WHERE code = ANY(%s) AND day > current_date - %s::int - 200 ORDER BY code, day""",
            (codes.split(","), days)).fetchall()
