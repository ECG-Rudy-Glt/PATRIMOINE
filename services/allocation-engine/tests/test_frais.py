"""Projection des frais (fonction pure, sans base). Lancer depuis services/allocation-engine : python -m unittest discover tests"""
import os
import unittest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
from app import main as al  # noqa: E402


class ProjectionTest(unittest.TestCase):
    def test_sans_frais_ni_versement_croissance_composee(self):
        self.assertAlmostEqual(al.project(1000, 0, 10, 5), 1000 * 1.05 ** 10, places=4)

    def test_les_frais_reduisent_la_valeur_finale(self):
        sans = al.project(10000, 100, 20, 5)
        avec = al.project(10000, 100, 20, 5, prop_pct=1.0)
        self.assertLess(avec, sans)
        self.assertGreater(sans - avec, 0)

    def test_frais_d_entree_et_forfait(self):
        base = al.project(0, 100, 10, 0)
        self.assertAlmostEqual(base, 12000, places=2)                      # 100 €/mois pendant 10 ans, rendement nul
        self.assertAlmostEqual(al.project(0, 100, 10, 0, entry_pct=5), 11400, places=2)
        self.assertAlmostEqual(al.project(1000, 0, 1, 0, fixed_eur=120), 880, places=2)

    def test_la_valeur_ne_devient_jamais_negative(self):
        self.assertEqual(al.project(10, 0, 5, 0, fixed_eur=1200), 0.0)


if __name__ == "__main__":
    unittest.main()
