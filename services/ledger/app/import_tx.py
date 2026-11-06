"""Import d'un historique d'opérations depuis un export de l'espace client (CSV ou OFX).
Fonctions pures (aucun accès réseau ni base) : testables seules."""
import csv
import hashlib
import html
import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

MAX_BYTES = 8 * 1024 * 1024


class ImportErreur(ValueError):
    """Erreur lisible renvoyée telle quelle à l'utilisateur (HTTP 422)."""


@dataclass
class Ligne:
    booked_on: date
    amount: Decimal
    label: str


@dataclass
class Lu:
    lignes: list[Ligne]
    warnings: list[str]
    format: str


# --- utilitaires -------------------------------------------------------------

def norm(s: str) -> str:
    """Minuscules, sans accents ni ponctuation, espaces réduits (clé de comparaison des libellés)."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def decode(raw: bytes, charset: str | None = None) -> str:
    if charset:
        try:
            return raw.decode(charset)
        except (LookupError, UnicodeDecodeError):
            pass
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1")


def parse_amount(s: str) -> Decimal | None:
    """Nombres français ou anglais : « 1 234,56 », « -12,50 », « +1.234,56 », « 1,234.56 », « (12,00) »."""
    t = (s or "").replace("\xa0", "").replace(" ", "").replace(" ", "").replace("−", "-")
    t = re.sub(r"(?i)€|eur|euros?", "", t)
    if not t:
        return None
    neg = False
    if t.startswith("(") and t.endswith(")"):
        neg, t = True, t[1:-1]
    if t.endswith("-"):
        neg, t = True, t[:-1]
    if t.startswith("+"):
        t = t[1:]
    if t.startswith("-"):
        neg, t = not neg, t[1:]
    if "," in t and "." in t:                       # le dernier séparateur est la décimale
        dec = "," if t.rfind(",") > t.rfind(".") else "."
        t = t.replace("." if dec == "," else ",", "").replace(dec, ".")
    else:
        t = t.replace(",", ".")
        if t.count(".") > 1:                         # « 1.234.567 » : séparateurs de milliers
            t = t.replace(".", "")
    if not re.fullmatch(r"\d+(\.\d+)?|\.\d+", t):
        return None
    try:
        v = Decimal(t)
    except InvalidOperation:
        return None
    return -v if neg else v


def parse_date(s: str) -> date | None:
    """dd/mm/yyyy, dd/mm/yy, yyyy-mm-dd, dd-mm-yyyy, dd.mm.yyyy, yyyymmdd (heure éventuelle ignorée)."""
    t = clean(s)
    m = (re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)", t) or re.match(r"^(\d{4})(\d{2})(\d{2})(?:\d{4,6})?(?!\d)", t))
    if m:
        y, mo, d = (int(x) for x in m.groups())
    else:
        m = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)", t)
        if not m:
            return None
        d, mo, y = (int(x) for x in m.groups())
        if y < 100:
            y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None


# --- OFX ---------------------------------------------------------------------

def _tag(bloc: str, nom: str) -> str | None:
    m = re.search(rf"<{nom}>\s*([^<\r\n]*)", bloc, re.I)
    return html.unescape(m.group(1)).strip() if m else None


def parse_ofx(text: str) -> Lu:
    lignes, warnings = [], []
    blocs = re.findall(r"<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>|$)", text, re.I | re.S)
    for i, b in enumerate(blocs, 1):
        d = parse_date(_tag(b, "DTPOSTED") or "")
        a = parse_amount(_tag(b, "TRNAMT") or "")
        if d is None or a is None:
            warnings.append(f"opération {i} ignorée : date ou montant illisible")
            continue
        name, memo = clean(_tag(b, "NAME")), clean(_tag(b, "MEMO"))
        label = name if not memo or memo == name else (memo if not name else f"{name} {memo}")
        lignes.append(Ligne(d, a, label))
    return Lu(lignes, warnings, "ofx")


# --- CSV ---------------------------------------------------------------------

LIBELLES = ("libelle", "intitule", "description", "detail", "operation")   # par ordre de préférence


def _colonnes(champs: list[str]) -> dict | None:
    """Repère date / libellé / montant (ou débit+crédit) dans une ligne d'en-tête candidate."""
    h = [norm(c) for c in champs]
    date_i = None
    for pred in (lambda x: "date" in x and "operation" in x, lambda x: x == "date" or x.startswith("date comptable"),
                 lambda x: "date" in x and "valeur" not in x, lambda x: "date" in x):
        date_i = next((i for i, x in enumerate(h) if pred(x)), None)
        if date_i is not None:
            break
    lib_i = None
    for mot in LIBELLES:
        lib_i = next((i for i, x in enumerate(h) if mot in x and "date" not in x and i != date_i), None)
        if lib_i is not None:
            break
    mont_i = next((i for i, x in enumerate(h) if x in ("montant", "amount") or
                   (x.startswith("montant") and "devise" not in x)), None)
    deb_i = next((i for i, x in enumerate(h) if "debit" in x), None)
    cre_i = next((i for i, x in enumerate(h) if "credit" in x), None)
    if date_i is None or lib_i is None or (mont_i is None and deb_i is None and cre_i is None):
        return None
    return {"date": date_i, "label": lib_i, "montant": mont_i, "debit": deb_i, "credit": cre_i}


_TOTAL = re.compile(r"^(sous total|total|solde)( (initial|final|precedent|general|du compte|des operations|au .*|en .*))?$")


def parse_csv(raw: bytes) -> Lu:
    text = decode(raw)
    if not text.strip():
        raise ImportErreur("Le fichier est vide.")
    lignes_txt = [l for l in text.splitlines() if l.strip()]
    delims = sorted(";,\t", key=lambda d: -sum(l.count(d) for l in lignes_txt[:50]))
    trouvees: list[str] = []
    for delim in delims:
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
        for idx, champs in enumerate(rows[:60]):
            cols = _colonnes(champs)
            if cols:
                return _lire_csv(rows[idx + 1:], cols, idx + 2)
            if not trouvees and len([c for c in champs if c.strip()]) >= 2 and delim == delims[0]:
                trouvees = [c.strip() for c in champs if c.strip()]
    raise ImportErreur("Colonnes introuvables : il faut une date, un libellé et un montant (ou débit/crédit)."
                       + (f" Colonnes trouvées sur la première ligne tabulaire : {', '.join(trouvees)}." if trouvees else ""))


def _lire_csv(rows: list[list[str]], c: dict, premiere: int) -> Lu:
    lignes, warnings = [], []
    get = lambda r, i: r[i] if i is not None and i < len(r) else ""
    for n, r in enumerate(rows, premiere):
        if not any(x.strip() for x in r):
            continue
        label = clean(get(r, c["label"]))
        d = parse_date(get(r, c["date"]))
        if c["montant"] is not None:
            a = parse_amount(get(r, c["montant"]))
        else:
            deb, cre = parse_amount(get(r, c["debit"])), parse_amount(get(r, c["credit"]))
            a = None if deb is None and cre is None else (cre and abs(cre) or Decimal(0)) - (deb and abs(deb) or Decimal(0))
        if _TOTAL.match(norm(label)):
            continue                                  # ligne de total ou de solde, pas une opération
        if d is None or a is None:
            if d is None and a is None and not label:
                continue
            if d is None and a is None and len(warnings) < 20:
                warnings.append(f"ligne {n} ignorée : ni date ni montant lisibles")
            elif len(warnings) < 20:
                warnings.append(f"ligne {n} ignorée : {'date' if d is None else 'montant'} illisible")
            continue
        lignes.append(Ligne(d, a, label))
    return Lu(lignes, warnings, "csv")


# --- point d'entrée ----------------------------------------------------------

def parse(raw: bytes, filename: str | None = None) -> Lu:
    if not raw or not raw.strip():
        raise ImportErreur("Le fichier est vide.")
    if len(raw) > MAX_BYTES:
        raise ImportErreur("Fichier trop volumineux (8 Mo maximum).")
    name = (filename or "").lower()
    head = raw[:4096].upper()
    if name.endswith((".ofx", ".qfx")) or b"OFXHEADER" in head or b"<OFX>" in head:
        m = re.search(rb"CHARSET:\s*(\w+)", raw[:1024], re.I)
        cs = {"1252": "cp1252", "NONE": None}.get(m.group(1).decode().upper(), m.group(1).decode()) if m else None
        lu = parse_ofx(decode(raw, cs))
    else:
        lu = parse_csv(raw)
    if not lu.lignes:
        raise ImportErreur("Aucune opération lisible dans ce fichier." + (f" ({lu.warnings[0]})" if lu.warnings else ""))
    return lu


# --- identifiants et règle de non-doublon ------------------------------------

def identifiants(lignes: list[Ligne]) -> list[str]:
    """Identifiant externe déterministe : sha1(date|montant|libellé|rang de l'occurrence dans le fichier)."""
    vus: Counter = Counter()
    ids = []
    for l in lignes:
        cle = f"{l.booked_on.isoformat()}|{l.amount:f}|{l.label}"
        ids.append("imp:" + hashlib.sha1(f"{cle}|{vus[cle]}".encode()).hexdigest())
        vus[cle] += 1
    return ids


def planifier(lignes: list[Ligne], mode: str, premiere: date | None, existantes: Counter | None = None):
    """Sépare les lignes à importer des ignorées.
    extend : seules les lignes strictement antérieures à la première opération connue.
    all    : tout, sauf ce qui existe déjà (date, montant, libellé normalisé), multiplicités comprises.
    Renvoie (nouvelles [(id, ligne)], ignorées {motif: n})."""
    if mode not in ("extend", "all"):
        raise ImportErreur("Mode inconnu (extend ou all).")
    ids = identifiants(lignes)
    nouvelles, ignorees = [], Counter()
    restant = Counter(existantes or {})
    for i, l in zip(ids, lignes):
        if mode == "extend":
            if premiere is not None and l.booked_on >= premiere:
                ignorees["deja_couvert"] += 1
                continue
        else:
            cle = (l.booked_on, l.amount, norm(l.label))
            if restant[cle] > 0:
                restant[cle] -= 1
                ignorees["doublon"] += 1
                continue
        nouvelles.append((i, l))
    return nouvelles, dict(ignorees)


MOTIFS = {"deja_couvert": "date non antérieure à la première opération déjà connue",
          "doublon": "opération déjà présente (même date, montant et libellé)"}
