import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
