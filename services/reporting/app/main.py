"""reporting : digest mensuel par email (à chaque paie) pour chaque personne du foyer.
Aucun calcul ici : tous les chiffres viennent du ledger et du budget-engine."""
import html
import os
import smtplib
import ssl
import sys
from datetime import date
from email.message import EmailMessage

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

LEDGER = os.environ.get("LEDGER_URL", "http://ledger:8000")
BUDGET = os.environ.get("BUDGET_URL", "http://budget-engine:8000")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)
APP_URL = os.environ.get("APP_URL", "http://localhost:8080")

app = FastAPI(title="reporting")


def eur(v, decimals=0) -> str:
    if v is None:
        return "—"
    s = f"{float(v):,.{decimals}f}".replace(",", " ").replace(".", ",")
    return f"{s} €"


def fdate(s: str) -> str:
    return date.fromisoformat(s[:10]).strftime("%d/%m/%Y")


def fetch() -> dict:
    with httpx.Client(timeout=30) as h:
        g = lambda base, path: h.get(base + path).raise_for_status().json()
        monthly = g(BUDGET, "/budget/monthly")
        complete = [m for m in monthly if m["complete"]]
        last = complete[-1] if complete else None
        return {
            "summary": g(LEDGER, "/summary"),
            "budget": g(BUDGET, "/budget/summary"),
            "last": last,
            "breakdown": g(BUDGET, f"/budget/breakdown?cycle={last['cycle']}") if last else [],
            "caps": g(BUDGET, "/budget/caps"),
            "goals": g(BUDGET, "/budget/goals"),
            "recurring": g(BUDGET, "/budget/recurring"),
            "anomalies": g(BUDGET, "/budget/anomalies?limit=5"),
            "forecast": g(BUDGET, "/budget/forecast"),
            "persons": g(LEDGER, "/persons"),
        }


def render(d: dict, name: str) -> tuple[str, str]:
    """HTML d'email : styles en ligne, tableaux, une colonne — lisible dans tous les clients mail."""
    last, b = d["last"], d["budget"]
    esc = html.escape
    month = date.fromisoformat(last["cycle"]).strftime("%m/%Y") if last else "—"
    subject = f"Patrimoine · bilan du cycle {month}"
    ink, muted, line, bg = "#0b0b0b", "#52514e", "#e2dccd", "#fbf8f1"
    row = lambda k, v, bold=False: (f'<tr><td style="padding:6px 0;color:{muted}">{esc(k)}</td>'
                                    f'<td style="padding:6px 0;text-align:right;{"font-weight:700;" if bold else ""}color:{ink}">{v}</td></tr>')
    h2 = lambda t: f'<h2 style="font-size:15px;margin:26px 0 8px;color:{ink}">{esc(t)}</h2>'
    parts = [f'<p style="margin:0 0 4px;color:{muted}">Bonjour {esc(name)},</p>',
             f'<h1 style="font-size:22px;margin:0 0 4px;color:{ink}">Bilan du cycle {month}</h1>']
    if last:
        parts.append(f'<p style="margin:0;color:{muted}">du {fdate(last["starts"])} au {fdate(last["ends"])}</p>')
        parts.append(h2("Le cycle en chiffres"))
        parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                     + row("Revenus", eur(last["income"]))
                     + row("Charges fixes", eur(last["fixed"]))
                     + row("Dépenses variables", eur(last["variable"]))
                     + (row("Virements entre vous (net)", eur(last["internal_net"])) if float(last["internal_net"]) else "")
                     + row("Reste épargnable", eur(last["available"]), True)
                     + row("Moyenne des derniers cycles", eur(b.get("available")))
                     + "</table>")
        spend = sorted([r for r in d["breakdown"] if r["kind"] == "variable" and float(r["amount"]) < 0], key=lambda r: float(r["amount"]))[:5]
        if spend:
            parts.append(h2("Principaux postes variables"))
            parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                         + "".join(row(r["label"], eur(-float(r["amount"]))) for r in spend) + "</table>")
    parts.append(h2("Patrimoine"))
    parts.append(f'<p style="margin:0;font-size:20px;font-weight:700;color:{ink}">{eur(d["summary"]["networth"], 2)}</p>')
    if d["caps"]:
        parts.append(h2("Plafonds (cycle en cours)"))
        parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                     + "".join(row(k["label"], f'{eur(k["spent"])} / {eur(k["monthly"])} ({k["pct"]:.0f} %)') for k in d["caps"]) + "</table>")
    goals = [g for g in d["goals"] if g["status"] == "active"]
    if goals:
        parts.append(h2("Objectifs"))
        lab = {"ok": "atteignable", "tight": "tendu", "out": "hors de portée au rythme actuel"}
        parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                     + "".join(row(g["name"], f'{eur(g["current"])} / {eur(g["target"])} · {eur(g["monthly_needed"])}/mois nécessaires · {lab.get(g["feasibility"], "")}') for g in goals)
                     + "</table>")
    news = [r for r in d["recurring"]["items"] if r["is_new"] or r["price_change"]]
    if news:
        parts.append(h2("Abonnements à surveiller"))
        parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                     + "".join(row(r["merchant"], ("nouveau · " if r["is_new"] else "") + (f'variation {"+" if float(r["price_change"]) > 0 else ""}{eur(r["price_change"], 2)} · ' if r["price_change"] else "") + eur(r["last_amount"], 2)) for r in news)
                     + "</table>")
    if d["anomalies"]:
        parts.append(h2("Dépenses inhabituelles"))
        parts.append('<table width="100%" style="border-collapse:collapse;font-size:14px">'
                     + "".join(row(f'{a["merchant"]} · {fdate(a["booked_on"])}', f'{eur(-float(a["amount"]), 2)} (habituellement ~{eur(a["reference"])})') for a in d["anomalies"])
                     + "</table>")
    parts.append(f'<p style="margin:28px 0 0"><a href="{APP_URL}" style="color:#2a78d6">Ouvrir l\'application</a></p>')
    parts.append(f'<p style="margin:16px 0 0;font-size:12px;color:{muted}">Chiffres calculés sur vos opérations réelles. '
                 "Aucune opération n'est exécutée automatiquement.</p>")
    body = (f'<div style="background:{bg};padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,sans-serif">'
            f'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid {line};border-radius:12px;padding:24px">'
            + "".join(parts) + "</div></div>")
    return subject, body


def send(to: str, subject: str, body: str):
    if not SMTP_HOST:
        raise RuntimeError("SMTP non configuré (SMTP_HOST)")
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, SMTP_FROM, to
    msg.set_content("Votre client mail n'affiche pas le HTML. Ouvrez l'application : " + APP_URL)
    msg.add_alternative(body, subtype="html")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.starttls(context=ssl.create_default_context())
        if SMTP_USER:
            s.login(SMTP_USER, SMTP_PASSWORD)
        s.send_message(msg)


def run(send_mail: bool) -> list[str]:
    d = fetch()
    done = []
    for p in d["persons"]:
        if not p.get("email"):
            continue
        subject, body = render(d, p["name"])
        if send_mail:
            send(p["email"], subject, body)
        done.append(p["email"])
    return done


class MailIn(BaseModel):
    subject: str
    html: str


@app.post("/mail/send")
def mail_send(m: MailIn):
    """Envoi interne (advisor) à toutes les personnes du foyer ayant un email."""
    with httpx.Client(timeout=30) as h:
        persons = h.get(LEDGER + "/persons").raise_for_status().json()
    sent = []
    try:
        for p in persons:
            if p.get("email"):
                send(p["email"], m.subject, m.html)
                sent.append(p["email"])
    except Exception as e:
        raise HTTPException(503, str(e))
    return {"sent": sent}


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _export(kind: str, person: int | None, months: int):
    from app import export
    if not 0 <= months <= 120:
        raise HTTPException(422, "months entre 0 (tout) et 120")
    d = export.collect(person, months)
    slug = d["scope"].lower().split(" (")[0].replace("comptes personnels de ", "").replace(" ", "-")
    name = f"patrimoine-{slug}-{d['generated']:%Y-%m-%d}"
    if kind == "xlsx":
        return Response(export.build_workbook(d), media_type=XLSX,
                        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
    return Response(export.build_csv_zip(d), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}.zip"'})


@app.get("/export/xlsx")
def export_xlsx(person: int | None = None, months: int = 12):
    """Classeur Excel : résumé, graphiques déjà construits, et une feuille par jeu de données."""
    return _export("xlsx", person, months)


@app.get("/export/csv")
def export_csv(person: int | None = None, months: int = 12):
    """Lot de fichiers CSV (format français) dans une archive zip."""
    return _export("csv", person, months)


@app.post("/export/monthly/generate")
def monthly_generate(mail: bool = True, only: int | None = None):
    """Génère le rapport mensuel (classeur Excel complet) et le dépose dans le ledger (page Export → Rapports mensuels)."""
    from app import monthly
    try:
        return monthly.run(mail=mail, only_person=only)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"service indisponible : {e}")


@app.get("/health")
def health():
    return {"status": "ok", "smtp": bool(SMTP_HOST)}


@app.get("/digest/preview", response_class=HTMLResponse)
def preview(person: str = "Alex"):
    return render(fetch(), person)[1]


@app.post("/digest/send")
def send_now():
    try:
        return {"sent": run(True)}
    except Exception as e:
        raise HTTPException(503, str(e))


if __name__ == "__main__":  # CLI (timer systemd) : python -m app.main --send
    if "--send" in sys.argv and not SMTP_HOST:
        print("SMTP non configuré : digest non envoyé (voir SMTP_* dans .env)")
        sys.exit(0)
    print(run("--send" in sys.argv))
