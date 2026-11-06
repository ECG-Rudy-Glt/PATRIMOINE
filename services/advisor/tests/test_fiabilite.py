"""Règles de fiabilité du conseiller (sans réseau ni base). Lancer depuis services/advisor : python -m unittest discover tests"""
import os
import unittest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
from app import main as adv  # noqa: E402

SEEN = {"https://www.touslesforfaits.fr/comparatif", "https://selectra.info/telecom/mobile"}
CONTRAT = {"id": "c1", "mensuel": 16.0, "facturation": "mensuelle"}


def offre(**kw):
    return {"fournisseur": "X", "offre": "Forfait", "prix_mensuel": 9.99, "source_url": "https://www.touslesforfaits.fr/comparatif", **kw}


class OffresTest(unittest.TestCase):
    def test_offre_valide_economie_calculee_par_le_code(self):
        kept, rej = adv.filter_alternatives(CONTRAT, [offre()], SEEN)
        self.assertEqual(rej, 0)
        self.assertEqual(kept[0]["economie_annuelle"], round((16.0 - 9.99) * 12))
        self.assertFalse(kept[0]["economie_estimee"])

    def test_economie_modele_ignoree(self):
        kept, _ = adv.filter_alternatives(CONTRAT, [offre(economie_annuelle=99999)], SEEN)
        self.assertNotEqual(kept[0]["economie_annuelle"], 99999)

    def test_source_non_consultee_rejetee(self):
        kept, rej = adv.filter_alternatives(CONTRAT, [offre(source_url="https://inventé.example/offre")], SEEN)
        self.assertEqual((kept, rej), ([], 1))

    def test_sans_prix_ou_prix_invalide_rejetee(self):
        for prix in (None, "9,99", 0, -3, True):
            kept, rej = adv.filter_alternatives(CONTRAT, [offre(prix_mensuel=prix)], SEEN)
            self.assertEqual((kept, rej), ([], 1), prix)

    def test_pas_moins_chere_rejetee(self):
        kept, rej = adv.filter_alternatives(CONTRAT, [offre(prix_mensuel=15.9)], SEEN)
        self.assertEqual((kept, rej), ([], 1))

    def test_montant_estime_marque_et_tri_par_economie(self):
        c = {"id": "c2", "mensuel": 20.0, "facturation": "moyenne mensuelle observée"}
        kept, _ = adv.filter_alternatives(c, [offre(prix_mensuel=15), offre(prix_mensuel=8, source_url="https://selectra.info/telecom/mobile")], SEEN)
        self.assertEqual([k["prix_mensuel"] for k in kept], [8, 15])
        self.assertTrue(all(k["economie_estimee"] for k in kept))

    def test_url_ok(self):
        self.assertTrue(adv._url_ok("https://selectra.info/telecom/mobile/", SEEN))
        self.assertTrue(adv._url_ok("https://selectra.info/telecom", SEEN))      # préfixe d'une page consultée
        self.assertFalse(adv._url_ok("", SEEN))
        self.assertFalse(adv._url_ok("ftp://selectra.info/telecom/mobile", SEEN))


class ContexteTest(unittest.TestCase):
    def test_echec_de_recherche_detecte(self):
        for t in ("Je ne parviens pas à effectuer de recherche web actuellement",
                  "l'outil m'indique une limite d'utilisation dépassée", "Je n'ai pas pu vérifier ces taux", "service indisponible"):
            self.assertTrue(adv.MACRO_FAILURE_RE.search(t), t)

    def test_contexte_normal_non_detecte(self):
        self.assertFalse(adv.MACRO_FAILURE_RE.search("Inflation France : +3,0 % sur un an en septembre 2026 (Insee)."))


class DiversTest(unittest.TestCase):
    def test_modeles_utilises_ont_un_tarif(self):
        for m in (adv.MODEL, adv.STRATEGY_MODEL, "claude-haiku-5-5"):
            self.assertIn(m, adv.PRICES, m)

    def test_detection_de_chiffres_dans_les_textes(self):
        self.assertTrue(adv.NUMBER_RE.search("Verse 150 € par mois"))
        self.assertFalse(adv.NUMBER_RE.search("Verse un montant fixe après la paie"))


if __name__ == "__main__":
    unittest.main()
