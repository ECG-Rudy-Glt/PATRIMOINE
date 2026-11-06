"""API « Banques » : ajout / renouvellement d'une banque Enable Banking depuis l'interface, et synchro.

Tourne dans le seul pod qui monte le volume patrimoine-bank (clé privée, RWO) ; le CronJob bank-sync
appelle POST /internal/sync. Exposée par le proxy web sous /api/bank/* (derrière Authentik) ; /internal/*
n'est pas proxifié. Pas de journal d'accès uvicorn (--no-access-log) : l'URL de retour porte le code.
"""
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from . import enablebanking as eb
from . import store

app = FastAPI(title="bank")
log = logging.getLogger("bank")
SYNC_LOCK = threading.Lock()   # une seule synchro à la fois (quota DSP2, cohérence des imports)
ASPSP_TTL = 6 * 3600
_aspsps: dict[str, tuple[float, list[dict]]] = {}
MAX_DAYS = 180


@app.on_event("startup")
def _import():
    try:
        with store.connect() as c:
            store.import_file_sessions(c)
    except Exception as e:  # table absente (ledger pas encore migré) : réessayé à chaque synchro
        log.warning("reprise de sessions.json reportée : %s", type(e).__name__)


@app.get("/health")
def health():
    return {"status": "ok"}


def aspsps(country: str) -> list[dict]:
    """Banques disponibles (cache 6 h) : nom exact, logo, durée maximale du consentement en jours."""
    hit = _aspsps.get(country)
    if hit and time.time() - hit[0] < ASPSP_TTL:
        return hit[1]
    with eb.client() as c:
        raw = c.get("/aspsps", params={"country": country, "psu_type": "personal"}).raise_for_status().json()["aspsps"]
    banks = sorted(({"name": a["name"], "country": a.get("country", country), "logo": a.get("logo"),
                     "max_days": min(MAX_DAYS, (a.get("maximum_consent_validity") or MAX_DAYS * 86400) // 86400),
                     "beta": bool(a.get("beta"))}
                    for a in raw if "personal" in (a.get("psu_types") or ["personal"])), key=lambda a: a["name"].lower())
    _aspsps[country] = (time.time(), banks)
    return banks


@app.get("/bank/aspsps")
def list_aspsps(country: str = "FR"):
    try:
        return aspsps(country.upper()[:2])
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Enable Banking injoignable ({type(e).__name__})")


@app.get("/bank/sessions")
def list_sessions():
    with store.connect() as c:
        return c.execute(
            """SELECT s.session_id, s.bank, s.country, s.valid_until, s.status, s.source, s.created_at,
                      s.last_sync_at, s.last_error, s.holders,
                      s.status = 'active' AND s.valid_until > now() AS active,
                      floor(extract(epoch FROM s.valid_until - now()) / 86400)::int AS days_left,
                      COALESCE((SELECT json_agg(json_build_object('uid', x->>'uid', 'name', COALESCE(a.name, x->>'name'),
                                   'account_id', a.id, 'type', a.type, 'last_sync_at', a.last_sync_at,
                                   'holders', (SELECT string_agg(p.name, ' / ' ORDER BY p.id) FROM account_holders h
                                               JOIN persons p ON p.id = h.person_id WHERE h.account_id = a.id)))
                                FROM jsonb_array_elements(s.accounts) x
                                LEFT JOIN accounts a ON a.external_id = x->>'external_id'), '[]') AS accounts
               FROM bank_sessions s ORDER BY s.status, s.valid_until DESC""").fetchall()


class AuthIn(BaseModel):
    bank: str
    country: str = "FR"
    holders: list[int] = []      # personnes du foyer titulaires des comptes de cette banque


def start_auth(c, bank: str, country: str, holders: dict, renew_of: str | None) -> dict:
    """POST /auth Enable Banking avec un state aléatoire (hash stocké, usage unique, 15 min)."""
    try:
        known = {a["name"]: a for a in aspsps(country)}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Enable Banking injoignable ({type(e).__name__})")
    if bank not in known:
        raise HTTPException(422, "Banque inconnue chez Enable Banking")
    state = secrets.token_urlsafe(32)
    c.execute("DELETE FROM bank_auth_states WHERE created_at < now() - interval '1 day'")
    c.execute("INSERT INTO bank_auth_states (state_hash, bank, country, holders, renew_of) VALUES (%s,%s,%s,%s,%s)",
              (store.state_hash(state), bank, country, Jsonb(holders), renew_of))
    valid_until = datetime.now(timezone.utc) + timedelta(days=known[bank]["max_days"])
    try:
        with eb.client() as e:
            r = e.post("/auth", json={
                "access": {"valid_until": valid_until.isoformat()},
                "aspsp": {"name": bank, "country": country},
                "state": state,
                "redirect_url": f"{eb.APP_URL}/api/bank/callback",
                "psu_type": "personal",
            })
    except httpx.HTTPError as ex:
        raise HTTPException(502, f"Enable Banking injoignable ({type(ex).__name__})")
    if r.is_error:
        log.warning("POST /auth refusé : HTTP %s", r.status_code)
        raise HTTPException(502, f"Enable Banking a refusé la demande (HTTP {r.status_code}) : {r.text[:200]}")
    return {"url": r.json()["url"]}


@app.post("/bank/auth")
def auth(body: AuthIn):
    country = body.country.upper()[:2]
    with store.connect() as c:
        ids = {r["id"] for r in c.execute("SELECT id FROM persons").fetchall()}
        if not body.holders or not set(body.holders) <= ids:
            raise HTTPException(422, "Choisir au moins un titulaire du foyer")
        return start_auth(c, body.bank, country, store.split_holders(body.holders), None)


@app.post("/bank/sessions/{session_id}/renew")
def renew(session_id: str):
    """Relance le flux pour la même banque ; les comptes déjà suivis sont retrouvés (identification_hash / IBAN)."""
    with store.connect() as c:
        s = c.execute("SELECT * FROM bank_sessions WHERE session_id = %s", (session_id,)).fetchone()
        if not s:
            raise HTTPException(404, "Session inconnue")
        return start_auth(c, s["bank"], s["country"].strip(), s["holders"], session_id)


def back(**params) -> RedirectResponse:
    return RedirectResponse(f"/banques?{urlencode(params)}", status_code=303)


def first_sync(session_id: str):
    with SYNC_LOCK:
        try:
            eb.run_sync(session_id)
        except Exception as e:
            log.warning("première synchro %s : %s", session_id[:8], type(e).__name__)


@app.get("/bank/callback")
def callback(tasks: BackgroundTasks, state: str = "", code: str = "", error: str = "", error_description: str = ""):
    """Retour de la banque (GET imposé par la redirection). Le state est consommé avant tout appel."""
    with store.connect() as c:
        st = c.execute(
            """UPDATE bank_auth_states SET used_at = now()
               WHERE state_hash = %s AND used_at IS NULL AND expires_at > now() RETURNING *""",
            (store.state_hash(state),)).fetchone() if state else None
        if not st:
            return back(erreur="Lien d'autorisation invalide ou expiré : relancer depuis l'écran Banques.")
        if error or not code:
            return back(erreur=f"{st['bank']} : autorisation non accordée ({error or 'code absent'}). {error_description[:200]}".strip())
        try:
            with eb.client() as e:
                s = e.post("/sessions", json={"code": code}).raise_for_status().json()
        except httpx.HTTPStatusError as ex:
            log.warning("POST /sessions refusé : HTTP %s", ex.response.status_code)
            return back(erreur=f"{st['bank']} : session refusée par Enable Banking (HTTP {ex.response.status_code}).")
        except httpx.HTTPError as ex:
            return back(erreur=f"{st['bank']} : Enable Banking injoignable ({type(ex).__name__}).")
        row = store.save_session(c, s, st["country"].strip(), st["holders"], "web", st["renew_of"])
    n = len(row["accounts"])
    if n:
        tasks.add_task(first_sync, row["session_id"])
    return back(ok=row["bank"], comptes=n, jusqu=row["valid_until"].date().isoformat())


@app.post("/internal/sync")
def sync():
    """Appelé par le CronJob bank-sync ; 500 si un compte échoue (le Job apparaît en échec, sans nouvel essai)."""
    with SYNC_LOCK:
        failures = eb.run_sync()
    if failures:
        raise HTTPException(500, f"{failures} compte(s) en échec")
    return {"ok": True}
