import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app under /<repo-name>/. Override with VITE_BASE if needed.
const base = process.env.VITE_BASE ?? "/App-ich/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "App-ich",
        short_name: "App-ich",
        description: "Dein persönlicher Coach für deine Zeit.",
        lang: "de-CH",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#1b1f4a",
        theme_color: "#1b1f4a",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Never cache API calls (Supabase, weather) in the service worker.
        navigateFallbackDenylist: [/\/functions\//, /\/rest\//, /\/auth\//],
      },
    }),
  ],
});
