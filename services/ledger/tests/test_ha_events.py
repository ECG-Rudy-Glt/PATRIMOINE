"""Tests : webhook d'événements Home Assistant (notify) et détection de la paie.
Lancer depuis services/ledger : DATABASE_URL=postgresql://... python -m unittest discover tests
Le test de paie exige une base jetable avec le jeu de test (compte 1 = Alex) ; ignoré sans TEST_PAIE_DB=1."""
import json
import os
import threading
import time
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:x@localhost:5432/postgres")
from app import main  # noqa: E402


def serveur(handler_fn):
    """Petit serveur HTTP local ; retourne (url, liste des corps reçus, arrêt)."""
    recus: list = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            recus.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            handler_fn(self)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_port}/hook", recus, srv.shutdown


def ok(h):
    h.send_response(200)
    h.end_headers()


class NotifyTest(unittest.TestCase):
    def test_json_recu_sans_ntfy(self):
        url, recus, stop = serveur(ok)
        self.addCleanup(stop)
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": url}), mock.patch.object(main, "NTFY_TOPIC", ""):
            self.assertFalse(main.notify("Titre", "Message", priority=4, tags="warning,x", event="solde_bas"))
        self.assertEqual(len(recus), 1)
        r = recus[0]
        self.assertEqual((r["event"], r["title"], r["message"], r["priority"], r["tags"]),
                         ("solde_bas", "Titre", "Message", 4, ["warning", "x"]))
        self.assertIn("T", r["ts"])

    def test_evenement_par_defaut(self):
        url, recus, stop = serveur(ok)
        self.addCleanup(stop)
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": url}):
            main.notify("t", "m")
        self.assertEqual(recus[0]["event"], "alerte")

    def test_sans_url_rien_a_faire(self):
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": ""}), mock.patch.object(main, "NTFY_TOPIC", ""):
            self.assertFalse(main.notify("t", "m"))

    def test_erreur_http_ne_leve_pas(self):
        def ko(h):
            h.send_response(500)
            h.end_headers()
        url, recus, stop = serveur(ko)
        self.addCleanup(stop)
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": url}):
            main.notify("t", "m")
        self.assertEqual(len(recus), 1)

    def test_serveur_injoignable_ne_leve_pas(self):
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": "http://127.0.0.1:9/hook"}):
            main.notify("t", "m")

    def test_delai_borne(self):
        def lent(h):
            time.sleep(8)
        url, _, stop = serveur(lent)
        self.addCleanup(stop)
        with mock.patch.dict(os.environ, {"HA_EVENTS_WEBHOOK_URL": url}):
            t0 = time.time()
            main.notify("t", "m")
        self.assertLess(time.time() - t0, 7)


@unittest.skipUnless(os.environ.get("TEST_PAIE_DB"), "base jetable requise (TEST_PAIE_DB=1)")
class PaieTest(unittest.TestCase):
    def poster(self, txs):
        from fastapi.testclient import TestClient
        envoyees: list = []
        with TestClient(main.app) as c, mock.patch.object(main, "notify", lambda *a, **k: envoyees.append((a, k))):
            r = c.post("/accounts/test-paie/transactions", json=txs)
            self.assertEqual(r.status_code, 200, r.text)
        return [e for e in envoyees if e[1].get("event") == "paie"]

    def test_paie(self):
        main.pool.open()
        with main.pool.connection() as c:
            c.execute("UPDATE accounts SET external_id = 'test-paie' WHERE id = 1")
            c.execute("DELETE FROM transactions WHERE external_id LIKE 'paie-test-%'")
        auj = date.today()
        recente = {"external_id": "paie-test-1", "booked_on": str(auj - timedelta(days=1)), "amount": "2100.50",
                   "label": "VIR SEPA SALAIRE TEST"}
        vieille = {"external_id": "paie-test-2", "booked_on": str(auj - timedelta(days=40)), "amount": "2000",
                   "label": "VIR SEPA SALAIRE TEST"}
        n = self.poster([recente])
        self.assertEqual(len(n), 1)
        self.assertIn("Alex", n[0][0][1])
        self.assertIn("2100.50", n[0][0][1])
        self.assertEqual(len(self.poster([recente])), 0)       # réimport : rien
        self.assertEqual(len(self.poster([vieille])), 0)       # historique : rien


if __name__ == "__main__":
    unittest.main()
