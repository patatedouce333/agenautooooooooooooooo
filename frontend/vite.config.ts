import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Preview sandbox : le serveur doit écouter sur 0.0.0.0 et accepter l'hôte
// de prévisualisation (allowedHosts large en dev uniquement).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Sandbox de preview (Vite 5 = hôtes exacts, pas de joker).
    // Surchageable via PREVIEW_HOST si l'ID de sandbox change.
    // Dev uniquement — ne pas copier tel quel en production exposée.
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      "5173-ivihdbtotlq8l5zkuo54m.e2b.app",
      ...(process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : []),
    ],
    proxy: {
      // En dev local avec `wrangler dev` sur :8787, les appels /api/* vont au Worker.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  preview: { host: "0.0.0.0", port: 4173 },
});
