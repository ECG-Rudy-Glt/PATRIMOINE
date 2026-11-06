const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const money = (n: number | null | undefined) => (n == null ? "—" : eur.format(n));
export const money0 = (n: number | null | undefined) => (n == null ? "—" : eur0.format(n));
export const signed = (n: number) => (n > 0 ? "+" : "") + eur.format(n);
export const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");
export const dateTime = (s: string | null) =>
  s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const monthLabel = (m: string) =>
  new Date(`${m}-01`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });

export const KINDS: Record<string, string> = {
  income: "Revenus", fixed: "Charges fixes", household: "Compte commun", variable: "Dépenses variables",
  internal: "Virements entre nous", savings: "Épargne",
};
export const cycleLabel = (c: string) =>
  new Date(c).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

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
export const shortDate = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const monthsLabel = (m: number) => (m >= 12 ? `${Math.floor(m / 12)} an${m >= 24 ? "s" : ""}${Math.round(m % 12) ? ` ${Math.round(m % 12)} mois` : ""}` : `${Math.round(m)} mois`);
export const pct = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`;
// Palette catégorielle de référence (skill dataviz, ordre validé CVD) — via variables CSS pour clair/sombre
export const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `var(--series-${i})`);

export const ACCOUNT_TYPES: Record<string, string> = {
  courant: "Compte courant", livret: "Livret", pea: "PEA", assurance_vie: "Assurance-vie",
  per: "PER", cto: "Compte-titres", immobilier: "Immobilier", autre: "Autre",
};
