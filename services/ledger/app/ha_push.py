"""Pousse un résumé du patrimoine vers Home Assistant (webhook local, CronJob `ha-push`).

Modèle push : le ledger reste interne au cluster (pas d'authentification, NetworkPolicy
api-internal-only) ; ce job le lit en interne et POSTe le résumé sur un webhook HA `local_only`
qui ne peut que mettre à jour des helpers d'affichage. Aucun jeton HA n'est stocké ici.

Variables : LEDGER_URL (http://ledger:8000), HA_WEBHOOK_URL (http://localhost/api/webhook/<id>). Sans HA_WEBHOOK_URL : ne fait rien.
Après un push réussi, l'horodatage est enregistré dans la table integrations (DATABASE_URL). Le ledger appelle
trigger_async() après chaque synchro bancaire (au plus un push toutes les 2 min).
Usage : python -m app.ha_push
"""
import json
import logging
import os
import sys
import threading
import time
import urllib.request

LEDGER_URL = os.environ.get("LEDGER_URL", "http://ledger:8000").rstrip("/")
BUDGET_URL = os.environ.get("BUDGET_URL", "http://budget-engine:8000").rstrip("/")
log = logging.getLogger("ha_push")


def get(path: str, base: str | None = None):
    with urllib.request.urlopen((base or LEDGER_URL) + path, timeout=15) as r:
        return json.load(r)


def num(v) -> float:
    return round(float(v or 0), 2)


def build_payload() -> dict:
    s = get("/summary") or {}
    persons = {p["name"].strip().lower(): p["id"] for p in get("/persons")}

    def person_networth(name: str) -> float:
        pid = persons.get(name)
        return num((get(f"/summary?person={pid}") or {}).get("networth")) if pid else 0.0

    out = {
        "total": num(s.get("networth")),
        "alex": person_networth("alex"),
        "sam": person_networth("sam"),
        "income_30d": num(s.get("income_30d")),
        "expense_30d": num(s.get("expense_30d")),
        "net_30d": num(s.get("net_30d")),
        "accounts": int(s.get("accounts") or 0),
        "stale": int(s.get("stale") or 0),
        "as_of": str(s.get("as_of") or ""),
    }
    # chiffres calculés par budget-engine (sans virements internes) : remplacent les 3 clés 30 j du ledger
    try:
        out.update(get("/budget/ha", BUDGET_URL) or {})
    except Exception as e:  # budget-engine indisponible : on pousse quand même les clés historiques
        log.warning("budget-engine /budget/ha : %s", e)
        print(f"budget-engine indisponible ({e}) : clés historiques seules")
    return out


def record_ok(detail: str) -> None:
    """Enregistre l'horodatage du dernier push réussi (table integrations, kind = 'ha'). Sans base : ignoré."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return
    try:
        import psycopg
        with psycopg.connect(dsn, autocommit=True, connect_timeout=5) as c:
            c.execute("""INSERT INTO integrations (kind, last_ok, detail) VALUES ('ha', now(), %s)
                         ON CONFLICT (kind) DO UPDATE SET last_ok = now(), detail = EXCLUDED.detail""", (detail,))
    except Exception as e:  # le suivi est secondaire : un échec ne doit pas faire échouer le push
        log.warning("integrations : %s", e)


def push() -> dict:
    """Construit et envoie le résumé au webhook HA ; ne lève jamais et ne quitte pas le processus.
    Retourne {"ok": bool, "skipped": bool, "detail": str}."""
    url = os.environ.get("HA_WEBHOOK_URL", "")
    if not url:
        return {"ok": False, "skipped": True, "detail": "HA_WEBHOOK_URL absent : rien à pousser"}
    try:
        payload = build_payload()
        req = urllib.request.Request(url, json.dumps(payload).encode(),
                                     {"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            detail = f"HA webhook : HTTP {r.status} ({payload['accounts']} comptes, valeur au {payload['as_of']})"
    except Exception as e:
        return {"ok": False, "skipped": False, "detail": f"échec : {e}"}
    record_ok(detail)
    return {"ok": True, "skipped": False, "detail": detail}


# --- déclenchement après une synchro bancaire (appelé par le ledger) ---------------------------
MIN_INTERVAL = 120.0   # secondes entre deux pushes déclenchés
_lock = threading.Lock()
_last: float | None = None          # instant (monotone) du dernier push démarré
_timer: threading.Timer | None = None


def _run() -> None:
    global _last
    with _lock:
        _last = time.monotonic()
    try:
        r = push()
        (log.info if r["ok"] else log.warning)("ha_push déclenché : %s", r["detail"])
    except Exception as e:  # jamais d'échec propagé
        log.warning("ha_push déclenché : %s", e)


def trigger_async() -> bool:
    """Lance push() en arrière-plan, au plus une fois toutes les 2 min : une synchro arrivant dans la fenêtre
    planifie un unique envoi différé (elle ne perd donc pas ses données). Non bloquant, ne lève jamais.
    Sans HA_WEBHOOK_URL : ne fait rien. Retourne True si un envoi est lancé ou planifié."""
    global _last, _timer
    try:
        if not os.environ.get("HA_WEBHOOK_URL"):
            return False
        with _lock:
            wait = 0.0 if _last is None else MIN_INTERVAL - (time.monotonic() - _last)
            if wait <= 0:
                _last = time.monotonic()    # réserve la fenêtre tout de suite
                threading.Thread(target=_run, daemon=True, name="ha-push").start()
                return True
            if _timer is None or not _timer.is_alive():
                _timer = threading.Timer(wait, _run)
                _timer.daemon = True
                _timer.start()
                return True
            return False                    # un envoi différé est déjà planifié
    except Exception as e:
        log.warning("ha_push trigger : %s", e)
        return False


def main() -> int:
    r = push()
    print(r["detail"])
    return 0 if r["ok"] or r["skipped"] else 1


if __name__ == "__main__":
    sys.exit(main())
