"""Connecteur Powens -> ledger (désactivé par défaut, lancer : python -m app.powens)."""
import os
from datetime import date, timedelta

import httpx

POWENS = f"https://{os.environ['POWENS_DOMAIN']}/2.0"
LEDGER = os.environ["LEDGER_URL"]
HEADERS = {"Authorization": f"Bearer {os.environ['POWENS_USER_TOKEN']}"}

# Mapping types Powens -> account_type
TYPE_MAP = {
    "checking": "courant", "savings": "livret", "pea": "pea",
    "lifeinsurance": "assurance_vie", "per": "per", "perp": "per",
    "market": "cto", "real_estate": "immobilier",
}


def main():
    today = date.today()
    since = (today - timedelta(days=30)).isoformat()
    with httpx.Client(headers=HEADERS, timeout=30) as pw, httpx.Client(base_url=LEDGER, timeout=30) as lg:
        accounts = pw.get(f"{POWENS}/users/me/accounts").raise_for_status().json()["accounts"]
        for a in accounts:
            ext = f"powens:{a['id']}"
            lg.put("/accounts/sync", json={
                "external_id": ext,
                "institution": str(a.get("id_connection")),
                "source": "powens",
                "name": a["name"],
                "type": TYPE_MAP.get(a.get("type"), "autre"),
                "currency": (a.get("currency") or {}).get("id", "EUR"),
                "balance": str(a.get("balance") or 0),
                "day": today.isoformat(),
            }).raise_for_status()
            txs = pw.get(f"{POWENS}/users/me/accounts/{a['id']}/transactions",
                         params={"min_date": since, "limit": 1000}).raise_for_status().json()["transactions"]
            lg.post(f"/accounts/{ext}/transactions", json=[
                {"external_id": str(t["id"]), "booked_on": t["date"],
                 "amount": str(t["value"]), "label": t.get("wording")}
                for t in txs
            ]).raise_for_status()
            print(f"{a['name']}: solde={a.get('balance')} tx={len(txs)}")


if __name__ == "__main__":
    main()
