"""Sessions Enable Banking en base (table bank_sessions, migration 017) + reprise de sessions.json."""
import hashlib
import json
import logging
import os
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DATABASE_URL = os.environ.get("DATABASE_URL", "")
SESSIONS_FILE = Path(os.environ.get("EB_SESSIONS_FILE", "/secrets/sessions.json"))
log = logging.getLogger("bank")


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


def state_hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def split_holders(person_ids: list[int]) -> dict[str, str]:
    """Parts égales (3 décimales, comme account_holders.share), le reste sur le dernier : somme = 1."""
    ids = sorted(set(person_ids))
    if not ids:
        return {}
    part = (Decimal(1) / len(ids)).quantize(Decimal("0.001"))
    shares = {str(p): str(part) for p in ids[:-1]}
    shares[str(ids[-1])] = str(Decimal(1) - part * (len(ids) - 1))
    return shares


def import_file_sessions(c) -> int:
    """Reprise idempotente des sessions de l'ancien fichier (rien n'est écrasé : ON CONFLICT DO NOTHING)."""
    if not SESSIONS_FILE.exists():
        return 0
    n = 0
    for s in json.loads(SESSIONS_FILE.read_text()):
        accounts = [{"uid": u, "external_id": f"eb:{u}"} for u in s.get("accounts", [])]
        n += c.execute(
            """INSERT INTO bank_sessions (session_id, bank, valid_until, accounts, source)
               VALUES (%s, %s, %s, %s, 'fichier') ON CONFLICT (session_id) DO NOTHING""",
            (s["session_id"], s["bank"], s["valid_until"], Jsonb(accounts))).rowcount
    if n:
        log.warning("sessions.json : %d session(s) reprise(s) en base", n)
    return n


def active_sessions(c, session_id: str | None = None) -> list[dict]:
    return c.execute(
        """SELECT * FROM bank_sessions WHERE status = 'active' AND valid_until > now()
           AND (%(id)s::text IS NULL OR session_id = %(id)s) ORDER BY created_at""", {"id": session_id}).fetchall()


def match_external_ids(c, bank: str, country: str, accounts: list[dict]) -> list[dict]:
    """Comptes d'une nouvelle session -> external_id du ledger. Les uid Enable Banking changent à chaque
    session : on retrouve le compte déjà suivi par identification_hash puis par IBAN (sinon eb:<uid>)."""
    known = {}
    for s in c.execute("SELECT accounts FROM bank_sessions WHERE bank = %s AND country = %s ORDER BY created_at",
                       (bank, country)).fetchall():
        for a in s["accounts"]:
            for k in ("identification_hash", "iban"):
                if a.get(k) and a.get("external_id"):
                    known[(k, a[k])] = a["external_id"]
    out = []
    for a in accounts:
        iban = (a.get("account_id") or {}).get("iban") or a.get("iban")
        h = a.get("identification_hash")
        ext = known.get(("identification_hash", h)) if h else None
        ext = ext or (known.get(("iban", iban)) if iban else None) or f"eb:{a['uid']}"
        out.append({"uid": a["uid"], "external_id": ext, "name": a.get("name") or a.get("product"),
                    "iban": iban, "identification_hash": h})
    return out


def save_session(c, s: dict, country: str, holders: dict, source: str, renew_of: str | None = None) -> dict:
    """Enregistre la réponse de POST /sessions ; les sessions de la même banque dont tous les comptes sont
    repris (et celle explicitement renouvelée) passent à « remplacee » pour ne pas synchroniser deux fois."""
    bank = s["aspsp"]["name"]
    accounts = match_external_ids(c, bank, country, s.get("accounts") or [])
    with c.transaction():
        row = c.execute(
            """INSERT INTO bank_sessions (session_id, bank, country, valid_until, accounts, holders, source)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (session_id) DO UPDATE SET valid_until = EXCLUDED.valid_until, accounts = EXCLUDED.accounts,
                 holders = EXCLUDED.holders, status = 'active'
               RETURNING *""",
            (s["session_id"], bank, country, s["access"]["valid_until"], Jsonb(accounts), Jsonb(holders), source)).fetchone()
        exts = [a["external_id"] for a in accounts]
        c.execute(
            """UPDATE bank_sessions o SET status = 'remplacee'
               WHERE o.status = 'active' AND o.session_id <> %(id)s AND o.bank = %(bank)s AND o.country = %(country)s
                 AND (o.session_id = %(renew)s OR (jsonb_array_length(o.accounts) > 0 AND NOT EXISTS (
                      SELECT 1 FROM jsonb_array_elements(o.accounts) a WHERE NOT (a->>'external_id' = ANY(%(exts)s::text[])))))""",
            {"id": s["session_id"], "bank": bank, "country": country, "renew": renew_of, "exts": exts})
    return row


def update_account_meta(c, session_id: str, uid: str, details: dict):
    """Complète iban / identification_hash d'un compte (sessions reprises du fichier) pour les futurs renouvellements."""
    meta = {k: v for k, v in {"iban": (details.get("account_id") or {}).get("iban"),
                              "identification_hash": details.get("identification_hash"),
                              "name": details.get("name") or details.get("product")}.items() if v}
    if meta:
        c.execute(
            """UPDATE bank_sessions SET accounts = (
                 SELECT jsonb_agg(CASE WHEN a->>'uid' = %s THEN a || %s ELSE a END) FROM jsonb_array_elements(accounts) a)
               WHERE session_id = %s""", (uid, Jsonb(meta), session_id))


def apply_holders(c, account_id: int, holders: dict):
    """Titulaires choisis à l'ajout de la banque, seulement si le compte n'en a encore aucun."""
    if not holders:
        return
    c.execute(
        """INSERT INTO account_holders (account_id, person_id, share)
           SELECT %(acc)s, h.key::int, h.value::numeric FROM jsonb_each_text(%(h)s) h
           WHERE h.key::int IN (SELECT id FROM persons)
             AND NOT EXISTS (SELECT 1 FROM account_holders WHERE account_id = %(acc)s)
           ON CONFLICT DO NOTHING""", {"acc": account_id, "h": Jsonb(holders)})
