"""Fonctions pures du moteur budgétaire (sans base). Lancer depuis services/budget-engine : python -m unittest discover tests"""
import os
import unittest
from datetime import date
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
from app import main as be  # noqa: E402


def mv(i, acc, jour, montant, kind="internal"):
    return {"id": i, "account_id": acc, "booked_on": date(2026, 10, jour), "amount": Decimal(montant), "kind": kind}


class MarchandTest(unittest.TestCase):
    def test_libelles_carte(self):
        self.assertEqual(be.merchant_key("CB AMAZON PAYMENTS FACT 150926 874076******9"), "AMAZON PAYMENTS")
        self.assertEqual(be.merchant_key("PRLV SEPA SPOTIFY 12345678"), "SPOTIFY")

    def test_contrepartie(self):
        self.assertEqual(be.counterpart("VIR INST GAULT ALEX N2"), "GAULT ALEX N2")
        self.assertEqual(be.counterpart(None), "COMPTE NON SUIVI")


class AppariementTest(unittest.TestCase):
    def test_debit_et_credit_apparies(self):
        pairs = be.pair_transfers([mv(1, 1, 1, "-100"), mv(2, 2, 2, "100")])
        self.assertEqual(len(pairs), 1)
        self.assertEqual((pairs[0]["out"]["id"], pairs[0]["in"]["id"]), (1, 2))

    def test_montants_differents_ou_trop_eloignes(self):
        self.assertEqual(be.pair_transfers([mv(1, 1, 1, "-100"), mv(2, 2, 2, "99")]), [])
        self.assertEqual(be.pair_transfers([mv(1, 1, 1, "-100"), mv(2, 2, 9, "100")]), [])

    def test_meme_compte_jamais_apparie_et_credit_utilise_une_fois(self):
        self.assertEqual(be.pair_transfers([mv(1, 1, 1, "-100"), mv(2, 1, 1, "100")]), [])
        p = be.pair_transfers([mv(1, 1, 1, "-50"), mv(2, 1, 2, "-50"), mv(3, 2, 2, "50")])
        self.assertEqual(len(p), 1)


class CyclesTest(unittest.TestCase):
    def test_cycle_supprime_solde_net_conserve(self):
        links = {(1, 2): Decimal(10), (2, 1): Decimal(4)}
        be.cancel_cycles(links, {1, 2})
        self.assertEqual(links, {(1, 2): Decimal(6)})

    def test_pas_de_cycle_inchange(self):
        links = {(1, 2): Decimal(5), (2, 3): Decimal(5)}
        be.cancel_cycles(links, {1, 2, 3})
        self.assertEqual(len(links), 2)


class FiscalTest(unittest.TestCase):
    RULES = {"lep.rfr.base": {"value": Decimal("23028")}, "lep.rfr.demi_part": {"value": Decimal("6149")}}

    def test_plafond_lep_par_parts(self):
        self.assertEqual(be.lep_ceiling(self.RULES, Decimal("1")), 23028)
        self.assertEqual(be.lep_ceiling(self.RULES, Decimal("1.5")), 29177)
        self.assertEqual(be.lep_ceiling(self.RULES, Decimal("2")), 35326)

    def test_nature_du_livret_d_apres_le_nom(self):
        for nom, kind in (("LEP Sam", "lep"), ("LDDS Sam", "ldds"), ("Livret bleu Sam", "livret_a"), ("Livret A Alex", "livret_a"),
                          ("Livret jeune Alex", None), ("Épargne populaire", "lep")):
            self.assertEqual(be.infer_savings_kind(nom), kind, nom)


class ContratsEvitablesTest(unittest.TestCase):
    def test_chaque_categorie_evitable_existe_une_fois(self):
        codes = [c for _, _, cats in be.AVOID_GROUPS for c in cats]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertIn("telecom", codes)


if __name__ == "__main__":
    unittest.main()
