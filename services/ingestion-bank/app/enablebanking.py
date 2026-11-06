"""Connecteur Enable Banking (DSP2) -> ledger.

Commandes :
  banks [--country FR]        liste les banques disponibles (noms exacts)
  link  "<nom banque>"        génère l'URL d'autorisation à ouvrir dans un navigateur
  session "<code>"            échange le code reçu en retour contre une session (sauvegardée)
  sync                        synchronise tous les comptes des sessions enregistrées

Sessions : table bank_sessions si DATABASE_URL est défini (sessions.json repris au passage, idempotent),
sinon fichier EB_SESSIONS_FILE. En production, l'ajout de banque passe par l'écran « Banques » (app.api).
"""
import argparse
import hashlib
import json
import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import jwt

from . import store

API = "https://api.enablebanking.com"
APP_ID = os.environ.get("EB_APP_ID", "")
KEY_PATH = Path(os.environ.get("EB_PRIVATE_KEY", "/secrets/enablebanking.pem"))
SESSIONS = Path(os.environ.get("EB_SESSIONS_FILE", "/secrets/sessions.json"))
REDIRECT_URL = os.environ.get("EB_REDIRECT_URL", "https://localhost/callback")
LEDGER = os.environ.get("LEDGER_URL", "http://ledger:8000")
HISTORY_DAYS = int(os.environ.get("EB_HISTORY_DAYS", "90"))
APP_URL = os.environ.get("APP_URL", "http://localhost:8080").rstrip("/")
NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "")
EXPIRY_NOTICE_DAYS = 14

# ISO 20022 cash_account_type -> account_type
TYPE_MAP = {"CACC": "courant", "SVGS": "livret", "CARD": "courant", "LOAN": "autre"}
# Ordre de préférence des soldes (disponible réel d'abord)
BALANCE_PREF = ["CLBD", "ITBD", "XPCD", "ITAV", "CLAV", "OTHR"]


def client() -> httpx.Client:
    now = int(time.time())
    token = jwt.encode(
        {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 3600},
        KEY_PATH.read_text(), algorithm="RS256", headers={"kid": APP_ID},
    )
    return httpx.Client(base_url=API, headers={"Authorization": f"Bearer {token}"}, timeout=60)


def ledger_client() -> httpx.Client:
    return httpx.Client(base_url=LEDGER, timeout=30)


def load_sessions() -> list[dict]:
    return json.loads(SESSIONS.read_text()) if SESSIONS.exists() else []


def cmd_banks(args):
    with client() as eb:
        for a in eb.get("/aspsps", params={"country": args.country}).raise_for_status().json()["aspsps"]:
            print(a["name"])


def cmd_link(args):
    valid_until = (datetime.now(timezone.utc) + timedelta(days=args.days)).isoformat()
    with client() as eb:
        r = eb.post("/auth", json={
            "access": {"valid_until": valid_until},
            "aspsp": {"name": args.bank, "country": args.country},
            "state": str(uuid.uuid4()),
            "redirect_url": REDIRECT_URL,
            "psu_type": "personal",
        }).raise_for_status().json()
    print("Ouvre cette URL, authentifie-toi, puis copie le paramètre `code` de l'URL de retour :\n")
    print(r["url"])


def cmd_session(args):
    with client() as eb:
        s = eb.post("/sessions", json={"code": args.code}).raise_for_status().json()
    if store.DATABASE_URL:
        with store.connect() as c:
            store.save_session(c, s, s["aspsp"].get("country") or "FR", {}, "cli")
    else:
        sessions = [x for x in load_sessions() if x["session_id"] != s["session_id"]]
        sessions.append({
            "session_id": s["session_id"],
            "bank": s["aspsp"]["name"],
            "valid_until": s["access"]["valid_until"],
            "accounts": [a["uid"] for a in s["accounts"]],
        })
        SESSIONS.parent.mkdir(parents=True, exist_ok=True)
        SESSIONS.write_text(json.dumps(sessions, indent=2))
        SESSIONS.chmod(0o600)
    print(f"Session enregistrée : {s['aspsp']['name']} ({len(s['accounts'])} compte(s)), valide jusqu'au {s['access']['valid_until']}")


def pick_balance(balances: list[dict]) -> str:
    by_type = {b["balance_type"]: b for b in balances}
    for t in BALANCE_PREF:
        if t in by_type:
            return by_type[t]["balance_amount"]["amount"]
    return balances[0]["balance_amount"]["amount"] if balances else "0"


def account_currency(details: dict, balances: list[dict]) -> str:
    # Certaines banques renvoient "XXX" (pas de devise) dans les détails : on prend celle du solde
    cur = details.get("currency")
    if cur and cur != "XXX":
        return cur
    return next((b["balance_amount"]["currency"] for b in balances if b["balance_amount"].get("currency")), "EUR")


def tx_to_ledger(t: dict) -> dict:
    amount = t["transaction_amount"]["amount"]
    if t.get("credit_debit_indicator") == "DBIT" and not amount.startswith("-"):
        amount = f"-{amount}"
    label = " ".join(" ".join(t.get("remittance_information") or []).split()) or None
    booked = t.get("booking_date") or t.get("value_date") or t.get("transaction_date")
    ext = t.get("entry_reference") or t.get("transaction_id")
    if not ext:  # certaines banques n'exposent pas d'identifiant stable
        ext = "h:" + hashlib.sha1(f"{booked}|{amount}|{label}".encode()).hexdigest()
    return {"external_id": ext, "booked_on": booked, "amount": amount, "label": label}


def fetch_transactions(eb: httpx.Client, uid: str) -> list[dict]:
    params = {"date_from": (date.today() - timedelta(days=HISTORY_DAYS)).isoformat()}
    out = []
    while True:
        r = eb.get(f"/accounts/{uid}/transactions", params=params).raise_for_status().json()
        out += [t for t in r.get("transactions", []) if t.get("status", "BOOK") == "BOOK"]
        if not r.get("continuation_key"):
            return out
        params["continuation_key"] = r["continuation_key"]


def sync_session(eb: httpx.Client, lg: httpx.Client, c, s: dict) -> int:
    """Synchronise les comptes d'une session ; c = connexion base (None en mode fichier). Renvoie le nombre d'échecs."""
    today = date.today().isoformat()
    failures, last_error = 0, None
    for a in s["accounts"]:
        uid = a["uid"]
        ext = a.get("external_id") or f"eb:{uid}"
        try:
            d = eb.get(f"/accounts/{uid}/details").raise_for_status().json()
            bal = eb.get(f"/accounts/{uid}/balances").raise_for_status().json()["balances"]
            acc = lg.put("/accounts/sync", json={
                "external_id": ext,
                "source": "enablebanking",
                "institution": s["bank"],
                "name": d.get("name") or d.get("product") or uid,
                "type": TYPE_MAP.get(d.get("cash_account_type"), "autre"),
                "currency": account_currency(d, bal),
                "balance": pick_balance(bal),
                "day": today,
            }).raise_for_status().json()
            if c is not None:
                store.apply_holders(c, acc["id"], s.get("holders") or {})
                store.update_account_meta(c, s["session_id"], uid, d)
            txs = fetch_transactions(eb, uid)
            lg.post(f"/accounts/{ext}/transactions", json=[tx_to_ledger(t) for t in txs]).raise_for_status()
            print(f"[{s['bank']}] {d.get('name')}: solde={pick_balance(bal)} tx={len(txs)}")
        except httpx.HTTPStatusError as e:
            # Session expirée / consentement révoqué : le compte apparaîtra dans /stale
            failures += 1
            last_error = f"HTTP {e.response.status_code} sur {e.request.url.path}"
            print(f"[{s['bank']}] {uid}: ERREUR {e.response.status_code} {e.response.text[:200]}")
    if c is not None:
        c.execute("UPDATE bank_sessions SET last_sync_at = now(), last_error = %s WHERE session_id = %s",
                  (last_error, s["session_id"]))
    return failures


def notify(title: str, message: str, priority: int = 4) -> bool:
    """Web Push (via le ledger) + ntfy (même format que le ledger) ; un échec n'interrompt jamais la synchro."""
    pushed = False
    try:
        r = httpx.post(f"{LEDGER}/push/send", timeout=60,
                       json={"title": title, "body": message, "url": "/banques", "tag": "banque"})
        pushed = r.is_success and r.json().get("sent", 0) > 0
    except httpx.HTTPError as e:
        print(f"web push : échec ({type(e).__name__})")
    if not NTFY_TOPIC:
        return pushed
    headers = {"Authorization": f"Bearer {NTFY_TOKEN}"} if NTFY_TOKEN else {}
    try:
        httpx.post(NTFY_URL, headers=headers, timeout=10, json={
            "topic": NTFY_TOPIC, "title": title, "message": message, "priority": priority,
            "tags": ["bank"], "click": f"{APP_URL}/banques"}).raise_for_status()
        return True
    except httpx.HTTPError as e:
        print(f"ntfy : échec ({type(e).__name__})")
        return pushed


def notify_expiring(c) -> int:
    """Alerte unique à J-14 de la fin du consentement DSP2 (ou dès qu'une session est vue expirée)."""
    sent = 0
    for s in c.execute(
            """SELECT session_id, bank, valid_until, valid_until <= now() AS expired FROM bank_sessions
               WHERE status = 'active' AND expiry_notified_at IS NULL
                 AND valid_until < now() + make_interval(days => %s)""", (EXPIRY_NOTICE_DAYS,)).fetchall():
        when = s["valid_until"].astimezone().strftime("%d/%m/%Y")
        msg = (f"Accès expiré le {when}" if s["expired"] else f"Accès aux comptes jusqu'au {when}") + \
            " : écran Banques → « Renouveler » (validation forte chez la banque)."
        if notify(f"{s['bank']} : consentement à renouveler", msg):
            c.execute("UPDATE bank_sessions SET expiry_notified_at = now() WHERE session_id = %s", (s["session_id"],))
            sent += 1
    return sent


def run_sync(session_id: str | None = None) -> int:
    """Synchro de toutes les sessions actives (ou d'une seule) ; renvoie le nombre de comptes en échec."""
    failures = 0
    with client() as eb, ledger_client() as lg:
        if not store.DATABASE_URL:
            for s in load_sessions():
                failures += sync_session(eb, lg, None, {**s, "accounts": [{"uid": u} for u in s["accounts"]]})
            return failures
        with store.connect() as c:
            store.import_file_sessions(c)
            for s in store.active_sessions(c, session_id):
                failures += sync_session(eb, lg, c, s)
            if session_id is None:
                for s in c.execute("SELECT bank FROM bank_sessions WHERE status = 'active' AND valid_until <= now()").fetchall():
                    print(f"[{s['bank']}] session expirée : renouveler depuis l'écran Banques")
                notify_expiring(c)
    return failures


def cmd_sync(args):
    raise SystemExit(1 if run_sync() else 0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("banks"); b.add_argument("--country", default="FR"); b.set_defaults(fn=cmd_banks)
    l = sub.add_parser("link"); l.add_argument("bank"); l.add_argument("--country", default="FR")
    l.add_argument("--days", type=int, default=180); l.set_defaults(fn=cmd_link)
    se = sub.add_parser("session"); se.add_argument("code"); se.set_defaults(fn=cmd_session)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
