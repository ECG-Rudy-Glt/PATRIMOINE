"""Notifications Web Push (PWA installée : iPhone ≥ 16.4 depuis l'écran d'accueil, Android, bureau).

Clé VAPID : VAPID_PRIVATE_KEY (32 octets en base64url) ;
la clé publique en est dérivée. Sans clé : Web Push désactivé, ntfy et l'appli continuent comme avant.
Le message transite chiffré de bout en bout par le service de push du navigateur (Apple, Google, Mozilla) ;
il reprend le texte de la notification ntfy et s'affiche donc aussi sur l'écran verrouillé.
"""
import base64
import json
import logging
import os

from cryptography.hazmat.primitives import serialization

log = logging.getLogger("ledger.webpush")

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
# Contact exigé par les services de push (Apple refuse un « sub » absent) : l'URL publique de l'appli suffit
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT") or os.environ.get("APP_URL") or "mailto:admin@example.org"


def enabled() -> bool:
    return bool(VAPID_PRIVATE_KEY)


def public_key() -> str | None:
    """Clé publique VAPID (point non compressé, base64url) attendue par PushManager.subscribe()."""
    if not enabled():
        return None
    from py_vapid import Vapid02
    raw = Vapid02.from_string(VAPID_PRIVATE_KEY).public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def device_label(user_agent: str) -> str:
    ua = user_agent or ""
    for needle, label in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Macintosh", "Mac"),
                          ("Windows", "Windows"), ("Linux", "Linux")):
        if needle in ua:
            return label
    return "Navigateur"


def send_all(c, title: str, body: str, url: str = "/", tag: str | None = None) -> int:
    """Envoie à tous les appareils abonnés ; retourne le nombre d'envois réussis.
    Abonnement expiré (404/410) : supprimé. Autre échec : compteur, supprimé après 5 échecs de suite.
    Ne lève jamais : une notification ratée ne doit pas faire échouer l'appelant (synchro, rapport)."""
    if not enabled():
        return 0
    from pywebpush import WebPushException, webpush
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    for s in c.execute("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").fetchall():
        try:
            webpush({"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}, payload,
                     vapid_private_key=VAPID_PRIVATE_KEY, vapid_claims={"sub": VAPID_SUBJECT},
                     ttl=24 * 3600, timeout=10, headers={"Urgency": "normal"})
            c.execute("UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = %s", (s["id"],))
            sent += 1
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                c.execute("DELETE FROM push_subscriptions WHERE id = %s", (s["id"],))
                log.warning("web push : abonnement %s expiré, supprimé", s["id"])
            else:
                c.execute("""DELETE FROM push_subscriptions WHERE id = %s AND failures >= 4""", (s["id"],))
                c.execute("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = %s", (s["id"],))
                log.warning("web push : abonnement %s en échec (HTTP %s)", s["id"], status)
        except Exception as e:  # réseau, clé invalide…
            log.warning("web push : abonnement %s : %s", s["id"], type(e).__name__)
    return sent
