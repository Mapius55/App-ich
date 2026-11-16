import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app under /<repo-name>/ (CI sets VITE_BASE=/<repo>/, so the app also
// still works at /App-ich/ until the repo is renamed). Locally the default is /bucket-list/.
const base = process.env.VITE_BASE ?? "/bucket-list/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // own service worker (src/sw.ts): app shell offline + coach notifications
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Bucket List",
        short_name: "Bucket List",
        description: "Deine Ziele. Deine Zeit.",
        lang: "de-CH",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#05060a",
        theme_color: "#05060a",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          // the wordmark inside the safe circle (scripts/brand/make.cjs), so round masks never cut it
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
    }),
  ],
});
