"""Rapport mensuel : classeur Excel « situation financière » de Alex, d'Sam et du foyer.

Un classeur par mois (CronJob `monthly-report` le 1er à 08:00, ou bouton « Générer maintenant » de la page Export) :
synthèse, une feuille par personne, le compte commun, l'évolution de chaque compte (graphes séparés par classe pour que
les gros montants n'écrasent pas la trésorerie), les dépenses à éviter, les conseils de l'IA, les objectifs et les opérations.

Aucun calcul financier ici : tous les chiffres viennent du ledger et du budget-engine ; les conseils viennent du conseiller.
python -m app.monthly [--dry-run fichier.xlsx]
"""
import html
import io
import os
import re
import smtplib
import ssl
import sys
from datetime import date, datetime
from email.message import EmailMessage

import httpx
from openpyxl import Workbook
from openpyxl.chart import AreaChart, BarChart, DoughnutChart, LineChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from . import export as ex

LEDGER = os.environ.get("LEDGER_URL", "http://ledger:8000")
BUDGET = os.environ.get("BUDGET_URL", "http://budget-engine:8000")
ADVISOR = os.environ.get("ADVISOR_URL", "http://advisor:8000")

NAVY, BLUE, SOFT, GREY = "1F3A5F", "2A78D6", "EAF1FB", "6F6D67"
H_FILL = PatternFill("solid", fgColor=NAVY)
S_FILL = PatternFill("solid", fgColor=SOFT)
THIN = Side(style="thin", color="D9D4C5")
EUR0 = '#,##0 "€"'
PRIO = {"haute": "Haute", "moyenne": "Moyenne", "basse": "Basse"}
HORIZON = {"immediat": "Immédiat", "ce_mois": "Ce mois-ci", "trimestre": "Ce trimestre", "long_terme": "Long terme"}
CLASS = {"courant": "Comptes courants", "livret": "Livrets", "placements": "Placements et épargne bloquée"}


def f(v) -> float:
    return float(v or 0)


def fr_short(s) -> str:
    return date.fromisoformat(str(s)[:10]).strftime("%d/%m/%y")


def fact_text(fact: dict) -> str:
    v = fact.get("value")
    shown = f"{v:,.2f}".replace(",", " ").replace(".00", "") if isinstance(v, (int, float)) else str(v)
    return f"{fact['label']} : {shown} {fact.get('unit') or ''}".strip()


def fr_date(s) -> str:
    return date.fromisoformat(str(s)[:10]).strftime("%d/%m/%Y")


# ---------------------------------------------------------------- collecte

def get(h: httpx.Client, base: str, path: str, **params):
    r = h.get(base + path, params={k: v for k, v in params.items() if v is not None})
    r.raise_for_status()
    return r.json()


def safe(h, base, path, default, **params):
    """Une section qui échoue ne doit pas empêcher le rapport : elle est signalée et laissée vide."""
    try:
        return get(h, base, path, **params)
    except Exception as e:  # noqa: BLE001
        print(f"[monthly] {path} indisponible : {e}", file=sys.stderr)
        return default


def person_data(h, pid: int) -> dict:
    cur = safe(h, BUDGET, "/budget/current", {}, person=pid)
    bd = safe(h, BUDGET, "/budget/breakdown", [], person=pid, cycle=cur.get("cycle")) if cur.get("cycle") else []
    return {
        "summary": safe(h, LEDGER, "/summary", {}, person=pid),
        "history": safe(h, LEDGER, "/networth/history", [], person=pid, days=365),
        "accounts_hist": safe(h, LEDGER, "/networth/accounts", [], person=pid, days=365, step=7),
        "cashflow": safe(h, BUDGET, "/budget/cashflow", [], person=pid, months=8),
        "current": cur,
        "breakdown": bd,
        "avoidable": safe(h, BUDGET, "/budget/avoidable", {"groups": []}, person=pid),
        "pay": [p for p in safe(h, BUDGET, "/budget/pay", [], ) if p.get("person_id") == pid],
    }


def gather() -> dict:
    with httpx.Client(timeout=90) as h:
        persons = get(h, LEDGER, "/persons")
        accounts = get(h, LEDGER, "/accounts")
        d = {"generated": datetime.now(), "persons": persons, "accounts": accounts}
        d["scopes"] = {p["id"]: {"name": p["name"], **person_data(h, p["id"])} for p in persons}
        d["all"] = {"summary": safe(h, LEDGER, "/summary", {}), "history": safe(h, LEDGER, "/networth/history", [], days=365),
                    "accounts_hist": safe(h, LEDGER, "/networth/accounts", [], days=365, step=7)}
        d["commun"] = safe(h, BUDGET, "/budget/commun", {"months": [], "avg": None})
        d["goals"] = safe(h, BUDGET, "/budget/goals", [])
        d["recos"] = safe(h, ADVISOR, "/advisor/recommendations", [], limit=12)
        d["docs"] = safe(h, ADVISOR, "/advisor/docs", {})
        d["savings"] = safe(h, ADVISOR, "/advisor/savings", {})
        d["settlement"] = safe(h, BUDGET, "/budget/settlement", {})
        d["shared"] = safe(h, BUDGET, "/budget/shared", {"items": [], "candidates": []})
        d["transfers"] = safe(h, BUDGET, "/budget/transfers", {"nodes": [], "edges": []})
        d["pays"] = safe(h, BUDGET, "/budget/pay", [])
        txs = ex.collect(None, 12)["transactions"]
        d["transactions"] = txs
    return d


# ---------------------------------------------------------------- mise en forme

def title(ws, text: str, sub: str = ""):
    ws["A1"] = text
    ws["A1"].font = Font(bold=True, size=18, color=NAVY)
    if sub:
        ws["A2"] = sub
        ws["A2"].font = Font(italic=True, color=GREY)
    ws.sheet_view.showGridLines = False


def section(ws, row: int, text: str, width: int = 6):
    for c in range(1, width + 1):
        ws.cell(row, c).fill = S_FILL
    ws.cell(row, 1, text).font = Font(bold=True, size=12, color=NAVY)
    return row + 1


def table(ws, row: int, headers: list[str], rows: list[list], col: int = 1, money_cols: tuple = (), wrap_cols: tuple = ()) -> tuple[int, int]:
    """Écrit un tableau et renvoie (première ligne de données, dernière ligne). money_cols/wrap_cols : indices 0-based."""
    for j, hd in enumerate(headers):
        c = ws.cell(row, col + j, hd)
        c.font, c.fill = Font(bold=True, color="FFFFFF"), H_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for i, r in enumerate(rows, 1):
        for j, v in enumerate(r):
            c = ws.cell(row + i, col + j, v)
            c.border = Border(bottom=THIN)
            c.alignment = Alignment(vertical="top", wrap_text=j in wrap_cols)
            if j in money_cols and isinstance(v, (int, float)):
                c.number_format = EUR0 if abs(v) >= 100 else ex.EUR
    return row + 1, row + len(rows)


def widths(ws, spec: dict[str, float]):
    for letter, w in spec.items():
        ws.column_dimensions[letter].width = w


def ref(ws, c1: int, r1: int, r2: int, c2: int | None = None):
    return Reference(ws, min_col=c1, max_col=c2 or c1, min_row=r1, max_row=r2)


def style(ch, w: float = 17, h: float = 8):
    ch.width, ch.height = w, h
    for ax in ("x_axis", "y_axis"):
        if hasattr(ch, ax):
            getattr(ch, ax).delete = False
    return ch


def classes(history: list[dict]) -> list[list]:
    real = [p for p in history if p.get("known", 1) > 0]          # pas de courbe avant le premier solde réel
    return [[fr_short(p["day"]), f(p["courant"]), f(p["livret"]), f(p["placements"])] for p in real[::7] + real[-1:]]


def last_vs(history: list[dict], days: int = 30) -> tuple[float | None, float | None]:
    if not history:
        return None, None
    now = f(history[-1]["total"])
    ref_p = history[max(0, len(history) - 1 - days)]
    return now, now - f(ref_p["total"])


# ---------------------------------------------------------------- feuilles

def sheet_person(wb, d: dict, pid: int):
    s = d["scopes"][pid]
    ws = wb.create_sheet(s["name"])
    title(ws, f"{s['name']} — situation au {d['generated']:%d/%m/%Y}", "Comptes personnels. Les comptes ajoutés récemment sont reportés à leur premier solde connu (courbes estimées avant).")
    widths(ws, {"A": 34, "B": 16, "C": 16, "D": 16, "E": 16, "F": 16})
    hist = s["history"]
    now, delta = last_vs(hist)
    last = hist[-1] if hist else {}
    r = section(ws, 4, "Chiffres clés")
    kp = [("Patrimoine total", now), ("Variation sur 30 jours (périmètre constant)", delta),
          ("Comptes courants", f(last.get("courant"))), ("Livrets", f(last.get("livret"))),
          ("Placements et épargne bloquée", f(last.get("placements")))]
    cur = s["current"]
    if cur:
        kp += [("Dépensé ce cycle", f(cur.get("spent"))), ("Entré ce cycle", f(cur.get("income"))),
               ("Prélèvements à venir avant la paie", f(cur.get("upcoming_total")))]
    for k, v in kp:
        ws.cell(r, 1, k).font = Font(bold=True)
        c = ws.cell(r, 2, v)
        c.number_format = '+#,##0 "€";-#,##0 "€"' if "Variation" in k else EUR0
        r += 1
    for p in s["pay"]:
        ws.cell(r, 1, "Paie moyenne / prochaine").font = Font(bold=True)
        ws.cell(r, 2, f(p["avg_amount"])).number_format = EUR0
        ws.cell(r, 3, fr_date(p["next_date"]))
        r += 1
    r += 1
    # tableaux de données (les graphes à droite les lisent)
    r = section(ws, r, "Évolution du patrimoine par classe (hebdomadaire, 12 mois)")
    first, lastr = table(ws, r, ["Date", CLASS["courant"], CLASS["livret"], CLASS["placements"]], classes(hist), money_cols=(1, 2, 3))
    n_hist = lastr - first + 1
    charts_col = "H"
    if n_hist > 1:
        a = style(AreaChart(), 18, 8.5)
        a.grouping, a.title = "stacked", "Patrimoine par classe de compte"
        a.add_data(ref(ws, 2, first - 1, lastr, 4), titles_from_data=True)
        a.set_categories(ref(ws, 1, first, lastr))
        ws.add_chart(a, f"{charts_col}4")
        ln = style(LineChart(), 18, 7.5)
        ln.title = "Comptes courants (trésorerie) — échelle propre"
        ln.add_data(ref(ws, 2, first - 1, lastr), titles_from_data=True)
        ln.set_categories(ref(ws, 1, first, lastr))
        ln.legend = None
        ws.add_chart(ln, f"{charts_col}22")
    r = lastr + 2
    r = section(ws, r, "Entrées et sorties par mois (hors virements entre comptes)")
    cf = [[m["month"], f(m["income"]), f(m["expense"]), f(m["net"])] for m in s["cashflow"]]
    first, lastr = table(ws, r, ["Mois", "Entrées", "Sorties", "Solde du mois"], cf, money_cols=(1, 2, 3))
    if cf:
        b = style(BarChart(), 18, 8)
        b.type, b.title = "col", "Entrées et sorties par mois"
        b.add_data(ref(ws, 2, first - 1, lastr, 3), titles_from_data=True)
        b.set_categories(ref(ws, 1, first, lastr))
        ws.add_chart(b, f"{charts_col}38")
    r = lastr + 2
    r = section(ws, r, "Où part l'argent ce cycle (fixes et variables)")
    rows = sorted(([x["label"], -f(x["amount"])] for x in s["breakdown"] if x["kind"] in ("fixed", "variable") and f(x["amount"]) < 0),
                  key=lambda x: -x[1])[:12]
    first, lastr = table(ws, r, ["Poste", "Dépensé"], rows, money_cols=(1,))
    if rows:
        hb = style(BarChart(), 18, 9)
        hb.type, hb.title = "bar", "Postes de dépenses du cycle en cours"
        hb.add_data(ref(ws, 2, first - 1, lastr), titles_from_data=True)
        hb.set_categories(ref(ws, 1, first, lastr))
        hb.legend = None
        ws.add_chart(hb, f"{charts_col}55")
    r = lastr + 2
    r = section(ws, r, "Comptes")
    mine = [a for a in d["accounts"] if any(x["person_id"] == pid for x in a["holders"])]
    first, lastr = table(ws, r, ["Compte", "Établissement", "Type", "Solde", "Part", "Valorisé le"],
                         [[a["name"], a["institution"] or "—", ex.TYPE.get(a["type"], a["type"]), f(a["balance"]),
                           f(next((x["share"] for x in a["holders"] if x["person_id"] == pid), 0)),
                           fr_date(a["day"]) if a.get("day") else ""] for a in mine], money_cols=(3,))
    for rr in range(first, lastr + 1):
        ws.cell(rr, 5).number_format = "0%"
    ws.freeze_panes = "A4"


def sheet_synthese(wb, d: dict):
    ws = wb.active
    ws.title = "Synthèse"
    title(ws, f"Situation financière — {fr_month(d['generated'])}", f"Généré le {d['generated']:%d/%m/%Y à %H:%M}. Alex, Sam et le compte commun.")
    widths(ws, {"A": 36, "B": 18, "C": 18, "D": 18, "E": 18, "F": 18})
    r = section(ws, 4, "Patrimoine par personne")
    rows = []
    for pid, s in d["scopes"].items():
        now, delta = last_vs(s["history"])
        l = s["history"][-1] if s["history"] else {}
        rows.append([s["name"], now or 0, delta or 0, f(l.get("courant")), f(l.get("livret")), f(l.get("placements"))])
    commun = d["commun"]
    foyer = next((a for a in d["accounts"] if len(a["holders"]) > 1), None)
    if foyer:
        rows.append(["Compte commun (part de chacun incluse ci-dessus à 50 %)", f(foyer["balance"]), 0, f(foyer["balance"]), 0, 0])
    first, lastr = table(ws, r, ["", "Total", "Variation 30 j", CLASS["courant"], CLASS["livret"], CLASS["placements"]], rows, money_cols=(1, 2, 3, 4, 5))
    for rr in range(first, lastr + 1):
        ws.cell(rr, 3).number_format = '+#,##0 "€";-#,##0 "€"'
    n_pers = len(d["scopes"])
    if n_pers:
        dn = style(DoughnutChart(), 11, 8.5)
        dn.title = "Répartition du patrimoine"
        dn.add_data(ref(ws, 2, first - 1, first - 1 + n_pers), titles_from_data=True)
        dn.set_categories(ref(ws, 1, first, first + n_pers - 1))
        dn.dataLabels = DataLabelList()
        dn.dataLabels.showPercent = True
        ws.add_chart(dn, "H4")
        st = style(BarChart(), 17, 8.5)
        st.type, st.grouping, st.overlap = "col", "stacked", 100
        st.title = "Composition par personne (courants, livrets, placements)"
        st.add_data(ref(ws, 4, first - 1, first - 1 + n_pers, 6), titles_from_data=True)
        st.set_categories(ref(ws, 1, first, first + n_pers - 1))
        ws.add_chart(st, "H22")
    r = lastr + 2
    r = section(ws, r, "Compte commun : versez-vous assez ?")
    a = commun.get("avg")
    if a:
        kp = [("Versements moyens par mois (3 derniers mois civils)", a["versements"]), ("   dont Alex", a["alex"]), ("   dont Sam", a["sam"]),
              ("Charges moyennes du compte commun par mois", a["charges"]), ("Marge moyenne par mois", a["marge"])]
        for k, v in kp:
            ws.cell(r, 1, k).font = Font(bold=True)
            ws.cell(r, 2, v).number_format = EUR0
            r += 1
        if a.get("couverture_pct") is not None:
            ws.cell(r, 1, "Couverture des charges").font = Font(bold=True)
            ws.cell(r, 2, a["couverture_pct"] / 100).number_format = "0%"
            r += 1
    else:
        ws.cell(r, 1, "Pas assez d'historique sur le compte commun.")
        r += 1
    r += 1
    r = section(ws, r, "Objectifs")
    goals = [[g["name"], f(g["current"]), f(g["target"]), f(g["progress_pct"]) / 100, fr_date(g["target_date"])] for g in d["goals"] if g.get("status") == "active"]
    first, lastr = table(ws, r, ["Objectif", "Atteint", "Cible", "Avancement", "Échéance"], goals, money_cols=(1, 2))
    for rr in range(first, lastr + 1):
        ws.cell(rr, 4).number_format = "0%"
    r = lastr + 2
    r = section(ws, r, "Fiabilité des données (à lire)")
    notes = []
    manual = [x for x in d["accounts"] if x["source"] == "manuel"]
    if manual:
        oldest = min(fr_date(x["day"]) for x in manual if x.get("day")) if any(x.get("day") for x in manual) else "?"
        notes.append(f"{len(manual)} comptes sont saisis à la main (soldes à mettre à jour ; plus ancien : {oldest}).")
    notes.append("Les graphes d'évolution reportent chaque compte à son dernier solde connu ; avant l'ajout d'un compte, son premier solde est repris (zone « estimée »).")
    notes.append("Les virements entre vos comptes ne sont ni revenus ni dépenses. Les conseils de l'IA citent des chiffres calculés, jamais inventés.")
    for n in notes:
        ws.cell(r, 1, "• " + n).alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        ws.row_dimensions[r].height = 32
        r += 1


def sheet_foyer(wb, d: dict):
    ws = wb.create_sheet("Compte commun")
    title(ws, "Compte commun — verse-t-on assez ?", "Versements reçus de chacun et charges payées, par mois civil (hors virements internes). Calcul sur les opérations réelles.")
    widths(ws, {"A": 16, "B": 16, "C": 16, "D": 16, "E": 16, "F": 16, "G": 18})
    months = d["commun"].get("months", [])
    rows = [[m["month"], m["alex"], m["sam"], m["versements"], m["charges"], m["marge"], m["autres_entrees"]] for m in months]
    first, lastr = table(ws, 4, ["Mois", "Alex", "Sam", "Versements", "Charges", "Marge", "Autres entrées (ponctuelles)"], rows, money_cols=(1, 2, 3, 4, 5, 6))
    if rows:
        bar = style(BarChart(), 18, 9)
        bar.type, bar.grouping, bar.overlap = "col", "stacked", 100
        bar.title = "Versements (Alex + Sam) et charges du compte commun"
        bar.add_data(ref(ws, 2, first - 1, lastr, 3), titles_from_data=True)
        bar.set_categories(ref(ws, 1, first, lastr))
        ln = LineChart()
        ln.add_data(ref(ws, 5, first - 1, lastr), titles_from_data=True)
        ln.series[0].graphicalProperties.line.solidFill = "E34948"
        ln.series[0].graphicalProperties.line.width = 28000
        bar += ln
        ws.add_chart(bar, "A" + str(lastr + 3))
    ws.cell(lastr + 22, 1, "Lecture : tant que la barre (versements) dépasse la courbe rouge (charges), le compte commun se remplit ; sinon il se vide.").font = Font(italic=True, color=GREY)


def sheet_comptes(wb, d: dict):
    ws = wb.create_sheet("Évolution des comptes")
    title(ws, "Évolution de chaque compte (hebdomadaire, depuis le premier solde connu)", "Un graphe par classe : chaque échelle est propre, les gros montants n'écrasent plus les petits comptes.")
    hist = d["all"]["accounts_hist"]
    accts: dict[int, dict] = {}
    for p in hist:
        a = accts.setdefault(p["account_id"], {"name": p["name"], "type": p["type"], "pts": {}})
        if not p["estimated"]:                 # avant l'ouverture du compte (premier solde reporté en arrière) : case vide, pas 0 €
            a["pts"][p["day"]] = f(p["balance"])
    first_real = min((p["day"] for p in hist if not p["estimated"]), default=None)
    days = sorted({p["day"] for p in hist if first_real is None or p["day"] >= first_real})
    groups = {"courant": [], "livret": [], "placements": []}
    for aid, a in accts.items():
        groups["courant" if a["type"] == "courant" else "livret" if a["type"] == "livret" else "placements"].append((aid, a))
    r = 4
    anchor_row = 4
    for key, items in groups.items():
        if not items or len(days) < 2:
            continue
        r = section(ws, r, CLASS[key], 2 + len(items))
        heads = ["Date"] + [a["name"] for _, a in items]
        rows = [[fr_short(dy)] + [a["pts"].get(dy) for _, a in items] for dy in days]
        first, lastr = table(ws, r, heads, rows, money_cols=tuple(range(1, len(heads))))
        ch = style(LineChart() if key != "placements" else AreaChart(), 20, 8)
        ch.title = CLASS[key]
        if key == "placements":
            ch.grouping = "stacked"
        ch.add_data(ref(ws, 2, first - 1, lastr, 1 + len(items)), titles_from_data=True)
        ch.set_categories(ref(ws, 1, first, lastr))
        ws.add_chart(ch, f"{chr(66 + len(items) + 1)}{anchor_row}")
        anchor_row += 18
        r = lastr + 2
    widths(ws, {"A": 12})
    for col in "BCDEFGHIJ":
        ws.column_dimensions[col].width = 20


def sheet_eviter(wb, d: dict):
    ws = wb.create_sheet("À éviter")
    title(ws, "Dépenses à éviter ou à négocier", "Coûts réels calculés sur les opérations (moyenne mensuelle sur la période couverte). Aucune estimation du modèle.")
    widths(ws, {"A": 26, "B": 26, "C": 14, "D": 14, "E": 50, "F": 60})
    r = 4
    for pid, s in d["scopes"].items():
        av = s["avoidable"]
        rows = []
        for g in av.get("groups", []):
            for i in g["items"]:
                rec = " ; ".join(f"{x['merchant']} {x['amount']:.2f} €/mois" for x in i["recurring"]) or " ; ".join(f"{t['merchant']} {t['total']:.0f} €" for t in i["top"])
                rows.append([g["title"], i["label"], i["monthly"], i["annual"], rec, i["hint"]])
        r = section(ws, r, f"{s['name']} — environ {sum(x[3] for x in rows):,.0f} € par an en jeu".replace(",", " "), 6)
        if not rows:
            ws.cell(r, 1, "Rien à signaler sur la période.")
            r += 2
            continue
        first, lastr = table(ws, r, ["Famille", "Poste", "Par mois", "Par an", "Détail (récurrents ou principaux)", "Que faire"], rows, money_cols=(2, 3), wrap_cols=(0, 4, 5))
        ch = style(BarChart(), 17, 7.5)
        ch.type, ch.title = "bar", f"{s['name']} : coût annuel par poste"
        ch.add_data(ref(ws, 4, first - 1, lastr), titles_from_data=True)
        ch.set_categories(ref(ws, 2, first, lastr))
        ch.legend = None
        ws.add_chart(ch, f"H{r - 1}")
        r = max(lastr + 3, r + 16)


def md_lines(text: str, upto: str, start: str) -> list[str]:
    """Extrait d'un document markdown : de la section `start` (incluse) à `upto` (exclue), sans la syntaxe."""
    out, on = [], False
    for ln in (text or "").splitlines():
        if re.match(rf"^##\s+{re.escape(start)}", ln):
            on = True
        elif on and re.match(rf"^##\s+{re.escape(upto)}", ln):
            break
        if on and ln.strip() and not re.match(r"^\s*[|\-]{3,}", ln) and not ln.strip().startswith("---"):
            out.append(re.sub(r"[*_`]|^#+\s*|^>\s*", "", ln).replace("|", " · ").strip())
    return out


def sheet_economies(wb, d: dict):
    ws = wb.create_sheet("Économies possibles")
    sv = d.get("savings") or {}
    title(ws, "Où gagner : alternatives chez la concurrence", "Offres trouvées par l'IA sur le web (source citée). Économie = montant réel actuel − prix publié. Prix à confirmer chez le fournisseur.")
    widths(ws, {"A": 22, "B": 22, "C": 14, "D": 22, "E": 34, "F": 14, "G": 14, "H": 20, "I": 52})
    p = sv.get("payload")
    if not p or not p.get("items"):
        ws.cell(4, 1, "Aucune recherche d'alternatives pour l'instant (bouton « Chercher des alternatives » de la page Budget).")
        return
    alts_rows, tips, est_flags = [], [], []
    for it in p["items"]:
        c = it["contrat"]
        for a in it["alternatives"]:
            alts_rows.append([c["libelle"], c["categorie"], c["mensuel"], a["fournisseur"], a["offre"], a["prix_mensuel"],
                              a["economie_annuelle"] or 0, a.get("engagement") or "", a["source_url"]])
            est_flags.append(bool(a.get("economie_estimee")))
        for pi in it["pistes"]:
            tips.append([c["libelle"], c["categorie"], c["mensuel"], "Piste", pi, "", "", "", ""])
    rows = alts_rows + tips          # les offres chiffrées d'abord : le graphique en lit le début
    first, lastr = table(ws, 4, ["Contrat", "Catégorie", "Actuel / mois", "Fournisseur", "Offre ou piste", "Prix / mois", "Économie / an", "Engagement", "Source"],
                         rows, money_cols=(2, 5, 6), wrap_cols=(4, 8))
    for i, est in enumerate(est_flags):          # économie fondée sur une moyenne observée : affichée avec « ≈ »
        if est:
            ws.cell(first + i, 7).number_format = '"≈ "#,##0 "€"'
    alts = alts_rows
    if alts:
        ch = style(BarChart(), 17, 8)
        ch.type, ch.title = "bar", "Économie annuelle possible par offre"
        ch.add_data(ref(ws, 7, first - 1, first - 1 + len(alts)), titles_from_data=True)
        ch.set_categories(ref(ws, 4, first, first - 1 + len(alts)))
        ch.legend = None
        ws.add_chart(ch, f"A{lastr + 3}")
    ws.cell(lastr + 22, 1, f"Recherche du {fr_date(sv['created_at'])} ({sv.get('model', '')}). {p.get('note', '')}").font = Font(italic=True, color=GREY)


def sheet_partage(wb, d: dict):
    ws = wb.create_sheet("Qui doit quoi")
    st = d.get("settlement") or {}
    title(ws, "Qui doit quoi à qui", st.get("note", "Dépenses partagées et remboursements classés dans l'application."))
    widths(ws, {"A": 14, "B": 62, "C": 52, "D": 14, "E": 14})
    ws.cell(4, 1, st.get("phrase", "Pas de données.")).font = Font(bold=True, size=14, color=NAVY)
    rows = [[fr_date(l["date"]) if l.get("date") else "", l["libelle"], l["type"], l["montant"], l["effet"]] for l in st.get("lignes", [])]
    first, lastr = table(ws, 6, ["Date", "Libellé", "Nature", "Montant", f"Effet (+ : {st.get('b', 'B')} doit à {st.get('a', 'A')})"], rows, money_cols=(3, 4), wrap_cols=(1, 2))
    r = lastr + 2
    cands = d["shared"].get("candidates", [])
    if cands:
        r = section(ws, r, f"À confirmer dans l'application ({len(cands)} opérations suggérées)", 5)
        first, lastr = table(ws, r, ["Date", "Libellé", "Compte", "Montant", "Suggestion"],
                             [[fr_date(c["booked_on"]), c["label"], c["account"], f(c["amount"]), "Dépense du foyer" if c["suggested"] == "depense" else "Remboursement"] for c in cands],
                             money_cols=(3,), wrap_cols=(1,))


def sheet_conseils(wb, d: dict):
    ws = wb.create_sheet("Conseils IA")
    title(ws, "Conseils de l'IA", "Chaque conseil s'appuie sur des chiffres calculés (colonne « Chiffres cités »). Ce sont des propositions : rien n'est exécuté automatiquement.")
    widths(ws, {"A": 12, "B": 12, "C": 11, "D": 13, "E": 34, "F": 52, "G": 52, "H": 40, "I": 42})
    latest: dict = {}
    for rec in d["recos"]:                       # le plus récent par périmètre
        latest.setdefault(rec.get("person") or "Foyer", rec)
    rows = []
    for who, rec in latest.items():
        facts = rec.get("facts") or {}
        for it in rec["payload"].get("recommandations", []):
            cites = " ; ".join(fact_text(facts[k]) for k in it.get("faits", []) if k in facts)
            rows.append([who, fr_date(rec["created_at"]), PRIO.get(it["priorite"], it["priorite"]), HORIZON.get(it["horizon"], it["horizon"]),
                         it["titre"], it["constat"] + "\n\n" + it["action"], it["vigilance"], cites, ""])
    r = section(ws, 4, "Recommandations par périmètre", 9)
    first, lastr = table(ws, r, ["Périmètre", "Date", "Priorité", "Horizon", "Titre", "Constat et action", "Vigilance", "Chiffres cités", ""], rows, wrap_cols=(4, 5, 6, 7))
    for rr in range(first, lastr + 1):
        ws.row_dimensions[rr].height = 150
    r = lastr + 2
    syn = [(who, rec["payload"].get("synthese", "")) for who, rec in latest.items()]
    r = section(ws, r, "Synthèses", 9)
    for who, t in syn:
        ws.cell(r, 1, who).font = Font(bold=True)
        ws.cell(r, 2, t).alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=8)
        ws.row_dimensions[r].height = 60
        r += 1
    r += 1
    strat = (d["docs"].get("strategie") or {}).get("content", "")
    for head, until in (("1. En une page", "2."), ("3. Comptes à ouvrir", "4."), ("6. Où et comment économiser", "7.")):
        lines = md_lines(strat, until, head)
        if not lines:
            continue
        r = section(ws, r, f"Stratégie d'épargne — {lines[0]}", 9)
        for ln in lines[1:]:
            ws.cell(r, 1, ln).alignment = Alignment(wrap_text=True, vertical="top")
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
            ws.row_dimensions[r].height = 16 if len(ln) < 150 else 32
            r += 1
        r += 1
    notes = (d["docs"].get("notes_marche") or {}).get("content", "")
    macro = md_lines(notes, "1. ", "0. CONTEXTE MACRO")
    if macro:
        r = section(ws, r, "Contexte de marché utilisé", 9)
        for ln in macro[1:]:
            ws.cell(r, 1, ln).alignment = Alignment(wrap_text=True, vertical="top")
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
            ws.row_dimensions[r].height = 32 if len(ln) > 150 else 16
            r += 1


def sheet_objectifs(wb, d: dict):
    ws = wb.create_sheet("Objectifs")
    title(ws, "Objectifs", "Montant atteint, effort mensuel et faisabilité calculés par l'application.")
    widths(ws, {"A": 30, "B": 16, "C": 16, "D": 16, "E": 16, "F": 18, "G": 40})
    rows = [[g["name"], f(g["current"]), f(g["target"]), f(g["remaining"]), f(g.get("monthly_needed")) if g.get("monthly_needed") is not None else "", fr_date(g["target_date"]),
             g.get("feasibility") or ""] for g in d["goals"]]
    first, lastr = table(ws, 4, ["Objectif", "Atteint", "Cible", "Reste", "Effort mensuel", "Échéance", "Faisabilité"], rows, money_cols=(1, 2, 3, 4))
    if rows:
        ch = style(BarChart(), 17, 7.5)
        ch.type, ch.title = "bar", "Atteint et cible"
        ch.add_data(ref(ws, 2, first - 1, lastr, 3), titles_from_data=True)
        ch.set_categories(ref(ws, 1, first, lastr))
        ws.add_chart(ch, f"A{lastr + 3}")


def sheet_operations(wb, d: dict):
    ws = wb.create_sheet("Opérations")
    headers, rows = ex.tables({"transfers": d["transfers"], "monthly": [], "breakdown": [], "networth": [], "accounts": [], "pays": [],
                               "transactions": d["transactions"], "person": None})["Transactions"]
    ex.fill_sheet(ws, headers, rows)
    ws.auto_filter.ref = ws.dimensions


# ---------------------------------------------------------------- assemblage

def build(d: dict | None = None) -> tuple[bytes, dict]:
    d = d or gather()
    wb = Workbook()
    sheet_synthese(wb, d)
    for pid in d["scopes"]:
        sheet_person(wb, d, pid)
    sheet_foyer(wb, d)
    sheet_partage(wb, d)
    sheet_comptes(wb, d)
    sheet_eviter(wb, d)
    sheet_economies(wb, d)
    sheet_conseils(wb, d)
    sheet_objectifs(wb, d)
    sheet_operations(wb, d)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), {"sheets": wb.sheetnames, "operations": len(d["transactions"])}, d


def publish(content: bytes, month: str) -> None:
    name = f"situation-{month}.xlsx"
    with httpx.Client(timeout=60) as h:
        h.put(f"{LEDGER}/reports/{month}", params={"filename": name}, content=content,
              headers={"content-type": "application/octet-stream"}).raise_for_status()


SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)
APP_URL = os.environ.get("APP_URL", "http://localhost:8080")


MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def fr_month(dt) -> str:
    return f"{MOIS[dt.month - 1]} {dt.year}"


def esc(x) -> str:
    return html.escape(str(x if x is not None else ""))


def eur(v, signed: bool = False) -> str:
    n = f"{abs(float(v or 0)):,.0f}".replace(",", " ")
    return (("+" if v and float(v) > 0 else "−" if v and float(v) < 0 else "") if signed else ("−" if v and float(v) < 0 else "")) + n + " €"


def report_html(d: dict, month: str) -> str:
    """Corps du mail : l'essentiel du rapport (le classeur Excel détaillé est joint). Chiffres issus des services, jamais recalculés."""
    th = "padding:6px 10px;text-align:right;color:#6f6d67;font-weight:500;font-size:12px"
    td = "padding:6px 10px;text-align:right;border-top:1px solid #e2dccd"
    h2 = "font-size:15px;margin:22px 0 6px;color:#1f3a5f"
    rows = ""
    for pid, sc in d["scopes"].items():
        now, delta = last_vs(sc["history"])
        last = sc["history"][-1] if sc["history"] else {}
        rows += (f"<tr><td style='{td};text-align:left'><b>{esc(sc['name'])}</b></td><td style='{td}'>{eur(now)}</td>"
                 f"<td style='{td}'>{eur(delta, True)}</td><td style='{td}'>{eur(last.get('courant'))}</td>"
                 f"<td style='{td}'>{eur(last.get('livret'))}</td><td style='{td}'>{eur(last.get('placements'))}</td></tr>")
    out = [f"<div style='font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;color:#0b0b0b;line-height:1.5'>",
           f"<h1 style='font-size:20px;margin:0 0 4px'>Situation financière — {esc(month)}</h1>",
           f"<div style='color:#6f6d67;font-size:13px'>Résumé automatique. Le classeur Excel détaillé (graphes, tableaux, conseils) est joint.</div>",
           f"<h2 style='{h2}'>Patrimoine</h2><table style='border-collapse:collapse;width:100%;font-size:13px'><tr>"
           f"<th style='{th};text-align:left'></th><th style='{th}'>Total</th><th style='{th}'>30 jours</th><th style='{th}'>Courants</th>"
           f"<th style='{th}'>Livrets</th><th style='{th}'>Placements</th></tr>{rows}</table>"]
    st = d.get("settlement") or {}
    a = (d.get("commun") or {}).get("avg")
    if a or st.get("phrase"):
        out.append(f"<h2 style='{h2}'>Compte commun</h2><ul style='margin:0;padding-left:18px;font-size:14px'>")
        if a:
            cov = f" ({a['couverture_pct']:.0f} % des charges couvertes)" if a.get("couverture_pct") is not None else ""
            out.append(f"<li>Versements moyens : <b>{eur(a['versements'])}</b> par mois pour <b>{eur(a['charges'])}</b> de charges{esc(cov)} — marge {eur(a['marge'], True)}.</li>")
        if st.get("phrase"):
            out.append(f"<li>Qui doit quoi : <b>{esc(st['phrase'])}</b></li>")
        out.append("</ul>")
    latest: dict = {}
    for rec in d.get("recos", []):
        latest.setdefault(rec.get("person") or "Foyer", rec)
    if latest:
        out.append(f"<h2 style='{h2}'>Conseils de l'IA</h2>")
        for who, rec in latest.items():
            items = rec["payload"].get("recommandations", [])[:3]
            if not items:
                continue
            out.append(f"<div style='font-size:13px;color:#6f6d67;margin-top:6px'>{esc(who)}</div><ul style='margin:2px 0;padding-left:18px;font-size:14px'>")
            out += [f"<li><b>{esc(it['titre'])}</b> <span style='color:#6f6d67'>· {esc(PRIO.get(it['priorite'], it['priorite']))}</span></li>" for it in items]
            out.append("</ul>")
    p = (d.get("savings") or {}).get("payload") or {}
    best = sorted(((al["economie_annuelle"] or 0, it["contrat"], al) for it in p.get("items", []) for al in it["alternatives"]), key=lambda x: -x[0])[:5]
    if best:
        out.append(f"<h2 style='{h2}'>Où gagner (offres concurrentes trouvées)</h2><ul style='margin:0;padding-left:18px;font-size:14px'>")
        for eco, c, al in best:
            out.append(f"<li>{esc(c['libelle'][:34])} : <a href='{esc(al['source_url'])}'>{esc(al['fournisseur'])} {esc(al['offre'])}</a> à {eur(al['prix_mensuel'])}/mois "
                       f"→ <b>{'≈ ' if al.get('economie_estimee') else ''}−{eur(eco)}/an</b></li>")
        out.append(f"</ul><div style='font-size:12px;color:#6f6d67'>{esc(p.get('note', ''))}</div>")
    out.append(f"<p style='margin-top:24px;font-size:13px;color:#6f6d67'>Ouvrir l'application : <a href='{esc(APP_URL)}'>{esc(APP_URL)}</a><br>"
               "Les conseils sont des propositions : rien n'est exécuté automatiquement.</p></div>")
    return "".join(out)


def send_report(content: bytes, d: dict, month: str, only_person: int | None = None) -> list[str]:
    """Envoie le rapport (résumé HTML + classeur en pièce jointe) aux membres du foyer qui ont une adresse."""
    if not SMTP_HOST:
        raise RuntimeError("SMTP non configuré (SMTP_HOST)")
    to = [p["email"] for p in d["persons"] if p.get("email") and (only_person is None or p["id"] == only_person)]
    if not to:
        raise RuntimeError("aucun destinataire (adresse e-mail des membres du foyer)")
    label = fr_month(datetime.strptime(month, "%Y-%m"))
    sent = []
    for addr in to:
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = f"Situation financière — {label}", SMTP_FROM, addr
        msg.set_content(f"Situation financière — {label}. Le résumé s'affiche en HTML ; le classeur Excel détaillé est joint. Application : {APP_URL}")
        msg.add_alternative(report_html(d, label), subtype="html")
        msg.add_attachment(content, maintype="application", subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           filename=f"situation-{month}.xlsx")
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as sm:
            sm.starttls(context=ssl.create_default_context())
            if SMTP_USER:
                sm.login(SMTP_USER, SMTP_PASSWORD)
            sm.send_message(msg)
        sent.append(addr)
    return sent


def run(dry: str | None = None, mail: bool = True, only_person: int | None = None) -> dict:
    content, meta, d = build()
    month = f"{date.today():%Y-%m}"
    if dry:
        with open(dry, "wb") as fh:
            fh.write(content)
        return {"file": dry, "size": len(content), **meta}
    publish(content, month)
    out = {"month": month, "size": len(content), **meta}
    if mail:
        try:
            out["mail"] = [a.split("@")[0][:2] + "…@" + a.split("@")[1] for a in send_report(content, d, month, only_person)]
        except Exception as e:  # noqa: BLE001  l'échec du mail n'invalide pas le rapport (stocké dans l'appli)
            print(f"[monthly] mail non envoyé : {e}", file=sys.stderr)
            out["mail_error"] = str(e)[:160]
    try:  # notification ntfy (comme le récap hebdo)
        from . import weekly
        weekly.send("Rapport mensuel prêt", f"Situation financière de {month} : disponible dans l'application (page Export)" + (" et par e-mail." if out.get("mail") else "."), url="/export")
    except Exception as e:  # noqa: BLE001
        print(f"[monthly] notification non envoyée : {e}", file=sys.stderr)
    return out


if __name__ == "__main__":
    dry = sys.argv[sys.argv.index("--dry-run") + 1] if "--dry-run" in sys.argv else None
    person = int(sys.argv[sys.argv.index("--only") + 1]) if "--only" in sys.argv else None   # test : un seul destinataire (id)
    print(run(dry, mail="--no-mail" not in sys.argv, only_person=person))
