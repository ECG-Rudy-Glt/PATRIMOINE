"""Récap hebdomadaire ntfy (CronJob `weekly-recap`, dimanche 19:00) : python -m app.weekly [--dry-run]
Chiffres lus sur le ledger et le budget-engine ; ici uniquement du tri et de la mise en forme. Aucun appel à Claude."""
import os
import re
import sys
from datetime import date, timedelta

import httpx

from app.main import APP_URL, BUDGET, LEDGER, eur

NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "")
DAYS = 7


def num(v) -> float:
    return float(v or 0)


def day(s: str) -> date:
    return date.fromisoformat(str(s)[:10])


def week_spending(h: httpx.Client, since: date) -> list[dict]:
    """Dépenses variables depuis `since` (inclus), opérations triées par date décroissante côté ledger."""
    out, offset = [], 0
    while True:
        page = h.get(LEDGER + "/transactions", params={"direction": "out", "limit": 500, "offset": offset}
                     ).raise_for_status().json()["items"]
        out += [t for t in page if day(t["booked_on"]) >= since and t["kind"] == "variable"]
        if len(page) < 500 or day(page[-1]["booked_on"]) < since:
            return out
        offset += 500


def fetch(today: date) -> dict:
    since = today - timedelta(days=DAYS - 1)
    with httpx.Client(timeout=30) as h:
        g = lambda base, path: h.get(base + path).raise_for_status().json()
        return {
            "accounts": g(LEDGER, "/accounts"),
            "week": week_spending(h, since),
            "budget": g(BUDGET, "/budget/summary"),
            "current": g(BUDGET, "/budget/current"),
            "caps": g(BUDGET, "/budget/caps"),
            "recurring": g(BUDGET, "/budget/recurring")["items"],
            "forecast": g(BUDGET, "/budget/forecast"),
            "alerts": g(LEDGER, "/alerts/events?limit=200")["items"],
            "anomalies": g(BUDGET, "/budget/anomalies?limit=100"),
        }


def render(d: dict, today: date) -> tuple[str, str]:
    """Fonction pure (testable sans réseau) : (titre, message Markdown). N'écrit que les lignes utiles."""
    since = today - timedelta(days=DAYS - 1)
    recent = lambda s: s and day(s) >= since
    lines = []

    courants = [a for a in d["accounts"] if a["type"] == "courant" and a.get("active", True) and a.get("balance") is not None]
    if courants:
        total = sum(num(a["balance"]) for a in courants)
        detail = " · ".join(f"{a['name']} {eur(a['balance'])}" for a in courants)
        lines.append(f"**Comptes courants** : {eur(total)}" + (f" ({detail})" if len(courants) > 1 else ""))

    # dépenses variables de la semaine vs moyenne hebdo des derniers cycles complets
    spent = sum(-num(t["amount"]) for t in d["week"])
    cycle_days = d["current"].get("days") or 30
    weekly_avg = num(d["budget"].get("variable")) * DAYS / cycle_days if d["budget"].get("cycles") else 0
    if spent or weekly_avg:
        line = f"**Dépenses de la semaine** : {eur(spent)}"
        if weekly_avg:
            gap = 100 * (spent - weekly_avg) / weekly_avg
            line += f" (moyenne hebdo {eur(weekly_avg)} ; {'+' if gap >= 0 else '−'}{abs(gap):.0f} %)"
        lines.append(line)
    cats: dict[str, float] = {}
    for t in d["week"]:
        k = t.get("category_label") or "Divers"
        cats[k] = cats.get(k, 0) - num(t["amount"])
    top = sorted(cats.items(), key=lambda kv: -kv[1])[:3]
    if top:
        lines.append("**Top catégories** : " + " · ".join(f"{k} {eur(v)}" for k, v in top))

    buf = d["budget"].get("buffer")
    if buf and num(buf["target"]) > 0:
        pct = min(100, 100 * num(buf["liquid"]) / num(buf["target"]))
        if num(buf["shortfall"]) > 0:
            lines.append(f"**Coussin de sécurité** : {eur(buf['liquid'])} / {eur(buf['target'])} ({pct:.0f} %), "
                         f"reste {eur(buf['shortfall'])}")
        else:
            lines.append(f"**Coussin de sécurité** : complet ({eur(buf['target'])})")

    over = [k for k in d["caps"] if num(k["pct"]) >= 100]
    if over:
        lines.append("**Plafonds dépassés** : " + " · ".join(
            f"{k['label']} {eur(k['spent'])} / {eur(k['monthly'])}" for k in over))

    # abonnements : nouveaux ou en hausse, constatés cette semaine (évite de répéter les mêmes chaque dimanche)
    subs = []
    for r in d["recurring"]:
        if not recent(r.get("last_date")):
            continue
        if r["is_new"]:
            subs.append(f"{r['merchant']} (nouveau, {eur(r['last_amount'], 2)})")
        elif num(r["price_change"]) > 0:
            subs.append(f"{r['merchant']} (+{eur(r['price_change'], 2)} → {eur(r['last_amount'], 2)})")
    if subs:
        lines.append("**Abonnements** : " + " · ".join(subs))

    fc = [f for f in d["forecast"] if f["days_left"] > 0]
    if fc:
        ends = day(fc[0]["ends"]).strftime("%d/%m")
        lines.append(f"**Prévision à la paie ({ends})** : " + " · ".join(
            f"{f['name']} ~{eur(f['projected'])}" for f in fc))

    low = sum(1 for e in d["alerts"] if recent(e["fired_at"]))
    odd = sum(1 for a in d["anomalies"] if recent(a["created_at"]))
    if low or odd:
        s = lambda n: "s" if n > 1 else ""
        parts = ([f"{low} solde{s(low)} bas"] if low else []) + ([f"{odd} dépense{s(odd)} inhabituelle{s(odd)}"] if odd else [])
        lines.append("**Alertes de la semaine** : " + ", ".join(parts))

    body = "\n".join(f"- {l}" for l in lines) if lines else "Rien de notable cette semaine."
    return f"Récap de la semaine ({since:%d/%m} → {today:%d/%m})", f"{body}\n\n[Ouvrir l'application]({APP_URL})"


def push(title: str, message: str, url: str = "/", tag: str = "recap") -> int:
    """Web Push (PWA) via le ledger, qui détient les abonnements ; texte brut (pas de markdown sur un téléphone)."""
    plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", "", message).replace("**", "").strip()
    try:
        r = httpx.post(f"{LEDGER}/push/send", timeout=60, json={"title": title, "body": plain[:400], "url": url, "tag": tag})
        r.raise_for_status()
        return r.json().get("sent", 0)
    except httpx.HTTPError as e:
        print(f"web push : échec ({type(e).__name__})")
        return 0


def send(title: str, message: str, url: str = "/"):
    pushed = push(title, message, url)
    if not NTFY_TOPIC:
        if pushed:
            return
        raise RuntimeError("ntfy non configuré (NTFY_TOPIC) et aucun appareil Web Push abonné")
    headers = {"Authorization": f"Bearer {NTFY_TOKEN}"} if NTFY_TOKEN else {}
    httpx.post(NTFY_URL, timeout=15, headers=headers, json={
        "topic": NTFY_TOPIC, "title": title, "message": message, "markdown": True,
        "priority": 3, "tags": ["calendar"], "click": APP_URL}).raise_for_status()


if __name__ == "__main__":
    today = date.today()
    title, message = render(fetch(today), today)
    if "--dry-run" in sys.argv:
        print(title, message, sep="\n\n")
    else:
        send(title, message)
        print("récap envoyé :", title)
