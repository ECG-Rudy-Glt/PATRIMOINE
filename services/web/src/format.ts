// Module unique de formatage (fr-FR) : montants, pourcentages, nombres, dates.
// Espace fine insécable (U+202F) pour les milliers, espace insécable avant « € », pas de centimes sur les
// montants ≥ 1 000 € ; sous 1 000 €, les centimes ne s'affichent que s'ils existent. Les chiffres sont tabulaires
// et ne se coupent jamais (classe .num, white-space: nowrap).
const NBSP = " ";
const MINUS = "−";
const nf = (d: number, min = 0) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: d });
const f0 = nf(0), f2 = nf(2, 2);

type N = number | null | undefined;
const bad = (n: N): n is null | undefined => n == null || !Number.isFinite(n);

/** Nombre brut fr-FR (sans symbole) ; `digits` = décimales maximales. */
export const num = (n: N, digits = 0) => (bad(n) ? "—" : nf(digits).format(n).replace("-", MINUS));

function body(n: number, cents: "auto" | "always" | "never") {
  const abs = Math.abs(n);
  const withCents = cents === "always" || (cents === "auto" && abs < 1000 && Math.abs(abs - Math.round(abs)) > 0.004);
  return (withCents ? f2 : f0).format(abs);
}
/** Montant : sans centimes dès 1 000 € ; centimes seulement s'ils existent en dessous. */
export const money = (n: N) => (bad(n) ? "—" : `${n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : ""}${body(n, "auto")}${NBSP}€`);
/** Montant toujours arrondi à l'euro. */
export const money0 = (n: N) => (bad(n) ? "—" : `${n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : ""}${body(n, "never")}${NBSP}€`);
/** Montant d'une transaction : centimes en dessous de 1 000 €, sans au-dessus. */
export const moneyTx = (n: N) => (bad(n) ? "—" : `${n < 0 ? MINUS : ""}${Math.abs(n) < 1000 ? f2.format(Math.abs(n)) : f0.format(Math.abs(n))}${NBSP}€`);
/** Montant avec signe explicite (+ ou −). */
export const signed = (n: number) => (n > 0 ? "+" : "") + money(n);
export const signedTx = (n: number) => (n > 0 ? "+" : "") + moneyTx(n);
/** Pour un gros chiffre : partie numérique et unité séparées (l'unité s'affiche en gris). */
export const moneyParts = (n: N, sign = false): { value: string; unit: string } =>
  bad(n) ? { value: "—", unit: "" } : { value: `${n < 0 ? MINUS : sign && n > 0 ? "+" : ""}${f0.format(Math.abs(n))}`, unit: "€" };
export const usd = (n: N, digits = 2) => (bad(n) ? "—" : `${nf(digits, digits).format(n)}${NBSP}$`);
export const pct = (n: N, digits = 0) => (bad(n) ? "—" : `${num(n, digits)}${NBSP}%`);
export const signedPct = (n: number, digits = 1) => (n > 0 ? "+" : "") + pct(n, digits);

export const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");
export const dateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const monthLabel = (m: string) =>
  new Date(`${m}-01`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
export const shortDate = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const cycleLabel = (c: string) =>
  new Date(c).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
export const monthsLabel = (m: number) => (m >= 12 ? `${Math.floor(m / 12)} an${m >= 24 ? "s" : ""}${Math.round(m % 12) ? ` ${Math.round(m % 12)} mois` : ""}` : `${Math.round(m)} mois`);

export const KINDS: Record<string, string> = {
  income: "Revenus", fixed: "Charges fixes", household: "Compte commun", variable: "Dépenses variables",
  internal: "Virements entre nous", savings: "Épargne",
};

// Libellés en capitales de la banque ("COMPTE DE DéPOT" -> "Compte de dépôt") ; un nom déjà soigné (LEP, LDDS…) est conservé tel quel
export const pretty = (s: string) => {
  if (s !== s.toLocaleUpperCase("fr-FR")) return s;
  const t = s.toLocaleLowerCase("fr-FR");
  return t.charAt(0).toLocaleUpperCase("fr-FR") + t.slice(1);
};
// "PUY DU FOU FRAN" -> "Puy Du Fou Fran" ; conserve les domaines ("MANGO.COM" -> "Mango.com")
const titleCase = (s: string) =>
  s.toLocaleLowerCase("fr-FR").replace(/(^|[\s\-*'/])(\p{L})/gu, (_m, sep, c) => sep + c.toLocaleUpperCase("fr-FR"));
export const merchantName = (t: { merchant: string | null; label: string | null }) =>
  t.merchant ? titleCase(t.merchant) : (t.label ?? "—");
/** Initiales pour une pastille d'icône (« Assurance-vie » -> « AV »). */
export const initials = (s: string) => {
  const w = s.replace(/[^\p{L}\p{N} -]/gu, "").split(/[\s-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "?").slice(0, 2)).toLocaleUpperCase("fr-FR");
};

// Palette catégorielle — via variables CSS pour clair/sombre
export const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);

export const ACCOUNT_TYPES: Record<string, string> = {
  courant: "Compte courant", livret: "Livret", pea: "PEA", assurance_vie: "Assurance-vie",
  per: "PER", cto: "Compte-titres", immobilier: "Immobilier", autre: "Autre",
};
