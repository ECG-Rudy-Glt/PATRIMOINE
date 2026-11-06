"""Chemin de synchro bancaire : fonctions pures (sans réseau ni base). Lancer depuis services/ingestion-bank : python -m unittest discover tests"""
import os
import unittest
from decimal import Decimal

os.environ.setdefault("EB_APP_ID", "test")
from app import enablebanking as eb  # noqa: E402
from app import store  # noqa: E402


class TransactionsTest(unittest.TestCase):
    def test_debit_devient_negatif(self):
        t = eb.tx_to_ledger({"transaction_amount": {"amount": "12.50"}, "credit_debit_indicator": "DBIT", "booking_date": "2026-10-01",
                             "remittance_information": ["CB  SPOTIFY", "P46C781"], "entry_reference": "r1"})
        self.assertEqual((t["amount"], t["external_id"], t["label"], t["booked_on"]), ("-12.50", "r1", "CB SPOTIFY P46C781", "2026-10-01"))

    def test_credit_et_debit_deja_negatif(self):
        self.assertEqual(eb.tx_to_ledger({"transaction_amount": {"amount": "1800"}, "credit_debit_indicator": "CRDT", "booking_date": "2026-10-02", "entry_reference": "a"})["amount"], "1800")
        self.assertEqual(eb.tx_to_ledger({"transaction_amount": {"amount": "-5"}, "credit_debit_indicator": "DBIT", "booking_date": "2026-10-02", "entry_reference": "b"})["amount"], "-5")

    def test_identifiant_stable_sans_reference(self):
        t = {"transaction_amount": {"amount": "3"}, "credit_debit_indicator": "DBIT", "booking_date": "2026-10-03", "remittance_information": ["X"]}
        self.assertEqual(eb.tx_to_ledger(t)["external_id"], eb.tx_to_ledger(dict(t))["external_id"])
        self.assertTrue(eb.tx_to_ledger(t)["external_id"].startswith("h:"))


class SoldesTest(unittest.TestCase):
    def test_solde_prefere_le_disponible_reel(self):
        bal = [{"balance_type": "OTHR", "balance_amount": {"amount": "1"}}, {"balance_type": "CLBD", "balance_amount": {"amount": "577.98"}}]
        self.assertEqual(eb.pick_balance(bal), "577.98")
        self.assertEqual(eb.pick_balance([]), "0")

    def test_devise_xxx_remplacee_par_celle_du_solde(self):
        self.assertEqual(eb.account_currency({"currency": "XXX"}, [{"balance_amount": {"currency": "EUR"}}]), "EUR")
        self.assertEqual(eb.account_currency({"currency": "USD"}, []), "USD")

    def test_types_de_comptes(self):
        self.assertEqual(eb.TYPE_MAP["CACC"], "courant")
        self.assertEqual(eb.TYPE_MAP["SVGS"], "livret")


class SessionsTest(unittest.TestCase):
    def test_titulaires_somme_egale_un(self):
        for ids in ([1], [1, 2], [1, 2, 3], [3, 1]):
            shares = store.split_holders(ids)
            self.assertEqual(sum(Decimal(v) for v in shares.values()), Decimal(1), ids)
        self.assertEqual(store.split_holders([]), {})

    def test_hash_du_state_deterministe_et_non_reversible(self):
        self.assertEqual(store.state_hash("abc"), store.state_hash("abc"))
        self.assertNotEqual(store.state_hash("abc"), "abc")
        self.assertEqual(len(store.state_hash("abc")), 64)


if __name__ == "__main__":
    unittest.main()
