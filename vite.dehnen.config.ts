import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Kehrwasser (dehnen/) is a second, self-contained app that is built into dist/dehnen/ and served
// under <base>dehnen/, next to the Bucket List app. It has its own manifest and its own service worker
// (dist/dehnen/sw.js), whose scope can never reach above <base>dehnen/.
const base = (process.env.VITE_BASE ?? "/bucket-list/") + "dehnen/";

export default defineConfig({
  root: "dehnen",
  base,
  build: {
    outDir: "../dist/dehnen",
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "generateSW",
      // registered by hand in dehnen/src/main.tsx: a new version must never reload the page in the middle of a session
      injectRegister: false,
      scope: base,
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        id: base,
        name: "Kehrwasser",
        short_name: "Kehrwasser",
        description: "Dehnen und Mobilisieren für Kanuslalom",
        lang: "de-CH",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "any",
        background_color: "#061214",
        theme_color: "#061214",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,json}"],
        // the animations make the bundle big; it still has to be available offline
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "kehrwasser-font-css",
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "kehrwasser-font-files",
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
