import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import colors from "./src/theme-colors.json";

// Source unique des couleurs de barre système (src/theme-colors.json) : reportée dans index.html (placeholders),
// le manifeste PWA et offline.html au build.
const themeColors = (): Plugin => ({
  name: "theme-colors",
  transformIndexHtml: (html) => html.replaceAll("%THEME_LIGHT%", colors.light).replaceAll("%THEME_DARK%", colors.dark),
  closeBundle() {
    const dist = path.resolve(__dirname, "dist");
    const manifest = path.join(dist, "manifest.webmanifest");
    if (fs.existsSync(manifest)) {
      const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
      m.background_color = colors.light; m.theme_color = colors.light;
      fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
    }
    const off = path.join(dist, "offline.html");
    if (fs.existsSync(off))
      fs.writeFileSync(off, fs.readFileSync(off, "utf8").replaceAll("%THEME_LIGHT%", colors.light).replaceAll("%THEME_DARK%", colors.dark));
  },
});

export default defineConfig({
  plugins: [react(), themeColors()],
  build: {
    rolldownOptions: {
      output: {
        // Recharts (≈ 400 ko) dans un fichier à part, chargé seulement par les pages qui tracent un graphique
        manualChunks: (id: string) => (/node_modules\/(recharts|d3-|victory-vendor|recharts-scale|decimal\.js|es-toolkit|immer|reselect|redux|@reduxjs)/.test(id) ? "charts" : undefined),
      },
    },
  },
  server: {
    host: true,
    // API_TARGET=http://localhost : développer l'interface contre le cluster (nginx fait déjà le routage /api)
    // LOCAL_SERVICES=1 : contre les services lancés à la main (ledger 28001, budget 28002, alloc 28003, advisor 28004, reporting 28005)
    proxy: process.env.LOCAL_SERVICES
      ? Object.fromEntries([["budget", 28002], ["bank", 28006], ["alloc", 28003], ["advisor", 28004], ["export", 28005], ["digest", 28005], ["", 28001]].map(
          ([p, port]) => [`/api${p ? `/${p}` : ""}`, { target: `http://localhost:${port}`, rewrite: (u: string) => u.replace(/^\/api/, "") }]))
      : process.env.API_TARGET
        ? { "/api": { target: process.env.API_TARGET, changeOrigin: true } }
        : { "/api": { target: "http://localhost:8000", rewrite: (p: string) => p.replace(/^\/api/, "") } },
  },
});
