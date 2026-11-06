"""Rapport mensuel : mise en forme et mail, sans réseau. Lancer depuis services/reporting : python -m unittest discover tests"""
import io
import unittest
from datetime import date, datetime

from openpyxl import load_workbook

from app import monthly


def point(jour, c, l, p, known=1):
    return {"day": jour, "total": c + l + p, "courant": c, "livret": l, "placements": p, "estimated": False, "known": known}


def donnees():
    hist = [point(f"2026-10-{d:02d}", 500 + d, 2000, 40000) for d in range(1, 12)]
    scope = lambda nom: {"name": nom, "summary": {"networth": 42500}, "history": hist, "accounts_hist": [],
                         "cashflow": [{"month": "2026-09", "income": 1800, "expense": 1500, "net": 300}],
                         "current": {"spent": 900, "income": 1800, "upcoming_total": 36}, "breakdown": [],
                         "avoidable": {"groups": [{"title": "Abonnements", "items": [{
                             "category": "abonnements", "label": "Abonnements", "monthly": 47, "annual": 563, "hint": "Résilier.",
                             "recurring": [{"merchant": "Spotify", "amount": 18.21}], "top": []}]}]},
                         "pay": []}
    return {
        "generated": datetime(2026, 10, 11, 9, 0), "persons": [{"id": 1, "name": "Alex", "email": "a@x.fr"}, {"id": 2, "name": "Sam", "email": "b@x.fr"}],
        "accounts": [{"id": 1, "name": "Compte courant", "institution": "CE", "type": "courant", "source": "enablebanking", "balance": 500,
                      "day": "2026-10-11", "holders": [{"person_id": 1, "name": "Alex", "share": 1.0}]}],
        "scopes": {1: scope("Alex"), 2: scope("Sam")}, "all": {"summary": {}, "history": hist, "accounts_hist": []},
        "commun": {"months": [{"month": "2026-09", "alex": 1100, "sam": 1100, "versements": 2200, "charges": 1915, "marge": 285, "autres_entrees": 0}],
                   "avg": {"mois": 3, "alex": 900, "sam": 900, "versements": 1800, "charges": 1715, "marge": 85, "couverture_pct": 105}},
        "goals": [{"name": "Achat maison", "current": 40000, "target": 60000, "remaining": 20000, "progress_pct": 66.7, "target_date": "2028-12-31", "status": "active"}],
        "recos": [{"person": "Alex", "created_at": "2026-10-11T10:00:00", "facts": {"a": {"label": "Total", "value": 10, "unit": "€"}},
                   "payload": {"synthese": "ok", "recommandations": [{"titre": "<b>Titre</b> & co", "priorite": "haute", "horizon": "ce_mois",
                                                                   "constat": "c", "action": "a", "vigilance": "v", "faits": ["a"]}]}}],
        "docs": {"strategie": {"content": "## 1. En une page\nligne **un**\n## 2. suite\nx"}, "notes_marche": {"content": ""}},
        "transfers": {"nodes": [], "edges": []}, "pays": [], "transactions": [],
        "savings": {"created_at": "2026-10-11T10:00:00", "model": "m", "payload": {"note": "n", "items": [{
            "contrat": {"libelle": "SOSH", "categorie": "Téléphone", "mensuel": 16.0},
            "alternatives": [{"fournisseur": "F", "offre": "O", "prix_mensuel": 9.99, "economie_annuelle": 72, "economie_estimee": True,
                              "engagement": "sans", "source_url": "https://exemple.fr"}], "pistes": ["p"]}]}},
        "settlement": {"phrase": "Sam doit 28,00 € à Alex.", "lignes": [], "a": "Alex", "b": "Sam", "note": ""},
        "shared": {"items": [], "candidates": []},
    }


class FormatTest(unittest.TestCase):
    def test_mois_en_francais(self):
        self.assertEqual(monthly.fr_month(datetime(2026, 10, 11)), "octobre 2026")
        self.assertEqual(monthly.fr_month(datetime(2026, 8, 1)), "août 2026")

    def test_montants(self):
        self.assertEqual(monthly.eur(1234.4), "1 234 €")
        self.assertEqual(monthly.eur(-557, True), "−557 €")
        self.assertEqual(monthly.eur(557, True), "+557 €")

    def test_fait_texte_ou_nombre(self):
        self.assertEqual(monthly.fact_text({"label": "L", "value": 1234.5, "unit": "€"}), "L : 1 234.50 €")
        self.assertEqual(monthly.fact_text({"label": "Date", "value": "2026-10-11", "unit": ""}), "Date : 2026-10-11")

    def test_extrait_markdown(self):
        lines = monthly.md_lines("## 1. En une page\nligne **un**\n| a | b |\n## 2. suite\nx", "2.", "1. En une page")
        self.assertEqual(lines[0], "1. En une page")
        self.assertIn("ligne un", lines)
        self.assertNotIn("x", lines)


class MailTest(unittest.TestCase):
    def test_html_echappe_les_textes_du_modele(self):
        h = monthly.report_html(donnees(), "octobre 2026")
        self.assertNotIn("<b>Titre</b>", h)
        self.assertIn("&lt;b&gt;Titre&lt;/b&gt;", h)
        self.assertIn("Sam doit 28,00 € à Alex.", h)
        self.assertIn("≈ −72 €/an", h)

    def test_sans_smtp_pas_d_envoi(self):
        monthly.SMTP_HOST = ""
        with self.assertRaises(RuntimeError):
            monthly.send_report(b"PK", donnees(), "2026-10")


class ClasseurTest(unittest.TestCase):
    def test_classeur_complet_se_construit(self):
        content, meta, _ = monthly.build(donnees())
        wb = load_workbook(io.BytesIO(content))
        for nom in ("Synthèse", "Alex", "Sam", "Compte commun", "Qui doit quoi", "À éviter", "Économies possibles", "Conseils IA", "Objectifs"):
            self.assertIn(nom, wb.sheetnames)
        self.assertGreaterEqual(sum(len(ws._charts) for ws in wb), 8)
        self.assertEqual(wb["Qui doit quoi"]["A4"].value, "Sam doit 28,00 € à Alex.")


if __name__ == "__main__":
    unittest.main()
