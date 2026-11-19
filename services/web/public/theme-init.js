// Applique le thème avant le premier affichage (évite le flash). Même logique que src/theme.ts :
// choix mémorisé dans localStorage, avec un cookie en repli (le stockage d'une PWA peut être vidé) ;
// sans aucun choix mémorisé : Perle (clair). Le mode « auto » suit le système.
(function () {
  var mode = null;
  try { mode = localStorage.getItem("theme"); } catch (e) {}
  if (mode !== "light" && mode !== "dark" && mode !== "auto") {
    var m = document.cookie.match(/(?:^|; )theme=(light|dark|auto)/);
    mode = m ? m[1] : "light";
  }
  var dark = mode === "dark" || (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if (mode !== "auto") {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length === 2) { metas[0].media = dark ? "not all" : "all"; metas[1].media = dark ? "all" : "not all"; }
  }
})();
