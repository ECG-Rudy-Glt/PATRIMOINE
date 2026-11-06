"""Export des données : classeur Excel avec des graphiques déjà construits, et lot de fichiers CSV.

Les chiffres viennent des services (ledger / budget-engine) : ici uniquement de la mise en forme.
CSV au format français (séparateur « ; », virgule décimale, BOM UTF-8) pour s'ouvrir directement dans Excel / LibreOffice.
"""
import csv
import io
import os
import zipfile
from datetime import date, timedelta

import httpx
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill

LEDGER = os.environ.get("LEDGER_URL", "http://ledger:8000")
BUDGET = os.environ.get("BUDGET_URL", "http://budget-engine:8000")

EUR = '#,##0.00 "€"'
KIND = {"income": "Revenus", "fixed": "Charges fixes", "variable": "Dépenses variables", "household": "Compte commun",
        "internal": "Virements entre comptes", "savings": "Épargne"}
TYPE = {"courant": "Compte courant", "livret": "Livret", "pea": "PEA", "assurance_vie": "Assurance-vie", "per": "PER",
        "cto": "Compte-titres", "immobilier": "Immobilier", "autre": "Autre"}


def scope_name(person: int | None, persons: list[dict]) -> str:
    if person is None:
        return "Tous les comptes"
    if person == -1:
        return "Foyer (compte commun)"
    return next((f"Comptes personnels de {p['name']}" for p in persons if p["id"] == person), f"Personne {person}")


def in_scope(a: dict, person: int | None) -> bool:
    """Même définition que account_weights : None = tous, -1 = comptes à plusieurs titulaires, id = comptes personnels."""
    if person is None:
        return True
    if person == -1:
        return len(a["holders"]) > 1
    return len(a["holders"]) == 1 and a["holders"][0]["person_id"] == person


def collect(person: int | None, months: int) -> dict:
    """Rassemble les données du périmètre. months = 0 : tout l'historique disponible."""
    since = date.today() - timedelta(days=31 * months) if months else date.min
    q = f"person={person}" if person else ""
    with httpx.Client(timeout=60) as h:
        def get(base: str, path: str, **params):
            return h.get(base + path, params=params).raise_for_status().json()

        persons = get(LEDGER, "/persons")
        accounts = [a for a in get(LEDGER, "/accounts") if in_scope(a, person)]
        txs: list[dict] = []
        for a in accounts:
            off = 0
            while True:
                page = get(LEDGER, "/transactions", account_id=a["id"], limit=500, offset=off)["items"]
                txs += [t for t in page if date.fromisoformat(t["booked_on"]) >= since]
                if len(page) < 500 or date.fromisoformat(page[-1]["booked_on"]) < since:
                    break
                off += 500
        txs.sort(key=lambda t: (t["booked_on"], t["id"]), reverse=True)
        p = {"person": person} if person else {}
        return {
            "person": person, "scope": scope_name(person, persons), "months": months, "generated": date.today(),
            "accounts": accounts, "transactions": txs,
            "monthly": get(BUDGET, "/budget/cashflow", months=months or 60, **p),
            "breakdown": get(BUDGET, "/budget/breakdown", **p),
            "networth": get(LEDGER, "/networth/history", days=(31 * months) if months else 3650, **p),
            "transfers": get(BUDGET, "/budget/transfers", **p),
            "pays": get(BUDGET, "/budget/pay"),
            "summary": get(LEDGER, "/summary", **p),
            "budget": get(BUDGET, "/budget/summary", **p),
        }


# ---------------------------------------------------------------- tables communes (Excel et CSV)

def f(v) -> float:
    return float(v or 0)


def tables(d: dict) -> dict[str, tuple[list[str], list[list]]]:
    """Nom de feuille / fichier -> (en-têtes, lignes)."""
    names = {n["key"]: n["name"] for n in d["transfers"].get("nodes", [])}
    holders = lambda a: " / ".join(f"{x['name']} {f(x['share']) * 100:.0f} %" for x in a["holders"])
    return {
        "Mensuel": (["Mois", "Entrées (€)", "Sorties (€)", "Épargne (€)", "Solde du mois (€)", "Virements entre comptes (€)"],
                    [[m["month"], f(m["income"]), f(m["expense"]), f(m["savings"]), f(m["net"]), f(m["transfers"])]
                     for m in d["monthly"]]),
        "Catégories": (["Catégorie", "Type", "Moyenne mensuelle (€)"],
                       [[r["label"], KIND.get(r["kind"], r["kind"]), abs(f(r["amount"]))]
                        for r in sorted(d["breakdown"], key=lambda r: (r["kind"] == "income", -abs(f(r["amount"]))))   # dépenses d'abord
                        # vue d'ensemble : la contribution au compte commun est déjà dans les dépenses du compte commun
                        if r["kind"] in ("income", "fixed", "variable", "household") and f(r["amount"])
                        and not (r["kind"] == "household" and d.get("person") is None)]),
        "Patrimoine": (["Date", "Total (€)"], [[date.fromisoformat(str(p["day"])), f(p["total"])] for p in d["networth"]]),
        "Comptes": (["Compte", "Établissement", "Type", "Solde (€)", "Titulaires", "Date du solde"],
                    [[a["name"], a["institution"] or "", TYPE.get(a["type"], a["type"]), f(a["balance"]), holders(a),
                      date.fromisoformat(str(a["day"])) if a.get("day") else ""] for a in d["accounts"]]),
        "Virements": (["De", "Vers", "Par mois (€)", "Opérations", "Dernier"],
                      [[names.get(e["source"], e["source"]), names.get(e["target"], e["target"]), f(e["monthly"]),
                        e["count"], date.fromisoformat(str(e["last"]))] for e in d["transfers"].get("edges", [])]),
        "Paies": (["Personne", "Salaire moyen (€)", "Dernière paie (€)", "Date de la dernière paie", "Jour habituel",
                   "Prochaine paie attendue"],
                  [[p["name"], f(p["avg_amount"]), f(p["last_amount"]), date.fromisoformat(str(p["last_date"])),
                    p["usual_day"], date.fromisoformat(str(p["next_date"]))] for p in d["pays"]]),
        "Transactions": (["Date", "Compte", "Libellé", "Catégorie", "Type", "Montant (€)"],
                         [[date.fromisoformat(t["booked_on"]), t["account"], t["label"] or "", t.get("category_label") or "",
                           KIND.get(t.get("kind"), t.get("kind") or ""), f(t["amount"])] for t in d["transactions"]]),
    }


# ---------------------------------------------------------------- Excel

HEAD_FILL = PatternFill("solid", fgColor="1F3A5F")
HEAD_FONT = Font(bold=True, color="FFFFFF")


def fill_sheet(ws, headers: list[str], rows: list[list]):
    ws.append(headers)
    for c in ws[1]:
        c.font, c.fill, c.alignment = HEAD_FONT, HEAD_FILL, Alignment(horizontal="center", vertical="center", wrap_text=True)
    for r in rows:
        ws.append(r)
    ws.freeze_panes = "A2"
    for i, h in enumerate(headers, 1):
        width = max([len(str(h))] + [len(str(r[i - 1])) for r in rows[:300]] + [10])
        ws.column_dimensions[chr(64 + i)].width = min(width + 3, 60)
        for c in ws.iter_cols(min_col=i, max_col=i, min_row=2, max_row=ws.max_row):
            for cell in c:
                if isinstance(cell.value, float):
                    cell.number_format = EUR
                elif isinstance(cell.value, date):
                    cell.number_format = "DD/MM/YYYY"


def show_axes(chart):
    chart.x_axis.delete = False      # sans cela, certaines versions d'Excel n'affichent pas les axes
    chart.y_axis.delete = False


def build_workbook(d: dict) -> bytes:
    wb = Workbook()
    t = tables(d)
    summary = wb.active
    summary.title = "Résumé"
    sheets = {}
    for name, (headers, rows) in t.items():
        ws = wb.create_sheet(name)
        fill_sheet(ws, headers, rows)
        sheets[name] = (ws, len(rows))

    # --- Résumé : chiffres clés et graphiques
    s, b = d["summary"], d["budget"]
    summary["A1"] = "Patrimoine — export"
    summary["A1"].font = Font(bold=True, size=16)
    info = [("Périmètre", d["scope"]), ("Généré le", d["generated"]),
            ("Période", "Tout l'historique disponible" if not d["months"] else f"{d['months']} derniers mois"),
            ("Patrimoine suivi (€)", f(s.get("networth"))), ("Comptes suivis", s.get("accounts")),
            ("Opérations exportées", len(d["transactions"]))]
    if b.get("cycles"):
        info += [(f"Moyennes mensuelles sur {b['cycles']} cycle(s) complet(s)", ""), ("Revenus (€)", f(b["income"])),
                 ("Charges fixes (€)", f(b["fixed"])), ("Dépenses variables (€)", f(b["variable"])),
                 ("Capacité d'épargne (€)", f(b["available"]))]
    for i, (k, v) in enumerate(info, 3):
        summary.cell(i, 1, k).font = Font(bold=True)
        c = summary.cell(i, 2, v)
        if isinstance(v, float):
            c.number_format = EUR
        elif isinstance(v, date):
            c.number_format = "DD/MM/YYYY"
    summary.column_dimensions["A"].width = 46
    summary.column_dimensions["B"].width = 30

    def ref(sheet: str, c1: int, c2: int, r2: int, r1: int = 1):
        return Reference(sheets[sheet][0], min_col=c1, max_col=c2, min_row=r1, max_row=r2)

    n_m = sheets["Mensuel"][1]
    if n_m:
        bar = BarChart()
        bar.type, bar.title, bar.height, bar.width = "col", "Entrées et sorties par mois", 8.5, 18
        bar.add_data(ref("Mensuel", 2, 3, n_m + 1), titles_from_data=True)
        bar.set_categories(ref("Mensuel", 1, 1, n_m + 1, 2))
        show_axes(bar)
        summary.add_chart(bar, "D2")
        net = LineChart()
        net.title, net.height, net.width = "Solde du mois (entrées − sorties − épargne)", 8.5, 18
        net.add_data(ref("Mensuel", 5, 5, n_m + 1), titles_from_data=True)
        net.set_categories(ref("Mensuel", 1, 1, n_m + 1, 2))
        show_axes(net)
        summary.add_chart(net, "D20")
    n_p = sheets["Patrimoine"][1]
    if n_p > 1:
        line = LineChart()
        line.title, line.height, line.width = "Évolution du patrimoine suivi", 8.5, 18
        line.add_data(ref("Patrimoine", 2, 2, n_p + 1), titles_from_data=True)
        line.set_categories(ref("Patrimoine", 1, 1, n_p + 1, 2))
        line.x_axis.number_format = "MM/YY"
        show_axes(line)
        summary.add_chart(line, "D38")
    n_c = sum(1 for r in t["Catégories"][1] if r[1] != KIND["income"])   # lignes de dépenses (en tête de feuille)
    if n_c:
        cats = BarChart()
        cats.type, cats.title, cats.height, cats.width = "bar", "Postes de dépenses (moyenne mensuelle)", 10, 18
        cats.add_data(ref("Catégories", 3, 3, min(n_c, 14) + 1), titles_from_data=True)
        cats.set_categories(ref("Catégories", 1, 1, min(n_c, 14) + 1, 2))
        show_axes(cats)
        summary.add_chart(cats, "D56")
        ws = sheets["Catégories"][0]
        pie = PieChart()
        pie.title, pie.height, pie.width = "Répartition des postes", 10, 12
        pie.add_data(Reference(ws, min_col=3, min_row=1, max_row=min(n_c, 8) + 1), titles_from_data=True)
        pie.set_categories(Reference(ws, min_col=1, min_row=2, max_row=min(n_c, 8) + 1))
        ws.add_chart(pie, "E2")
    # graphiques aussi sur leurs feuilles
    if n_m:
        ws = sheets["Mensuel"][0]
        b2 = BarChart()
        b2.type, b2.title, b2.height, b2.width = "col", "Entrées et sorties par mois", 9, 18
        b2.add_data(Reference(ws, min_col=2, max_col=3, min_row=1, max_row=n_m + 1), titles_from_data=True)
        b2.set_categories(Reference(ws, min_col=1, min_row=2, max_row=n_m + 1))
        show_axes(b2)
        ws.add_chart(b2, "H2")
    n_v = sheets["Virements"][1]
    if n_v:
        ws = sheets["Virements"][0]
        vb = BarChart()
        vb.type, vb.title, vb.height, vb.width = "bar", "Virements entre comptes (par mois)", 9, 18
        vb.add_data(Reference(ws, min_col=3, min_row=1, max_row=n_v + 1), titles_from_data=True)
        vb.set_categories(Reference(ws, min_col=1, min_row=2, max_row=n_v + 1))
        show_axes(vb)
        ws.add_chart(vb, "H2")
    sheets["Transactions"][0].auto_filter.ref = sheets["Transactions"][0].dimensions
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# ---------------------------------------------------------------- CSV

def fr(v):
    if isinstance(v, float):
        return f"{v:.2f}".replace(".", ",")
    if isinstance(v, date):
        return v.isoformat()
    return v


def build_csv_zip(d: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, (headers, rows) in tables(d).items():
            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
            w.writerow(headers)
            w.writerows([[fr(c) for c in r] for r in rows])
            z.writestr(f"{name.lower().replace('é', 'e')}.csv", "﻿" + buf.getvalue())
        z.writestr("LISEZMOI.txt",
                   f"Export Patrimoine — {d['scope']} — {d['generated']:%d/%m/%Y}\r\n"
                   "Fichiers CSV : séparateur « ; », virgule décimale, encodage UTF-8 (s'ouvrent directement dans Excel).\r\n"
                   "Pour des graphiques déjà prêts, utilisez l'export Excel (.xlsx).\r\n")
    return out.getvalue()
