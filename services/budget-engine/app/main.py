"""budget-engine : catégorisation par règles et budget par cycle de paie.
Tous les chiffres sont calculés en SQL (fonctions categorize / budget_monthly, migrations 004-005)."""
import os
import re
from datetime import date
from decimal import Decimal

from fastapi import FastAPI, HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

pool = ConnectionPool(os.environ["DATABASE_URL"], kwargs={"row_factory": dict_row}, open=False)
app = FastAPI(title="budget-engine", root_path="")

AVG_CYCLES = 3  # moyenne sur les N derniers cycles complets


@app.on_event("startup")
def _open():
    pool.open()


@app.get("/health")
def health():
    with pool.connection() as c:
        c.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/budget/categories")
def categories():
    with pool.connection() as c:
        return c.execute("SELECT code, label, kind FROM categories ORDER BY kind, label").fetchall()


@app.get("/budget/monthly")
def monthly(person: int | None = None):
    with pool.connection() as c:
        return c.execute("SELECT * FROM budget_monthly(%s)", (person,)).fetchall()


@app.get("/budget/summary")
def summary(person: int | None = None):
    with pool.connection() as c:
        s = {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM settings").fetchall()}
        avg = c.execute(
            """WITH b AS (SELECT * FROM budget_monthly(%s) WHERE complete ORDER BY cycle DESC LIMIT %s)
               SELECT count(*) AS cycles, min(starts) AS from_day, max(ends) AS to_day,
                      round(avg(income),2) AS income, round(avg(fixed),2) AS fixed,
                      round(avg(variable),2) AS variable, round(avg(internal_net),2) AS internal_net,
                      round(avg(available),2) AS available FROM b""",
            (person, AVG_CYCLES),
        ).fetchone()
        liquid = c.execute(
            """SELECT COALESCE(sum(v.balance * w.w), 0) AS liquid
               FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id AND a.type IN ('courant','livret')
               JOIN LATERAL (SELECT balance FROM valuations WHERE account_id = a.id AND NOT estimated
                             ORDER BY day DESC LIMIT 1) v ON true""",
            (person,),
        ).fetchone()["liquid"]
        uncategorized = c.execute(
            """SELECT count(*) AS n, COALESCE(-sum(t.amount), 0) AS amount FROM transactions t
               JOIN account_weights(%s) w USING (account_id) WHERE t.category = 'divers'""",
            (person,),
        ).fetchone()
    if not avg["cycles"]:
        return {"cycles": 0, "uncategorized": uncategorized}
    spend = avg["fixed"] + avg["variable"]
    target = round(spend * s["buffer_months"], 2)
    shortfall = max(Decimal(0), target - liquid)
    refill = round(shortfall / s["buffer_refill_months"], 2)
    return {
        **avg,
        "monthly_spend": spend,
        "buffer": {"months": s["buffer_months"], "target": target, "liquid": liquid,
                   "shortfall": shortfall, "refill_per_month": refill, "refill_months": s["buffer_refill_months"]},
        "investable": max(Decimal(0), avg["available"] - refill),
        "uncategorized": uncategorized,
    }


@app.get("/budget/breakdown")
def breakdown(person: int | None = None, cycle: date | None = None):
    """Détail par catégorie : un cycle donné, ou moyenne des derniers cycles complets."""
    with pool.connection() as c:
        cycles = [cycle] if cycle else [r["cycle"] for r in c.execute(
            "SELECT cycle FROM budget_monthly(%s) WHERE complete ORDER BY cycle DESC LIMIT %s",
            (person, AVG_CYCLES)).fetchall()]
        if not cycles:
            return []
        return c.execute(
            """SELECT c.code, c.label, c.kind, count(*) AS n,
                      round(sum(t.amount * w.w) / %s, 2) AS amount
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               JOIN categories c ON c.code = t.category
               WHERE budget_cycle(t.booked_on) = ANY(%s)
               GROUP BY c.code ORDER BY c.kind, amount""",
            (len(cycles), person, cycles),
        ).fetchall()


def merchant_key(label: str) -> str:
    """'CB AMAZON PAYMENTS FACT 150926 874076******9' -> 'AMAZON PAYMENTS'"""
    s = re.sub(r"^(CB|PRLV SEPA|PRLV|VIR SEPA|VIR INST|VIR|\*COM CB INT)\s+", "", label.strip(), flags=re.I)
    s = re.split(r"\s+FACT\s|\s\d{6,}|\s\d{2}-\d{2}-", s)[0]
    return s.strip()


class CategoryIn(BaseModel):
    category: str
    remember: bool = False   # crée une règle pour les libellés du même marchand


@app.put("/budget/transactions/{tx_id}/category")
def set_category(tx_id: int, body: CategoryIn):
    with pool.connection() as c:
        tx = c.execute("SELECT label, amount FROM transactions WHERE id = %s", (tx_id,)).fetchone()
        if not tx:
            raise HTTPException(404)
        if not c.execute("SELECT 1 FROM categories WHERE code = %s", (body.category,)).fetchone():
            raise HTTPException(422, "Catégorie inconnue")
        c.execute("UPDATE transactions SET category = %s, category_source = 'manual' WHERE id = %s",
                  (body.category, tx_id))
        rule = None
        if body.remember and tx["label"]:
            key = merchant_key(tx["label"])
            rule = c.execute(
                """INSERT INTO category_rules (priority, direction, pattern, category)
                   VALUES (5, %s, %s, %s) RETURNING id, pattern""",
                ("in" if tx["amount"] > 0 else "out", re.escape(key), body.category),
            ).fetchone()
            rule["updated"] = c.execute("SELECT categorize(TRUE) AS n").fetchone()["n"]
    return {"ok": True, "rule": rule}


@app.get("/budget/rules")
def rules():
    with pool.connection() as c:
        return c.execute(
            """SELECT r.*, c.label AS category_label,
                      (SELECT count(*) FROM transactions t WHERE t.category_source = 'rule'
                         AND t.category = r.category AND COALESCE(t.label,'') ~* r.pattern) AS matches
               FROM category_rules r JOIN categories c ON c.code = r.category ORDER BY r.priority, r.id"""
        ).fetchall()


@app.delete("/budget/rules/{rule_id}")
def delete_rule(rule_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM category_rules WHERE id = %s", (rule_id,))
        n = c.execute("SELECT categorize(TRUE) AS n").fetchone()["n"]
    return {"ok": True, "updated": n}


@app.get("/budget/settings")
def get_settings():
    with pool.connection() as c:
        return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM settings").fetchall()}


@app.put("/budget/settings")
def put_settings(values: dict[str, Decimal]):
    with pool.connection() as c:
        for k, v in values.items():
            if not c.execute("UPDATE settings SET value = %s WHERE key = %s RETURNING key", (v, k)).fetchone():
                raise HTTPException(422, f"Paramètre inconnu : {k}")
    return get_settings()


def cancel_cycles(links: dict[tuple[int, int], Decimal], accounts: set[int]) -> None:
    """Supprime les cycles entre comptes (A -> B puis B -> A, ou plus long) : le diagramme de flux (Sankey) boucle
    à l'infini sur un cycle. On retire le plus petit flux du cycle de chacun de ses liens : le solde net de chaque
    compte (entrées moins sorties) reste identique."""
    while True:
        graph: dict[int, list[int]] = {}
        for (src, dst), v in links.items():
            if v > 0 and src in accounts and dst in accounts:
                graph.setdefault(src, []).append(dst)
        cycle = find_cycle(graph)
        if not cycle:
            return
        edges = list(zip(cycle, cycle[1:] + cycle[:1]))
        m = min(links[e] for e in edges)
        for e in edges:
            links[e] -= m
            if links[e] <= 0:
                del links[e]


def find_cycle(graph: dict[int, list[int]]) -> list[int] | None:
    """Premier cycle trouvé (liste de nœuds dans l'ordre du parcours) ou None."""
    state: dict[int, int] = {}      # 1 = en cours, 2 = terminé
    path: list[int] = []

    def visit(n: int) -> list[int] | None:
        state[n] = 1
        path.append(n)
        for m in graph.get(n, []):
            if state.get(m) == 1:
                return path[path.index(m):]
            if m not in state and (c := visit(m)):
                return c
        path.pop()
        state[n] = 2
        return None

    for n in list(graph):
        if n not in state and (c := visit(n)):
            return c
    return None


def pair_transfers(moves: list[dict], max_days: int = 3) -> list[dict]:
    """Apparie chaque débit (internal ou household) à un crédit internal de même montant sur un autre compte,
    à `max_days` jours près ; chaque opération sert une seule fois. `moves` est trié par date."""
    ins = [m for m in moves if m["amount"] > 0 and m["kind"] == "internal"]
    used: set[int] = set()
    out: list[dict] = []
    for o in (m for m in moves if m["amount"] < 0):
        best = None
        for i in ins:
            if (i["id"] in used or i["account_id"] == o["account_id"] or i["amount"] != -o["amount"]
                    or abs((i["booked_on"] - o["booked_on"]).days) > max_days):
                continue
            if best is None or abs((i["booked_on"] - o["booked_on"]).days) < abs((best["booked_on"] - o["booked_on"]).days):
                best = i
        if best:
            used.add(best["id"])
            out.append({"out": o, "in": best})
    return out


_REF = re.compile(r"\b\d{5,}\b|\b(?=[\w/-]*\d)[\w/-]{6,}\b")   # n° de compte, références, dates collées
_PREFIX = re.compile(r"^(VIREMENT|VIR|PRLV|TRANSFERT)( INST| SEPA)?( DE | A | VERS )?\s*", re.I)


def counterpart(label: str | None) -> str:
    """Nom lisible de l'autre côté d'un virement, tiré du libellé bancaire :
    « VIR INST GAULT ALEX N2 » -> « GAULT ALEX N2 » ; références, dates et mentions répétées retirées."""
    s = _REF.sub(" ", label or "")
    s = _PREFIX.sub("", s.strip())
    s = re.split(r"\s(VIR\b|VIREMENT)", s, maxsplit=1)[0]
    s = " ".join(s.split())
    return (s[:40] or "Compte non suivi").upper()


def flow_window(c, person: int | None) -> tuple[list, Decimal, bool]:
    """Période des cartographies : les derniers cycles complets ; à défaut (comptes récents), les cycles disponibles,
    moyennés sur la durée réellement couverte (jamais plus de 3 mois). Renvoie (cycles, nombre de mois, partiel)."""
    cycles = [r["cycle"] for r in c.execute(
        "SELECT cycle FROM budget_monthly(%s) WHERE complete ORDER BY cycle DESC LIMIT %s", (person, AVG_CYCLES)).fetchall()]
    if cycles:
        return cycles, Decimal(len(cycles)), False
    cycles = [r["cycle"] for r in c.execute(
        "SELECT cycle FROM budget_monthly(%s) ORDER BY cycle DESC LIMIT %s", (person, AVG_CYCLES)).fetchall()]
    if not cycles:
        return [], Decimal(0), True
    span = c.execute(
        """SELECT (current_date - min(t.booked_on)) + 1 AS d FROM transactions t JOIN account_weights(%s) w USING (account_id)
           WHERE budget_cycle(t.booked_on) = ANY(%s)""", (person, cycles)).fetchone()["d"] or 30
    return cycles, max(Decimal(1), Decimal(min(int(span), 91)) / Decimal("30.4")).quantize(Decimal("0.1")), True


@app.get("/budget/transfers")
def transfers(person: int | None = None):
    """Cartographie des virements entre comptes : comptes suivis (nœuds) et flux moyens par cycle complet.
    Les virements dont l'autre côté est suivi sont appariés (même règle que la cartographie des flux) ; les autres
    pointent vers une contrepartie « non suivie » identifiée par le libellé (livret, compte non connecté…)."""
    with pool.connection() as c:
        cycles, n, partial = flow_window(c, person)
        if not cycles:
            return {"cycles": 0, "months": 0, "partial": True, "nodes": [], "edges": []}
        moves = c.execute(
            """SELECT t.id, t.account_id, t.booked_on, t.amount, t.label, w.w, c.kind
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               JOIN categories c ON c.code = t.category
               WHERE budget_cycle(t.booked_on) = ANY(%s) AND c.kind IN ('internal', 'household', 'savings')
               ORDER BY t.booked_on, t.id""", (person, cycles)).fetchall()
        accounts = {r["id"]: r for r in c.execute(
            "SELECT a.id, a.name, a.institution, a.type FROM accounts a JOIN account_weights(%s) w ON w.account_id = a.id",
            (person,)).fetchall()}

    nodes: dict[str, dict] = {}
    for a in accounts.values():
        nodes[f"acc:{a['id']}"] = {"key": f"acc:{a['id']}", "kind": "account", "name": a["name"],
                                   "institution": a["institution"], "account_id": a["id"]}
    edges: dict[tuple[str, str], dict] = {}

    def add(src: str, dst: str, amount: Decimal, day, paired: bool):
        e = edges.setdefault((src, dst), {"source": src, "target": dst, "total": Decimal(0), "count": 0,
                                          "last": day, "paired": paired})
        e["total"] += amount
        e["count"] += 1
        e["last"] = max(e["last"], day)

    pairs = pair_transfers(moves)
    done = set()
    for p in pairs:
        o, i = p["out"], p["in"]
        done |= {o["id"], i["id"]}
        add(f"acc:{o['account_id']}", f"acc:{i['account_id']}", -o["amount"] * o["w"], o["booked_on"], True)
    def norm(x: str) -> str:
        return " ".join(re.sub(r"[^A-Z0-9 ]", " ", x.upper()).split())

    names = {i: norm(a["name"]) for i, a in accounts.items()}

    def known(who: str) -> int | None:
        """Compte suivi dont le nom correspond à la contrepartie (la banque tronque parfois le nom)."""
        w = norm(who)
        for i, nm in names.items():
            if w == nm or (len(w) >= 12 and (nm.startswith(w) or w.startswith(nm))):
                return i
        return None

    for m in moves:
        if m["id"] in done or m["account_id"] not in accounts:
            continue
        who = counterpart(m["label"])
        other = known(who)
        if other == m["account_id"]:
            continue                       # virement vers soi-même
        if other is not None:              # compte suivi dont l'autre côté manque dans l'historique
            node = f"acc:{other}"
        else:
            node = f"ext:{who}"
            nodes.setdefault(node, {"key": node, "kind": "external", "name": who, "institution": None, "account_id": None})
        me = f"acc:{m['account_id']}"
        if m["amount"] < 0:
            add(me, node, -m["amount"] * m["w"], m["booked_on"], False)
        else:
            add(node, me, m["amount"] * m["w"], m["booked_on"], False)

    # aller-retour avec une même contrepartie non suivie : seul l'écart est un vrai flux
    for (src, dst), e in list(edges.items()):
        if src.startswith("ext:") or not dst.startswith("ext:") or (dst, src) not in edges:
            continue
        back = edges[(dst, src)]
        net = e["total"] - back["total"]
        if net > 0:
            e["total"], e["count"] = net, e["count"] + back["count"]
            del edges[(dst, src)]
        elif net < 0:
            back["total"], back["count"] = -net, e["count"] + back["count"]
            del edges[(src, dst)]
        else:
            del edges[(src, dst)]
            del edges[(dst, src)]
    used = {k for e in edges.values() for k in (e["source"], e["target"])}
    nodes = {k: v for k, v in nodes.items() if v["kind"] == "account" or k in used}

    return {
        "cycles": 0 if partial else int(n), "months": float(n), "partial": partial,
        "nodes": list(nodes.values()),
        "edges": sorted(({"source": e["source"], "target": e["target"], "monthly": round(e["total"] / n, 2),
                          "count": e["count"], "last": e["last"], "paired": e["paired"]} for e in edges.values()),
                        key=lambda e: -e["monthly"]),
    }


@app.get("/budget/flows")
def flows(person: int | None = None, top: int = 5):
    """Flux moyens par cycle complet, pour la cartographie (Sankey) : sources -> comptes -> destinations.
    Un compte joint suivi reçoit directement les versements 'household' ; sinon nœud externe."""
    with pool.connection() as c:
        cycles, n, partial = flow_window(c, person)
        if not cycles:
            return {"cycles": 0, "months": 0, "partial": True, "nodes": [], "links": []}
        # virements entre comptes suivis : un débit (internal ou household) et un crédit (internal) de même
        # montant sur deux comptes différents, à 3 jours près, forment un flux compte -> compte
        moves = c.execute(
            """SELECT t.id, t.account_id, t.booked_on, t.amount, w.w, c.kind
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               JOIN categories c ON c.code = t.category
               WHERE budget_cycle(t.booked_on) = ANY(%s) AND c.kind IN ('internal', 'household')
               ORDER BY t.booked_on, t.id""", (person, cycles)).fetchall()
        pairs = pair_transfers(moves)
        paired = [i for p in pairs for i in (p["out"]["id"], p["in"]["id"])]
        rows = c.execute(
            """SELECT a.id AS account_id, a.name AS account, c.code, c.label, c.kind,
                      sum(t.amount * w.w) / %s AS amount
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               JOIN accounts a ON a.id = t.account_id JOIN categories c ON c.code = t.category
               WHERE budget_cycle(t.booked_on) = ANY(%s) AND t.id <> ALL(%s)
               GROUP BY a.id, a.name, c.code, c.label, c.kind""",
            (n, person, cycles, paired)).fetchall()
        names = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM accounts").fetchall()}
        joint = c.execute(
            """SELECT a.id, a.name FROM accounts a JOIN account_holders h ON h.account_id = a.id
               GROUP BY a.id HAVING count(*) > 1 LIMIT 1""").fetchone()

    nodes: list[dict] = []
    index: dict[str, int] = {}

    def node(key: str, name: str, group: str) -> int:
        if key not in index:
            index[key] = len(nodes)
            nodes.append({"name": name, "group": group})
        return index[key]

    links: dict[tuple[int, int], Decimal] = {}

    def link(src: int, dst: int, value: Decimal):
        if value > 0:
            links[(src, dst)] = links.get((src, dst), Decimal(0)) + value

    for p in pairs:
        link(node(f"acc:{p['out']['account_id']}", names[p["out"]["account_id"]], "account"),
             node(f"acc:{p['in']['account_id']}", names[p["in"]["account_id"]], "account"),
             -p["out"]["amount"] * p["out"]["w"] / n)

    # dépenses variables : top N catégories, le reste regroupé
    var_totals: dict[str, Decimal] = {}
    for r in rows:
        if r["kind"] == "variable":
            var_totals[r["code"]] = var_totals.get(r["code"], Decimal(0)) - r["amount"]
    top_var = {k for k, _ in sorted(var_totals.items(), key=lambda kv: -kv[1])[:top]}

    for r in rows:
        acc = node(f"acc:{r['account_id']}", r["account"], "account")
        amt, kind = r["amount"], r["kind"]
        if kind == "income":
            link(node(f"cat:{r['code']}", r["label"], "income"), acc, amt)
        elif kind == "internal":
            if amt > 0:
                link(node("int:in", "Virements reçus du foyer", "internal"), acc, amt)
            else:
                link(acc, node("int:out", "Virements envoyés au foyer", "internal"), -amt)
        elif kind == "household":
            if joint and joint["id"] != r["account_id"]:
                link(acc, node(f"acc:{joint['id']}", joint["name"], "account"), -amt)
            else:
                link(acc, node("ext:commun", "Compte commun (non suivi)", "household"), -amt)
        elif kind == "fixed":
            link(acc, node("kind:fixed", "Charges fixes", "fixed"), -amt)
        elif kind == "savings":
            link(acc, node("kind:savings", "Épargne", "savings"), -amt)
        elif kind == "variable":
            key, name = (f"cat:{r['code']}", r["label"]) if r["code"] in top_var else ("var:other", "Autres dépenses")
            link(acc, node(key, name, "variable"), -amt)

    cancel_cycles(links, {i for k, i in index.items() if k.startswith("acc:")})

    # solde de chaque compte sur la période : excédent conservé ou puisé sur le solde
    for key, i in list(index.items()):
        if not key.startswith("acc:"):
            continue
        inflow = sum(v for (s, d), v in links.items() if d == i)
        outflow = sum(v for (s, d), v in links.items() if s == i)
        if inflow > outflow:
            link(i, node(f"keep:{key}", "Reste sur le compte", "savings"), inflow - outflow)
        elif outflow > inflow:
            link(node(f"draw:{key}", "Puisé sur le solde", "draw"), i, outflow - inflow)

    return {
        "cycles": 0 if partial else int(n), "months": float(n), "partial": partial,
        "nodes": nodes,
        "links": [{"source": s, "target": d, "value": round(v, 2)} for (s, d), v in links.items()],
    }


# --- Cycle en cours, récurrents, plafonds ---

@app.get("/budget/current")
def current(person: int | None = None):
    """Où en est-on d'ici la paie : dépensé vs habitude au même stade, prélèvements récurrents encore attendus."""
    with pool.connection() as c:
        cur = c.execute("SELECT * FROM current_cycle(%s)", (person,)).fetchone()
        upcoming = c.execute(
            """SELECT merchant, category_label, last_amount AS amount, next_date, account FROM recurring(%s)
               WHERE next_date > current_date AND next_date <= %s ORDER BY next_date""",
            (person, cur["ends"])).fetchall()
    cur["upcoming"] = upcoming
    cur["upcoming_total"] = sum((u["amount"] for u in upcoming), Decimal(0))
    return cur


@app.get("/budget/recurring")
def recurring(person: int | None = None):
    with pool.connection() as c:
        items = c.execute("SELECT * FROM recurring(%s)", (person,)).fetchall()
    return {"monthly_total": sum((i["avg_amount"] for i in items), Decimal(0)), "items": items}


class CapIn(BaseModel):
    monthly: Decimal
    alert_pct: int = 80


# Catégories où l'on peut agir, et ce qu'on peut en faire. Montants toujours calculés sur les opérations réelles.
AVOID_GROUPS = [
    ("abonnements", "Abonnements et frais à couper ou négocier", {
        "abonnements": "Résilier ce qui ne sert pas, regrouper les doublons.",
        "frais_bancaires": "Demander la suppression des frais de carte/package ; carte sans frais à l'étranger.",
    }),
    ("contrats", "Contrats à remettre en concurrence", {
        "telecom": "Comparer box et forfaits (souvent −20 à −40 %).",
        "assurances": "Mettre les garanties à plat, supprimer les doublons, demander des devis.",
        "energie": "Comparer l'offre, ajuster la mensualité à la consommation réelle.",
    }),
    ("plaisir", "Dépenses variables à encadrer", {
        "plaisir": "Fixer une enveloppe mensuelle, règle des 48 h avant un achat non prévu.",
        "achats_en_ligne": "Enveloppe mensuelle ; désactiver le paiement en un clic.",
        "shopping": "Enveloppe mensuelle ; acheter après 48 h de réflexion.",
        "restaurants": "Enveloppe mensuelle sorties ; privilégier les sorties planifiées.",
        "loisirs": "Enveloppe mensuelle sorties.",
        "especes": "Retraits : à quoi servent-ils ? Les tracer ou les limiter.",
        "divers": "Catégorie « Autre » : à recatégoriser pour comprendre où part l'argent.",
    }),
]


@app.get("/budget/avoidable")
def avoidable(person: int | None = None, days: int = 90):
    """Tableau des dépenses sur lesquelles agir : coût mensuel et annuel réels (SQL), jamais estimés par le modèle."""
    codes = [k for _, _, cats in AVOID_GROUPS for k in cats]
    with pool.connection() as c:
        span = c.execute(
            """SELECT min(t.booked_on) AS first FROM transactions t JOIN account_weights(%s) w USING (account_id)
               WHERE t.booked_on > current_date - %s""", (person, days)).fetchone()["first"]
        months = max(1.0, ((date.today() - span).days + 1) / 30.4) if span else 1.0
        cats = {r["category"]: r for r in c.execute(
            """SELECT t.category, count(*) AS n, round(-sum(t.amount * w.w), 2) AS total
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               WHERE t.booked_on > current_date - %s AND t.amount < 0 AND t.category = ANY(%s)
               GROUP BY t.category""", (person, days, codes)).fetchall()}
        tops = c.execute(
            """SELECT t.category, COALESCE(NULLIF(t.merchant, ''), left(t.label, 40)) AS merchant, count(*) AS n,
                      round(-sum(t.amount * w.w), 2) AS total
               FROM transactions t JOIN account_weights(%s) w USING (account_id)
               WHERE t.booked_on > current_date - %s AND t.amount < 0 AND t.category = ANY(%s)
               GROUP BY 1, 2 ORDER BY total DESC""", (person, days, codes)).fetchall()
        labels = {r["code"]: r["label"] for r in c.execute("SELECT code, label FROM categories").fetchall()}
        rec = c.execute("SELECT * FROM recurring(%s)", (person,)).fetchall()
    groups = []
    for key, title, cat_hints in AVOID_GROUPS:
        items = []
        for code, hint in cat_hints.items():
            r = cats.get(code)
            if not r:
                continue
            monthly = float(r["total"]) / months
            items.append({
                "category": code, "label": labels.get(code, code), "n": r["n"], "hint": hint,
                "total": float(r["total"]), "monthly": round(monthly, 2), "annual": round(monthly * 12, 0),
                "top": [{"merchant": t["merchant"], "n": t["n"], "total": float(t["total"])}
                        for t in tops if t["category"] == code][:8],
                "recurring": [{"merchant": x["merchant"], "amount": float(x["avg_amount"]), "next": x["next_date"],
                               "annual": round(float(x["avg_amount"]) * 12, 0)}
                              for x in rec if x["category"] == code],
            })
        items.sort(key=lambda i: -i["monthly"])
        groups.append({"key": key, "title": title, "monthly": round(sum(i["monthly"] for i in items), 2),
                       "annual": round(sum(i["annual"] for i in items), 0), "items": items})
    return {"months": round(months, 1), "days": days, "groups": groups,
            "note": "Moyenne sur la période réellement couverte par les comptes ; les virements entre vous, l'épargne et le compte commun sont exclus."}


@app.get("/budget/commun")
def commun(months: int = 6):
    """Compte commun : versements reçus de chacun et charges payées, par mois civil, pour répondre à une seule question :
    verse-t-on assez ? Le versant « Alex » / « Sam » est reconnu au libellé du virement reçu (les versements sont classés
    « virements internes » : le calcul d'effort par catégorie les ignore). Les virements ponctuels hors versements
    (remboursement d'un trajet, retour de fonds…) sont comptés à part."""
    with pool.connection() as c:
        accs = c.execute("SELECT account_id FROM account_weights(-1)").fetchall()
        ids = [a["account_id"] for a in accs]
        if not ids:
            return {"months": [], "avg": None}
        rows = c.execute(
            """SELECT to_char(date_trunc('month', booked_on), 'YYYY-MM') AS month,
                      COALESCE(sum(amount) FILTER (WHERE amount > 0 AND amount < 2000 AND label ~* 'GAULT ALEX|COMMUN'), 0) AS alex,
                      COALESCE(sum(amount) FILTER (WHERE amount > 0 AND amount < 2000 AND label ~* 'SAM'), 0) AS sam,
                      COALESCE(sum(amount) FILTER (WHERE amount > 0 AND NOT ((amount < 2000 AND label ~* 'ALEX|COMMUN|SAM'))), 0) AS autres_entrees,
                      COALESCE(-sum(amount) FILTER (WHERE amount < 0 AND COALESCE(category, '') <> 'virement_interne'), 0) AS charges,
                      COALESCE(-sum(amount) FILTER (WHERE amount < 0 AND category = 'virement_interne'), 0) AS virements_sortants
               FROM transactions WHERE account_id = ANY(%s)
                 AND booked_on >= date_trunc('month', current_date) - make_interval(months => %s)
                 AND booked_on < date_trunc('month', current_date)
               GROUP BY 1 ORDER BY 1""", (ids, months)).fetchall()
        cur = c.execute(
            """SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0 AND amount < 2000 AND label ~* 'GAULT ALEX|COMMUN'), 0) AS alex,
                      COALESCE(sum(amount) FILTER (WHERE amount > 0 AND amount < 2000 AND label ~* 'SAM'), 0) AS sam,
                      COALESCE(-sum(amount) FILTER (WHERE amount < 0 AND COALESCE(category, '') <> 'virement_interne'), 0) AS charges
               FROM transactions WHERE account_id = ANY(%s) AND booked_on >= date_trunc('month', current_date)""", (ids,)).fetchone()
    out = []
    for r in rows:
        total = float(r["alex"]) + float(r["sam"])
        out.append({"month": r["month"], "alex": float(r["alex"]), "sam": float(r["sam"]), "autres_entrees": float(r["autres_entrees"]),
                    "versements": total, "charges": float(r["charges"]), "marge": round(total - float(r["charges"]), 2)})
    full = out[-3:]   # moyenne sur les trois derniers mois civils complets
    avg = None
    if full:
        n = len(full)
        avg = {"mois": n, "alex": round(sum(m["alex"] for m in full) / n, 2), "sam": round(sum(m["sam"] for m in full) / n, 2),
               "versements": round(sum(m["versements"] for m in full) / n, 2), "charges": round(sum(m["charges"] for m in full) / n, 2),
               "marge": round(sum(m["marge"] for m in full) / n, 2)}
        avg["couverture_pct"] = round(100 * avg["versements"] / avg["charges"], 0) if avg["charges"] else None
    return {"months": out, "avg": avg,
            "mois_en_cours": {"alex": float(cur["alex"]), "sam": float(cur["sam"]), "charges": float(cur["charges"])},
            "note": "Charges = dépenses du compte commun hors virements internes. Versements reconnus au libellé (Alex / Sam)."}


# --- Dépenses partagées : qui doit quoi à qui ---

SHARED_KEYWORDS = r"KIWI|RINAS|DISCOVERCARS|BILLET|AIRBNB|BOOKING|AIR FRANCE|SNCF|HOTEL|EASYJET|RYANAIR|LOCATION"


class SharedIn(BaseModel):
    kind: str
    share_other: Decimal = Decimal("0.5")
    note: str | None = None


def _two_persons(c) -> list[dict]:
    return c.execute("SELECT id, name FROM persons ORDER BY id LIMIT 2").fetchall()


def _owner_sql() -> str:
    """Titulaire unique d'un compte (compte personnel) : personne et nom ; NULL pour un compte commun."""
    return """(SELECT CASE WHEN count(*) = 1 THEN min(h.person_id) END FROM account_holders h WHERE h.account_id = t.account_id)"""


@app.get("/budget/shared")
def shared(days: int = 150):
    """Éléments déjà classés (dépense du foyer / remboursement) et suggestions à confirmer (voyages, virements directs)."""
    with pool.connection() as c:
        ps = _two_persons(c)
        if len(ps) < 2:
            return {"items": [], "candidates": []}
        names = {p["id"]: p["name"] for p in ps}
        items = c.execute(
            f"""SELECT t.id AS tx_id, t.booked_on, t.amount, left(t.label, 70) AS label, a.name AS account, {_owner_sql()} AS payer_id,
                       s.kind, s.share_other, s.note
                FROM shared_items s JOIN transactions t ON t.id = s.tx_id JOIN accounts a ON a.id = t.account_id
                WHERE s.kind <> 'ignore' ORDER BY t.booked_on DESC""").fetchall()
        # suggestions : sur les comptes personnels, non encore classées
        r_name, e_name = ps[0]["name"].upper(), ps[1]["name"].upper()
        cands = c.execute(
            f"""SELECT t.id AS tx_id, t.booked_on, t.amount, left(t.label, 70) AS label, a.name AS account, {_owner_sql()} AS payer_id,
                       CASE WHEN t.category = 'virement_interne' THEN 'remboursement' ELSE 'depense' END AS suggested
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE t.booked_on > current_date - %s AND {_owner_sql()} IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM shared_items s WHERE s.tx_id = t.id)
                  AND ((t.amount < -40 AND (t.category = 'voyages' OR t.label ~* %s))
                       OR (t.category = 'virement_interne' AND t.amount < 0 AND t.label !~* 'COMMUN|N2|CAGNOTTE'
                           AND ((t.label ~* %s AND {_owner_sql()} = %s) OR (t.label ~* %s AND {_owner_sql()} = %s))))
                ORDER BY t.booked_on DESC LIMIT 60""",
            (days, SHARED_KEYWORDS, e_name, ps[0]["id"], r_name, ps[1]["id"])).fetchall()
    for r in items + cands:
        r["payer"] = names.get(r.pop("payer_id"))
    return {"items": items, "candidates": cands}


@app.put("/budget/shared/{tx_id}")
def shared_set(tx_id: int, body: SharedIn):
    if body.kind not in ("depense", "remboursement", "ignore"):
        raise HTTPException(422, "kind invalide")
    with pool.connection() as c:
        if not c.execute("SELECT 1 FROM transactions WHERE id = %s", (tx_id,)).fetchone():
            raise HTTPException(404, "opération inconnue")
        c.execute("""INSERT INTO shared_items (tx_id, kind, share_other, note) VALUES (%s,%s,%s,%s)
                     ON CONFLICT (tx_id) DO UPDATE SET kind = EXCLUDED.kind, share_other = EXCLUDED.share_other, note = EXCLUDED.note""",
                  (tx_id, body.kind, body.share_other, body.note))
    return {"ok": True}


@app.delete("/budget/shared/{tx_id}")
def shared_unset(tx_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM shared_items WHERE tx_id = %s", (tx_id,))
    return {"ok": True}


@app.get("/budget/settlement")
def settlement(months: int = 6):
    """Qui doit quoi à qui. Solde exprimé du point de vue du premier membre (A) : positif = B doit à A.
    Trois sources, détaillées : dépenses du foyer réglées par un seul (part due par l'autre), remboursements directs déjà
    faits, et écart de versements au compte commun (parts égales). Aucune estimation : tout vient d'opérations classées."""
    with pool.connection() as c:
        ps = _two_persons(c)
        if len(ps) < 2:
            return {"solde": 0, "lignes": [], "phrase": "Il faut deux membres dans le foyer."}
        a, b = ps
        rows = c.execute(
            f"""SELECT t.id, t.booked_on, t.amount, left(t.label, 60) AS label, s.kind, s.share_other, {_owner_sql()} AS payer_id
                FROM shared_items s JOIN transactions t ON t.id = s.tx_id WHERE s.kind IN ('depense', 'remboursement')
                ORDER BY t.booked_on""").fetchall()
    lines, total = [], 0.0
    for r in rows:
        amt = abs(float(r["amount"]))
        payer = r["payer_id"]
        if payer not in (a["id"], b["id"]):
            continue
        sign = 1 if payer == a["id"] else -1       # A a payé : B lui doit
        if r["kind"] == "depense":
            v = sign * amt * float(r["share_other"])
            what = f"Dépense du foyer payée par {a['name'] if sign > 0 else b['name']} ({int(float(r['share_other']) * 100)} % dû par l'autre)"
        else:
            if float(r["amount"]) >= 0:
                continue                            # seul le côté « débit » compte (l'autre côté est le même virement)
            v = sign * amt                          # A a viré à B : B doit plus à A ; B a viré à A : B doit moins à A
            what = f"Remboursement versé par {a['name'] if sign > 0 else b['name']}"
        lines.append({"date": r["booked_on"], "libelle": r["label"], "type": what, "montant": round(abs(float(r["amount"])), 2), "effet": round(v, 2)})
        total += v
    com = None
    try:
        cm = commun(months)
        full = [m for m in cm["months"]]
        if full:
            ra, rb = sum(m["alex"] for m in full), sum(m["sam"] for m in full)
            # A = premier membre ; les versements sont reconnus à « Alex » / « Sam » dans commun()
            va, vb = (ra, rb) if a["name"].lower().startswith("alex") else (rb, ra)
            soulte = (va - vb) / 2
            com = {"mois": len(full), "versements_a": round(va, 2), "versements_b": round(vb, 2), "effet": round(soulte, 2)}
            lines.append({"date": None, "libelle": f"Versements au compte commun sur {len(full)} mois : {a['name']} {va:,.0f} €, {b['name']} {vb:,.0f} €".replace(",", " "),
                          "type": "Écart de versements au compte commun (parts égales)", "montant": round(abs(va - vb), 2), "effet": round(soulte, 2)})
            total += soulte
    except Exception:  # noqa: BLE001
        com = None
    solde = round(total, 2)
    if abs(solde) < 1:
        phrase = "Vous êtes à l'équilibre."
    else:
        debiteur, creancier = (b["name"], a["name"]) if solde > 0 else (a["name"], b["name"])
        phrase = f"{debiteur} doit {abs(solde):,.2f} € à {creancier}.".replace(",", " ")
    return {"a": a["name"], "b": b["name"], "solde": solde, "phrase": phrase, "lignes": lines, "commun": com,
            "note": "Solde positif : le deuxième membre doit au premier. Seules les opérations classées (dépense du foyer, remboursement) sont comptées."}


@app.get("/budget/caps")
def caps(person: int | None = None):
    with pool.connection() as c:
        return c.execute("SELECT * FROM caps_status(%s)", (person,)).fetchall()


@app.put("/budget/caps/{category}")
def set_cap(category: str, body: CapIn):
    with pool.connection() as c:
        c.execute(
            """INSERT INTO category_caps VALUES (%s,%s,%s)
               ON CONFLICT (category) DO UPDATE SET monthly = EXCLUDED.monthly, alert_pct = EXCLUDED.alert_pct""",
            (category, body.monthly, body.alert_pct))
    return {"ok": True}


@app.delete("/budget/caps/{category}")
def delete_cap(category: str):
    with pool.connection() as c:
        c.execute("DELETE FROM category_caps WHERE category = %s", (category,))
    return {"ok": True}


# --- Objectifs ---

class GoalItem(BaseModel):
    label: str
    amount: Decimal


class GoalAccount(BaseModel):
    account_id: int
    share: Decimal = Decimal(1)


class GoalIn(BaseModel):
    name: str
    kind: str = "autre"
    person_id: int | None = None
    target_date: date
    priority: int = 1
    initial: Decimal = Decimal(0)
    status: str = "active"
    notes: str | None = None
    items: list[GoalItem] = []
    accounts: list[GoalAccount] = []


@app.get("/budget/goals")
def goals():
    return compute_goals()


class SimIn(BaseModel):
    goal_id: int
    target_date: date | None = None     # repousser / avancer l'échéance
    target_delta: Decimal = Decimal(0)  # réduire / augmenter le budget de l'objectif
    extra_monthly: Decimal = Decimal(0) # économies mensuelles supplémentaires (ex. -100 € d'achats en ligne)


@app.post("/budget/goals/simulate")
def simulate(sim: SimIn):
    """Recalcule le plan de TOUS les objectifs sous une hypothèse (mêmes règles que le plan réel)."""
    return compute_goals(sim)


def compute_goals(sim: "SimIn | None" = None):
    """Objectifs + plan chiffré + faisabilité : les besoins mensuels, cumulés par priorité,
    sont comparés à la capacité d'épargne réelle du périmètre (foyer ou personne)."""
    with pool.connection() as c:
        rows = c.execute(
            """SELECT g.*, p.name AS person, pl.target, pl.current, pl.remaining, pl.months_left,
                      pl.monthly_needed, pl.pace_monthly, pl.projected, pl.progress_pct,
                      COALESCE((SELECT json_agg(json_build_object('id', i.id, 'label', i.label, 'amount', i.amount)
                                                ORDER BY i.position, i.id) FROM goal_items i WHERE i.goal_id = g.id), '[]') AS items,
                      COALESCE((SELECT json_agg(json_build_object('account_id', a.id, 'name', a.name, 'share', ga.share))
                                FROM goal_accounts ga JOIN accounts a ON a.id = ga.account_id WHERE ga.goal_id = g.id), '[]') AS accounts
               FROM goals g LEFT JOIN persons p ON p.id = g.person_id JOIN goals_plan() pl ON pl.id = g.id
               ORDER BY g.status = 'active' DESC, g.priority, g.target_date"""
        ).fetchall()
    if sim:
        for g in rows:
            if g["id"] != sim.goal_id:
                continue
            if sim.target_date:
                g["target_date"] = sim.target_date
                g["months_left"] = max(Decimal((sim.target_date - date.today()).days) / Decimal("30.44"), Decimal(0))
            g["target"] = max(g["target"] + sim.target_delta, Decimal(0))
            g["remaining"] = max(g["target"] - g["current"], Decimal(0))
            g["monthly_needed"] = round(g["remaining"] / g["months_left"], 2) if g["months_left"] > 0 else None
            g["projected"] = round(g["current"] + ((g["pace_monthly"] or 0) + sim.extra_monthly) * g["months_left"], 2)
            g["progress_pct"] = round(min(100 * g["current"] / g["target"], 100), 1) if g["target"] else 0
        # re-trier par priorité puis échéance simulée
        rows.sort(key=lambda g: (g["status"] != "active", g["priority"], g["target_date"]))
    capacity: dict[int | None, Decimal] = {}
    used: dict[int | None, Decimal] = {}
    for g in rows:
        scope = g["person_id"]
        if scope not in capacity:
            capacity[scope] = (summary(scope).get("available") or Decimal(0)) + (sim.extra_monthly if sim else 0)
            used[scope] = Decimal(0)
        need = g["monthly_needed"] or Decimal(0)
        if g["status"] != "active":
            g["feasibility"] = None
            continue
        used[scope] += need
        cap = capacity[scope]
        # atteignable : les objectifs plus prioritaires + celui-ci tiennent dans la capacité réelle
        # ok : tient dans la capacité ; tight : dépasse de 25 % au plus ; out : au-delà
        g["feasibility"] = "ok" if used[scope] <= cap else ("tight" if used[scope] <= cap * Decimal("1.25") else "out")
        g["capacity"] = cap
        g["cumulative_needed"] = used[scope]
    return rows


def _save_goal(c, goal_id: int, g: GoalIn):
    c.execute("DELETE FROM goal_items WHERE goal_id = %s", (goal_id,))
    c.execute("DELETE FROM goal_accounts WHERE goal_id = %s", (goal_id,))
    for i, it in enumerate(g.items):
        c.execute("INSERT INTO goal_items (goal_id, label, amount, position) VALUES (%s,%s,%s,%s)",
                  (goal_id, it.label, it.amount, i))
    for a in g.accounts:
        c.execute("INSERT INTO goal_accounts VALUES (%s,%s,%s)", (goal_id, a.account_id, a.share))


@app.post("/budget/goals")
def create_goal(g: GoalIn):
    with pool.connection() as c:
        gid = c.execute(
            """INSERT INTO goals (name, kind, person_id, target_date, priority, initial, status, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (g.name, g.kind, g.person_id, g.target_date, g.priority, g.initial, g.status, g.notes)).fetchone()["id"]
        _save_goal(c, gid, g)
    return {"id": gid}


@app.put("/budget/goals/{goal_id}")
def update_goal(goal_id: int, g: GoalIn):
    with pool.connection() as c:
        if not c.execute(
                """UPDATE goals SET name=%s, kind=%s, person_id=%s, target_date=%s, priority=%s, initial=%s,
                   status=%s, notes=%s WHERE id=%s RETURNING id""",
                (g.name, g.kind, g.person_id, g.target_date, g.priority, g.initial, g.status, g.notes, goal_id)).fetchone():
            raise HTTPException(404)
        _save_goal(c, goal_id, g)
    return {"id": goal_id}


@app.delete("/budget/goals/{goal_id}")
def delete_goal(goal_id: int):
    with pool.connection() as c:
        c.execute("DELETE FROM goals WHERE id = %s", (goal_id,))
    return {"ok": True}



@app.get("/budget/forecast")
def forecast(person: int | None = None):
    with pool.connection() as c:
        return c.execute("SELECT * FROM balance_forecast(%s)", (person,)).fetchall()


@app.get("/budget/pay")
def pay():
    """Paies détectées par personne : dernière paie, montant moyen, jour habituel, prochaine paie attendue."""
    with pool.connection() as c:
        return c.execute("SELECT * FROM pay_profile()").fetchall()


@app.get("/budget/cashflow")
def cashflow(person: int | None = None, months: int = 12):
    """Entrées et sorties par mois civil, SANS les virements entre comptes du foyer (ils ne sont ni des revenus ni
    des dépenses). `transfers` : solde des virements internes du périmètre, donné à part."""
    with pool.connection() as c:
        return c.execute(
            """WITH s AS (SELECT EXISTS (SELECT 1 FROM account_holders GROUP BY account_id HAVING count(*) > 1) AS joint)
               SELECT to_char(date_trunc('month', t.booked_on), 'YYYY-MM') AS month,
                      COALESCE(sum(t.amount * w.w) FILTER (WHERE c.kind = 'income'
                               OR (%(p)s = -1 AND c.kind = 'internal' AND t.amount > 0 AND t.label ~* member_re())), 0) AS income,
                      COALESCE(-sum(t.amount * w.w) FILTER (WHERE c.kind IN ('fixed', 'variable')
                               OR (c.kind = 'household' AND (%(p)s IS NOT NULL OR NOT s.joint))), 0) AS expense,
                      COALESCE(-sum(t.amount * w.w) FILTER (WHERE c.kind = 'savings'), 0) AS savings,
                      COALESCE(sum(t.amount * w.w) FILTER (WHERE c.kind IN ('internal', 'household')
                               AND NOT (%(p)s = -1 AND t.amount > 0 AND t.label ~* member_re())), 0) AS transfers,
                      COALESCE(sum(t.amount * w.w) FILTER (WHERE c.kind = 'income'
                               OR (%(p)s = -1 AND c.kind = 'internal' AND t.amount > 0 AND t.label ~* member_re())), 0)
                      - COALESCE(-sum(t.amount * w.w) FILTER (WHERE c.kind IN ('fixed', 'variable')
                               OR (c.kind = 'household' AND (%(p)s IS NOT NULL OR NOT s.joint))), 0)
                      - COALESCE(-sum(t.amount * w.w) FILTER (WHERE c.kind = 'savings'), 0) AS net
               FROM transactions t JOIN account_weights(%(p)s) w USING (account_id)
               JOIN categories c ON c.code = t.category, s
               WHERE t.booked_on >= date_trunc('month', current_date) - make_interval(months => %(m)s - 1)
               GROUP BY 1 ORDER BY 1""", {"p": person, "m": months}).fetchall()


@app.get("/budget/household")
def household():
    """Versements au compte commun vs part des revenus. Équilibre « au prorata » : chacun verse la même
    proportion de ses revenus. Calculable seulement quand chaque personne a au moins un compte suivi."""
    with pool.connection() as c:
        rows = c.execute("SELECT * FROM household_split()").fetchall()
    tracked = all(r["tracked"] for r in rows)
    total_inc = sum(r["income"] for r in rows)
    total_con = sum(r["contribution"] for r in rows)
    for r in rows:
        r["income_share"] = round(100 * r["income"] / total_inc, 1) if total_inc else None
        r["fair_contribution"] = round(total_con * r["income"] / total_inc, 2) if tracked and total_inc else None
        r["effort_pct"] = round(100 * r["contribution"] / r["income"], 1) if r["income"] else None
    return {"complete": tracked, "total_contribution": total_con, "persons": rows}


@app.get("/budget/anomalies")
def anomalies(limit: int = 20):
    with pool.connection() as c:
        return c.execute(
            """SELECT a.*, t.booked_on, t.merchant, t.amount, t.label, c.label AS category_label
               FROM anomalies a JOIN transactions t ON t.id = a.tx_id JOIN categories c ON c.code = t.category
               ORDER BY t.booked_on DESC LIMIT %s""", (limit,)).fetchall()


# --- Résumé plat pour Home Assistant ---

def _f(v) -> float:
    return round(float(v or 0), 2)


@app.get("/budget/ha")
def ha():
    """Chiffres du tableau de bord Home Assistant (dict plat, poussé par le CronJob `ha-push` du ledger).
    30 jours glissants sur tous les comptes, SANS virements internes (internal/household) : revenus = income,
    dépenses = fixed + variable, épargne à part. Cas vides tolérés : 0 pour un nombre, "" pour une date."""
    with pool.connection() as c:
        m = c.execute(
            """SELECT COALESCE(sum(t.amount) FILTER (WHERE k.kind = 'income'), 0) AS income,
                      COALESCE(-sum(t.amount) FILTER (WHERE k.kind IN ('fixed', 'variable')), 0) AS expense,
                      COALESCE(-sum(t.amount) FILTER (WHERE k.kind = 'savings'), 0) AS savings
               FROM transactions t JOIN account_weights(NULL) w USING (account_id)
               JOIN categories k ON k.code = t.category
               WHERE t.booked_on > current_date - 30""").fetchone()
        persons = c.execute("SELECT id, name FROM persons ORDER BY id").fetchall()
        pays = {r["person_id"]: r["next_date"] for r in c.execute("SELECT person_id, next_date FROM pay_profile()").fetchall()}
        today = c.execute("SELECT current_date AS d").fetchone()["d"]
        commun = c.execute("SELECT COALESCE(sum(balance), 0) AS solde, COALESCE(sum(projected), 0) AS prevu "
                           "FROM balance_forecast(-1)").fetchone()
        cur = c.execute("SELECT spent, typical_to_date FROM current_cycle(NULL)").fetchone() or {}
        perso = {p["id"]: _f(c.execute("SELECT COALESCE(sum(projected), 0) AS v FROM balance_forecast(%s)",
                                       (p["id"],)).fetchone()["v"]) for p in persons}
    buf = summary(None).get("buffer") or {}
    maison = next((g for g in compute_goals() if g["kind"] == "maison" and g["status"] == "active"), None) or {}
    dates = [d for d in pays.values() if d]
    prochaine = min(dates) if dates else None
    out = {
        "income_30d": _f(m["income"]),
        "expense_30d": _f(m["expense"]),
        "net_30d": _f(m["income"] - m["expense"] - m["savings"]),
        "commun_solde": _f(commun["solde"]),
        "commun_prevu": _f(commun["prevu"]),
        "coussin_cible": _f(buf.get("target")),
        "coussin_liquide": _f(buf.get("liquid")),
        "coussin_ok": int(bool(buf) and buf["liquid"] >= buf["target"]),
        "paie_prochaine": prochaine.isoformat() if prochaine else "",
        "paie_jours": (prochaine - today).days if prochaine else 0,
        "maison_reuni": _f(maison.get("current")),
        "maison_cible": _f(maison.get("target")),
        "maison_effort": _f(maison.get("monthly_needed")),
        "maison_pct": _f(maison.get("progress_pct")),
        "cycle_depense": _f(cur.get("spent")),
        "cycle_habituel": _f(cur.get("typical_to_date")),
    }
    for p in persons:
        key = re.sub(r"[^a-z0-9]+", "_", p["name"].strip().lower()).strip("_")
        d = pays.get(p["id"])
        out[f"paie_{key}_date"] = d.isoformat() if d else ""
        out[f"solde_prevu_{key}"] = perso[p["id"]]
    return out
# --- Fiscalité (L2) : profil fiscal, règles datées (tax_rules), calculs déterministes ---

SAVINGS_KINDS = {"livret_a": "Livret A", "ldds": "LDDS", "lep": "LEP"}
ENVELOPE_YEARS = {"pea": "pea.duree_ans", "assurance_vie": "av.duree_ans"}  # seuil d'ancienneté fiscale


_KIND_LEP = re.compile(r"\bLEP\b|[EÉé]PARGNE POPULAIRE", re.I)
_KIND_LDDS = re.compile(r"\bLDDS?\b|D[EÉé]VELOPPEMENT DURABLE|DEV\.? DURABLE", re.I)
_KIND_LA = re.compile(r"LIVRET A\b|LIVRET BLEU", re.I)     # Livret Bleu = Livret A d'une banque mutualiste


def infer_savings_kind(name: str) -> str | None:
    """Nature d'un livret d'après son nom (même règle que la migration 015, pour les comptes créés depuis)."""
    if _KIND_LEP.search(name):
        return "lep"
    if _KIND_LDDS.search(name):
        return "ldds"
    if _KIND_LA.search(name):
        return "livret_a"
    return None


def load_rules(c) -> tuple[int | None, dict[str, dict]]:
    """Règles de l'année en cours (ou de la dernière année disponible avant)."""
    y = c.execute("SELECT max(year) AS y FROM tax_rules WHERE year <= %s", (date.today().year,)).fetchone()["y"]
    if y is None:
        return None, {}
    return y, {r["key"]: r for r in c.execute("SELECT * FROM tax_rules WHERE year = %s ORDER BY key", (y,)).fetchall()}


def load_profile(c, year: int | None = None) -> dict:
    """Profil fiscal d'une année de revenus (par défaut la plus récente). Ligne foyer présente = déclaration commune."""
    y = year or c.execute("SELECT max(income_year) AS y FROM tax_profile").fetchone()["y"]
    rows = c.execute("SELECT * FROM tax_profile WHERE income_year = %s", (y,)).fetchall() if y else []
    foyer = next((r for r in rows if r["person_id"] is None), None)
    return {"income_year": y, "joint": foyer is not None, "foyer": foyer,
            "persons": {r["person_id"]: r for r in rows if r["person_id"] is not None}}


def lep_ceiling(rules: dict, parts: Decimal) -> Decimal:
    """RFR maximal : base 1 part + majoration par demi-part (un quart de part = moitié de la majoration)."""
    return round(rules["lep.rfr.base"]["value"] + (parts - 1) * 2 * rules["lep.rfr.demi_part"]["value"], 0)


@app.get("/budget/fiscal/rules")
def fiscal_rules():
    with pool.connection() as c:
        y, rules = load_rules(c)
    return {"year": y, "items": list(rules.values())}


@app.get("/budget/fiscal/profile")
def fiscal_profile(year: int | None = None):
    with pool.connection() as c:
        p = load_profile(c, year)
        persons = c.execute("SELECT id, name FROM persons ORDER BY id").fetchall()
    f = p["foyer"] or {}
    return {
        "income_year": p["income_year"], "joint": p["joint"], "rfr": f.get("rfr"), "parts": f.get("parts"),
        "persons": [{"person_id": x["id"], "name": x["name"],
                     **{k: (p["persons"].get(x["id"]) or {}).get(k) for k in
                        ("rfr", "parts", "earned_income", "per_ceiling_notice", "per_paid")}} for x in persons],
    }


class TaxPersonIn(BaseModel):
    person_id: int
    rfr: Decimal | None = None
    parts: Decimal | None = None
    earned_income: Decimal | None = None
    per_ceiling_notice: Decimal | None = None
    per_paid: Decimal | None = None


class TaxProfileIn(BaseModel):
    income_year: int
    joint: bool                  # mariés / pacsés : une seule déclaration (RFR et parts du foyer)
    rfr: Decimal | None = None
    parts: Decimal | None = None
    persons: list[TaxPersonIn] = []


def _check_parts(parts: Decimal | None):
    if parts is not None and (parts < 1 or (parts * 4) % 1):
        raise HTTPException(422, "Nombre de parts : au moins 1, par quart de part")


@app.put("/budget/fiscal/profile")
def put_fiscal_profile(p: TaxProfileIn):
    _check_parts(p.parts)
    for x in p.persons:
        _check_parts(x.parts)
    with pool.connection() as c:
        c.execute("DELETE FROM tax_profile WHERE income_year = %s", (p.income_year,))
        if p.joint:
            c.execute("INSERT INTO tax_profile (income_year, person_id, rfr, parts) VALUES (%s, NULL, %s, %s)",
                      (p.income_year, p.rfr, p.parts))
        for x in p.persons:
            c.execute(
                """INSERT INTO tax_profile (income_year, person_id, rfr, parts, earned_income, per_ceiling_notice, per_paid)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (p.income_year, x.person_id, None if p.joint else x.rfr, None if p.joint else x.parts,
                 x.earned_income, x.per_ceiling_notice, x.per_paid))
    return fiscal_profile(p.income_year)


class FiscalAccountIn(BaseModel):
    opened_on: date | None = None
    savings_kind: str | None = None


@app.put("/budget/fiscal/accounts/{account_id}")
def put_fiscal_account(account_id: int, body: FiscalAccountIn):
    """Date d'ouverture (ancienneté fiscale) et nature du livret ; seuls les champs envoyés sont modifiés."""
    sent = body.model_fields_set
    with pool.connection() as c:
        acc = c.execute("SELECT type FROM accounts WHERE id = %s", (account_id,)).fetchone()
        if not acc:
            raise HTTPException(404)
        if "savings_kind" in sent:
            if acc["type"] != "livret":
                raise HTTPException(422, "Nature réservée aux livrets")
            if body.savings_kind not in (None, "autre", *SAVINGS_KINDS):
                raise HTTPException(422, "Nature de livret inconnue")
            c.execute("UPDATE accounts SET savings_kind = %s WHERE id = %s", (body.savings_kind, account_id))
        if "opened_on" in sent:
            if body.opened_on and body.opened_on > date.today():
                raise HTTPException(422, "Date d'ouverture dans le futur")
            c.execute("UPDATE accounts SET opened_on = %s WHERE id = %s", (body.opened_on, account_id))
    return {"ok": True}


@app.get("/budget/fiscal/summary")
def fiscal_summary(person: int | None = None):
    """Tous les chiffres fiscaux du périmètre : LEP, PER, ancienneté AV/PEA, place sous les plafonds des livrets."""
    today = date.today()
    with pool.connection() as c:
        rules_year, R = load_rules(c)
        prof = load_profile(c)
        persons = c.execute("SELECT id, name FROM persons WHERE %s::int IS NULL OR id = %s ORDER BY id",
                            (person, person)).fetchall()
        envelopes = c.execute(
            """SELECT a.id, a.name, a.institution, a.type, a.opened_on,
                      string_agg(p.name, ' / ' ORDER BY p.id) AS holders,
                      round((current_date - a.opened_on) / 365.25, 1) AS years
               FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id
               LEFT JOIN account_holders h ON h.account_id = a.id LEFT JOIN persons p ON p.id = h.person_id
               WHERE a.active AND a.type IN ('pea','assurance_vie','per')
               GROUP BY a.id ORDER BY a.type, a.opened_on NULLS LAST""", (person,)).fetchall()
        livrets = c.execute(
            """SELECT a.id, a.name, a.institution, a.savings_kind, a.opened_on, v.balance, v.day,
                      COALESCE(array_agg(h.person_id ORDER BY h.person_id) FILTER (WHERE h.person_id IS NOT NULL), '{}') AS holder_ids
               FROM account_weights(%s) w JOIN accounts a ON a.id = w.account_id
               LEFT JOIN account_holders h ON h.account_id = a.id
               LEFT JOIN LATERAL (SELECT balance, day FROM valuations WHERE account_id = a.id AND NOT estimated
                                  ORDER BY day DESC LIMIT 1) v ON true
               WHERE a.active AND a.type = 'livret'
               GROUP BY a.id, v.balance, v.day ORDER BY a.name""", (person,)).fetchall()
        per_trades = {r["person_id"]: r["paid"] for r in c.execute(
            """SELECT h.person_id, round(sum((tr.quantity * COALESCE(tr.price, 0) + tr.fees) * h.share), 2) AS paid
               FROM trades tr JOIN accounts a ON a.id = tr.account_id AND a.type = 'per'
               JOIN account_holders h ON h.account_id = a.id
               WHERE tr.kind = 'achat' AND tr.day >= date_trunc('year', current_date) GROUP BY h.person_id""").fetchall()}

    if not R:
        return {"rules_year": None, "warnings": ["Aucune règle fiscale en base (table tax_rules)"]}
    warnings: list[str] = []
    unverified = sorted(k for k, r in R.items() if not r["verified"])
    if prof["income_year"] is None:
        warnings.append("Profil fiscal non renseigné : éligibilité LEP inconnue, plafond PER réduit au plancher.")
    elif prof["income_year"] < today.year - 2:
        warnings.append(f"Profil fiscal des revenus {prof['income_year']} : le LEP de {today.year} s'apprécie sur les "
                        f"revenus {today.year - 2} ou {today.year - 1}.")

    # LEP : éligibilité par personne (foyer fiscal commun ou déclaration séparée)
    lep = []
    for x in persons:
        src = prof["foyer"] if prof["joint"] else prof["persons"].get(x["id"])
        row = {"person_id": x["id"], "name": x["name"], "income_year": prof["income_year"],
               "basis": "foyer" if prof["joint"] else "individuel", "rfr": None, "parts": None,
               "ceiling": None, "margin": None, "eligible": None}
        if src and src["rfr"] is not None and src["parts"] is not None:
            ceil = lep_ceiling(R, src["parts"])
            row.update(rfr=src["rfr"], parts=src["parts"], ceiling=ceil, margin=ceil - src["rfr"],
                       eligible=src["rfr"] <= ceil)
        lep.append(row)
    lep_ok = {r["person_id"]: r["eligible"] for r in lep}

    # PER : plafond de déduction des versements de l'année (revenus d'activité de l'année précédente)
    pass_ = R["per.pass"]["value"]
    rate = R["per.taux"]["value"] / 100
    floor_, cap = rate * R["per.plancher_pass"]["value"] * pass_, rate * R["per.plafond_pass"]["value"] * pass_
    if prof["income_year"] is not None and prof["income_year"] != today.year - 1:
        warnings.append(f"Plafond PER {today.year} : il se calcule sur les revenus {today.year - 1} "
                        f"(profil saisi : revenus {prof['income_year']}).")
    per = []
    for x in persons:
        p = prof["persons"].get(x["id"]) or {}
        if p.get("per_ceiling_notice") is not None:
            ceiling, source = p["per_ceiling_notice"], "avis"
        elif p.get("earned_income") is not None:
            ceiling, source = max(min(rate * p["earned_income"], cap), floor_), "estimation"
        else:
            ceiling, source = floor_, "plancher"
        paid = p["per_paid"] if p.get("per_paid") is not None else per_trades.get(x["id"], Decimal(0))
        per.append({"person_id": x["id"], "name": x["name"], "ceiling": round(ceiling, 2), "source": source,
                    "paid": paid, "paid_source": "saisi" if p.get("per_paid") is not None else "opérations",
                    "remaining": round(max(ceiling - paid, Decimal(0)), 2)})

    # Ancienneté fiscale AV / PEA (PER : ancienneté indicative, pas de seuil)
    av_basis = "couple" if prof["joint"] else ("seul" if prof["persons"] else None)
    for e in envelopes:
        key = ENVELOPE_YEARS.get(e["type"])
        e["threshold_years"] = int(R[key]["value"]) if key else None
        e["threshold_date"] = e["reached"] = e["days_left"] = None
        if key and e["opened_on"]:
            o = e["opened_on"]
            try:
                t = o.replace(year=o.year + e["threshold_years"])
            except ValueError:  # 29 février
                t = o.replace(year=o.year + e["threshold_years"], day=28)
            e.update(threshold_date=t, reached=t <= today, days_left=max((t - today).days, 0))
        if not e["opened_on"]:
            warnings.append(f"Date d'ouverture manquante : {e['name']} (ancienneté fiscale inconnue).")

    # Livrets réglementés : place restante sous le plafond, par personne et par nature
    by_kind_person: dict[tuple[str, int], list[dict]] = {}
    for lv in livrets:
        lv["holder_ids"] = list(lv["holder_ids"])
        lv["savings_kind"] = lv["savings_kind"] or infer_savings_kind(lv["name"])
        if lv["savings_kind"] in SAVINGS_KINDS:
            for pid in lv["holder_ids"]:
                by_kind_person.setdefault((lv["savings_kind"], pid), []).append(lv)
            if not lv["holder_ids"]:
                warnings.append(f"Livret sans titulaire : {lv['name']} (place restante non attribuée).")
        elif lv["savings_kind"] is None:
            warnings.append(f"Nature du livret à préciser : {lv['name']} (Livret A, LDDS, LEP ou autre).")
    regulated, totals = [], []
    for kind, label in SAVINGS_KINDS.items():
        plafond = R[f"{kind}.plafond"]["value"]
        t = {"kind": kind, "label": label, "ceiling": plafond, "held": 0, "remaining_held": Decimal(0), "openable": 0}
        for x in persons:
            accs = by_kind_person.get((kind, x["id"]), [])
            balance = sum((a["balance"] or Decimal(0) for a in accs), Decimal(0))
            row = {"kind": kind, "label": label, "person_id": x["id"], "name": x["name"], "ceiling": plafond,
                   "held": bool(accs), "accounts": [a["id"] for a in accs], "balance": balance if accs else None,
                   "remaining": None, "can_open": None}
            if accs:
                row["remaining"] = max(plafond - balance, Decimal(0))
                t["held"] += 1
                t["remaining_held"] += row["remaining"]
            else:
                # LEP : ouvrable seulement si éligible (None = éligibilité inconnue)
                row["can_open"] = lep_ok.get(x["id"]) if kind == "lep" else True
                t["openable"] += 1 if row["can_open"] else 0
            regulated.append(row)
        totals.append(t)

    return {
        "rules_year": rules_year, "unverified_rules": unverified, "profile_year": prof["income_year"],
        "joint": prof["joint"], "lep": lep,
        "per": {"pass": pass_, "floor": round(floor_, 2), "cap": round(cap, 2), "items": per},
        "envelopes": envelopes,
        "av_allowance": {"basis": av_basis, "value": R[f"av.abattement.{av_basis}"]["value"] if av_basis else None},
        "livrets": {"accounts": livrets, "items": regulated, "totals": totals},
        "warnings": warnings,
    }
