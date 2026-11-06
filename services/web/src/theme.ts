export type Theme = "auto" | "light" | "dark";

// Couleur de la barre système (PWA installée) : fond de page du thème (--bg)
const BAR = { light: "#f4f0e6", dark: "#0d0d0d" };

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "auto") delete root.dataset.theme;
  else root.dataset.theme = t;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    const scheme = i === 0 ? "light" : "dark";   // ordre de index.html : clair puis sombre
    if (t === "auto") { m.media = `(prefers-color-scheme: ${scheme})`; m.content = BAR[scheme]; }
    else { m.removeAttribute("media"); m.content = BAR[t]; }
  });
  try { localStorage.setItem("theme", t); } catch { /* stockage indisponible */ }
}

export function savedTheme(): Theme {
  try { return (localStorage.getItem("theme") as Theme) || "auto"; } catch { return "auto"; }
}
