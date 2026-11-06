"""Tests : Web Push (clé VAPID, envoi, purge des abonnements expirés), sans réseau ni base.
Lancer depuis services/ledger : python -m unittest discover tests"""
import base64
import json
import os
import unittest
from unittest import mock

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:x@localhost:5432/postgres")
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
from pywebpush import WebPushException  # noqa: E402

from app import webpush  # noqa: E402

PRIV = base64.urlsafe_b64encode(ec.generate_private_key(ec.SECP256R1()).private_numbers().private_value.to_bytes(32, "big")).rstrip(b"=").decode()


class FakeConn:
    """Imite une connexion psycopg (row_factory dict) : abonnements en mémoire, requêtes journalisées."""
    def __init__(self, subs):
        self.subs, self.sql = subs, []

    def execute(self, sql, params=()):
        self.sql.append((" ".join(sql.split()), params))
        res = mock.Mock()
        res.fetchall.return_value = list(self.subs)
        return res


def sub(i):
    return {"id": i, "endpoint": f"https://push.example/{i}", "p256dh": "k", "auth": "a"}


def refus(status):
    return WebPushException("refus", response=mock.Mock(status_code=status))


@mock.patch.object(webpush, "VAPID_PRIVATE_KEY", PRIV)
class WebPushTest(unittest.TestCase):
    def test_cle_publique_point_non_compresse(self):
        raw = base64.urlsafe_b64decode(webpush.public_key() + "==")
        self.assertEqual((len(raw), raw[0]), (65, 4))

    def test_desactive_sans_cle(self):
        with mock.patch.object(webpush, "VAPID_PRIVATE_KEY", ""):
            self.assertIsNone(webpush.public_key())
            self.assertEqual(webpush.send_all(FakeConn([sub(1)]), "t", "b"), 0)

    def test_envoi_et_charge_utile(self):
        c = FakeConn([sub(1), sub(2)])
        with mock.patch("pywebpush.webpush") as wp:
            self.assertEqual(webpush.send_all(c, "Solde bas", "Compte : 12 €", "/alertes", "solde_bas"), 2)
        info, payload = wp.call_args.args
        self.assertEqual(info["endpoint"], "https://push.example/2")
        self.assertEqual(json.loads(payload), {"title": "Solde bas", "body": "Compte : 12 €", "url": "/alertes", "tag": "solde_bas"})
        self.assertTrue(wp.call_args.kwargs["vapid_claims"]["sub"].startswith(("https://", "mailto:")))

    def test_abonnement_expire_supprime_les_autres_continuent(self):
        c = FakeConn([sub(1), sub(2)])
        with mock.patch("pywebpush.webpush", side_effect=[refus(410), None]):
            self.assertEqual(webpush.send_all(c, "t", "b"), 1)
        self.assertIn(("DELETE FROM push_subscriptions WHERE id = %s", (1,)), c.sql)

    def test_echec_temporaire_compte_sans_supprimer(self):
        c = FakeConn([sub(3)])
        with mock.patch("pywebpush.webpush", side_effect=refus(500)):
            self.assertEqual(webpush.send_all(c, "t", "b"), 0)
        self.assertNotIn(("DELETE FROM push_subscriptions WHERE id = %s", (3,)), c.sql)
        self.assertTrue(any("failures = failures + 1" in q for q, _ in c.sql))

    def test_appareil(self):
        self.assertEqual(webpush.device_label("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone")
        self.assertEqual(webpush.device_label("Mozilla/5.0 (Linux; Android 15; SM-S921B) SamsungBrowser/27"), "Android")


if __name__ == "__main__":
    unittest.main()
