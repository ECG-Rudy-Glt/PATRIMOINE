"""Tests de ha_push.push() et du déclenchement différé (sans réseau).
Lancer depuis services/ledger : python -m unittest discover tests"""
import os
import time
import unittest
from unittest import mock

from app import ha_push

PAYLOAD = {"accounts": 3, "as_of": "2026-10-05", "total": 1.0}


class Reponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class PushTest(unittest.TestCase):
    def test_sans_url_ignore(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HA_WEBHOOK_URL", None)
            r = ha_push.push()
        self.assertEqual((r["ok"], r["skipped"]), (False, True))

    def test_succes_enregistre(self):
        with mock.patch.dict(os.environ, {"HA_WEBHOOK_URL": "http://ha/hook"}), \
                mock.patch.object(ha_push, "build_payload", return_value=PAYLOAD), \
                mock.patch.object(ha_push.urllib.request, "urlopen", return_value=Reponse()) as uo, \
                mock.patch.object(ha_push, "record_ok") as rec:
            r = ha_push.push()
        self.assertTrue(r["ok"])
        self.assertIn("3 comptes", r["detail"])
        self.assertEqual(uo.call_args[0][0].full_url, "http://ha/hook")
        rec.assert_called_once()

    def test_echec_ne_leve_pas_et_n_enregistre_pas(self):
        with mock.patch.dict(os.environ, {"HA_WEBHOOK_URL": "http://ha/hook"}), \
                mock.patch.object(ha_push, "build_payload", side_effect=OSError("ledger HS")), \
                mock.patch.object(ha_push, "record_ok") as rec:
            r = ha_push.push()
        self.assertEqual((r["ok"], r["skipped"]), (False, False))
        self.assertIn("ledger HS", r["detail"])
        rec.assert_not_called()

    def test_echec_webhook(self):
        with mock.patch.dict(os.environ, {"HA_WEBHOOK_URL": "http://ha/hook"}), \
                mock.patch.object(ha_push, "build_payload", return_value=PAYLOAD), \
                mock.patch.object(ha_push.urllib.request, "urlopen", side_effect=OSError("HA hors ligne")), \
                mock.patch.object(ha_push, "record_ok") as rec:
            self.assertFalse(ha_push.push()["ok"])
        rec.assert_not_called()

    def test_main_code_retour(self):
        with mock.patch.object(ha_push, "push", return_value={"ok": False, "skipped": False, "detail": "x"}):
            self.assertEqual(ha_push.main(), 1)
        with mock.patch.object(ha_push, "push", return_value={"ok": False, "skipped": True, "detail": "x"}):
            self.assertEqual(ha_push.main(), 0)


class TriggerTest(unittest.TestCase):
    def setUp(self):
        ha_push._last, ha_push._timer = None, None

    def tearDown(self):
        if ha_push._timer:
            ha_push._timer.cancel()

    def test_sans_url_rien(self):
        os.environ.pop("HA_WEBHOOK_URL", None)
        with mock.patch.object(ha_push, "push") as p:
            self.assertFalse(ha_push.trigger_async())
        p.assert_not_called()

    def test_une_fois_par_fenetre_puis_envoi_differe_unique(self):
        with mock.patch.dict(os.environ, {"HA_WEBHOOK_URL": "http://ha/hook"}), \
                mock.patch.object(ha_push, "push", return_value={"ok": True, "skipped": False, "detail": "ok"}) as p:
            self.assertTrue(ha_push.trigger_async())       # immédiat
            time.sleep(0.2)
            self.assertEqual(p.call_count, 1)
            self.assertTrue(ha_push.trigger_async())       # dans la fenêtre : différé
            self.assertFalse(ha_push.trigger_async())      # déjà planifié : rien de plus
            self.assertFalse(ha_push.trigger_async())
            self.assertEqual(p.call_count, 1)
            self.assertGreater(ha_push._timer.interval, 100)

    def test_ne_propage_jamais(self):
        with mock.patch.dict(os.environ, {"HA_WEBHOOK_URL": "http://ha/hook"}), \
                mock.patch.object(ha_push, "push", side_effect=RuntimeError("boum")):
            self.assertTrue(ha_push.trigger_async())
            time.sleep(0.2)                                # le thread journalise l'erreur sans planter


if __name__ == "__main__":
    unittest.main()
