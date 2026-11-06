"""Tests des parseurs d'import (exemples synthétiques). Lancer depuis services/ledger :
python -m unittest discover tests"""
import sys
import unittest
from collections import Counter
from datetime import date
from decimal import Decimal as D
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import import_tx as it  # noqa: E402


class Csv(unittest.TestCase):
    def test_debit_credit(self):
        raw = "Date;Libellé;Débit;Crédit\n03/01/2024;CARTE CARREFOUR;12,50;\n05/01/2024;VIR SALAIRE;;1 234,56\n".encode()
        r = it.parse(raw, "x.csv")
        self.assertEqual([(l.booked_on, l.amount, l.label) for l in r.lignes],
                         [(date(2024, 1, 3), D("-12.50"), "CARTE CARREFOUR"),
                          (date(2024, 1, 5), D("1234.56"), "VIR SALAIRE")])

    def test_date_operation_preferee_et_solde(self):
        raw = ("Date operation;Date valeur;Libelle;Montant;Solde\n"
               "02/02/24;03/02/24;PRLV EDF;-45,00;1 000,00\n"
               "04/02/24;04/02/24;VIR RECU;+100,00;1 100,00\n"
               ";;Solde au 29/02/2024;;1 100,00\n").encode()
        r = it.parse(raw)
        self.assertEqual(len(r.lignes), 2)
        self.assertEqual(r.lignes[0].booked_on, date(2024, 2, 2))
        self.assertEqual(r.lignes[1].amount, D("100.00"))

    def test_metadonnees_cp1252_nbsp(self):
        txt = ("Compte courant;n° 12345\nPériode du 01/01/2024 au 31/01/2024\n\n"
               "Date;Libellé;Montant\n10/01/2024;CAFÉ DU COIN;-3,20\n11/01/2024;REMBOURSEMENT;1 200,00\n"
               "Total;;1 196,80\n")
        r = it.parse(txt.encode("cp1252"))
        self.assertEqual([l.label for l in r.lignes], ["CAFÉ DU COIN", "REMBOURSEMENT"])
        self.assertEqual(r.lignes[1].amount, D("1200.00"))

    def test_separateurs_et_dates(self):
        r = it.parse(b"date,description,amount\n2024-03-01,Shop,-1.5\n2024-03-02,Pay,\"1,234.50\"\n")
        self.assertEqual([l.amount for l in r.lignes], [D("-1.5"), D("1234.50")])
        r = it.parse("Date\tLibellé\tMontant\n01-03-2024\tA\t-2,00\n02.03.2024\tB\t3,00\n".encode("utf-8-sig"))
        self.assertEqual([l.booked_on for l in r.lignes], [date(2024, 3, 1), date(2024, 3, 2)])

    def test_erreurs(self):
        with self.assertRaises(it.ImportErreur):
            it.parse(b"", "a.csv")
        with self.assertRaises(it.ImportErreur) as e:
            it.parse(b"Foo;Bar;Baz\n1;2;3\n")
        self.assertIn("Foo", str(e.exception))
        with self.assertRaises(it.ImportErreur):
            it.parse(b"Date;Libelle;Montant\n")

    def test_nombres(self):
        for s, v in [("1 234,56", "1234.56"), ("-0,5", "-0.5"), ("+12", "12"), ("(12,00)", "-12.00"),
                     ("1.234.567", "1234567"), ("12,5 €", "12.5"), ("5-", "-5")]:
            self.assertEqual(it.parse_amount(s), D(v), s)
        self.assertIsNone(it.parse_amount("abc"))


OFX = """OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240115120000[0:GMT]<TRNAMT>-23,40<FITID>A1<NAME>CARTE FNAC<MEMO>PARIS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240116<TRNAMT>1500.00<FITID>A2<NAME>VIR EMPLOYEUR<MEMO>VIR EMPLOYEUR</STMTTRN>
<STMTTRN><DTPOSTED>20240117<TRNAMT>-5.00<NAME>Café &amp; Cie
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
"""


class Ofx(unittest.TestCase):
    def test_ofx(self):
        r = it.parse(OFX.encode("cp1252"), "releve.txt")
        self.assertEqual(r.format, "ofx")
        self.assertEqual([(l.booked_on, l.amount, l.label) for l in r.lignes],
                         [(date(2024, 1, 15), D("-23.40"), "CARTE FNAC PARIS"),
                          (date(2024, 1, 16), D("1500.00"), "VIR EMPLOYEUR"),
                          (date(2024, 1, 17), D("-5.00"), "Café & Cie")])


class Regles(unittest.TestCase):
    L = [it.Ligne(date(2024, 1, 1), D(-1), "A"), it.Ligne(date(2024, 1, 1), D(-1), "A"),
         it.Ligne(date(2024, 1, 5), D(-2), "B"), it.Ligne(date(2024, 2, 1), D(-3), "C")]

    def test_ids_deterministes_et_rang(self):
        ids = it.identifiants(self.L)
        self.assertEqual(ids, it.identifiants(list(self.L)))
        self.assertEqual(len(set(ids)), 4)          # deux lignes identiques : rangs distincts
        self.assertTrue(ids[0].startswith("imp:"))

    def test_extend(self):
        n, ign = it.planifier(self.L, "extend", date(2024, 1, 5))
        self.assertEqual(len(n), 2)
        self.assertEqual(ign, {"deja_couvert": 2})
        self.assertEqual(len(it.planifier(self.L, "extend", None)[0]), 4)

    def test_all_multiplicites(self):
        ex = Counter({(date(2024, 1, 1), D(-1), "a"): 1, (date(2024, 2, 1), D(-3), "c"): 1})
        n, ign = it.planifier(self.L, "all", None, ex)
        self.assertEqual(ign, {"doublon": 2})
        self.assertEqual([l.label for _, l in n], ["A", "B"])      # un seul « A » déjà connu


if __name__ == "__main__":
    unittest.main()
