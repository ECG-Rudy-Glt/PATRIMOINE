import colors from "./theme-colors.json";

export type Theme = "auto" | "light" | "dark";

const dark = () => window.matchMedia("(prefers-color-scheme: dark)");
const resolve = (t: Theme): "light" | "dark" => (t === "auto" ? (dark().matches ? "dark" : "light") : t);

// Couleur de la barre système (PWA installée) : src/theme-colors.json (source unique, aussi lue par vite.config.ts)
function paint(t: Theme) {
  const r = resolve(t);
  document.documentElement.dataset.theme = r;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    const scheme = i === 0 ? "light" : "dark";   // ordre de index.html : clair puis sombre
    if (t === "auto") { m.media = `(prefers-color-scheme: ${scheme})`; m.content = colors[scheme]; }
    else { m.removeAttribute("media"); m.content = colors[r]; }
  });
}

let listener: (() => void) | null = null;
const valid = (v: string | null | undefined): v is Theme => v === "auto" || v === "light" || v === "dark";

// Double mémorisation : localStorage + cookie (repli si le stockage de la PWA est vidé). Choix par défaut : Perle (clair).
function store(t: Theme) {
  try { localStorage.setItem("theme", t); } catch { /* stockage indisponible */ }
  try { document.cookie = `theme=${t}; path=/; max-age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* cookies bloqués */ }
}

export function applyTheme(t: Theme) {
  paint(t);
  // mode auto : suit le réglage du système en direct
  if (listener) dark().removeEventListener("change", listener);
  listener = t === "auto" ? () => paint("auto") : null;
  if (listener) dark().addEventListener("change", listener);
  store(t);
}

export function savedTheme(): Theme {
  let v: string | null = null;
  try { v = localStorage.getItem("theme"); } catch { /* stockage indisponible */ }
  if (!valid(v)) v = document.cookie.match(/(?:^|; )theme=(light|dark|auto)/)?.[1] ?? null;
  return valid(v) ? v : "light";
}
