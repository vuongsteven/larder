import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ask before swapping in a new version, so an update never reloads mid-edit.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Larder",
        short_name: "Larder",
        description: "Pantry, fridge, freezer and shopping list for your household",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f6f4ef",
        theme_color: "#f6f4ef",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Shopping list", url: "/list" },
          { name: "Add item", url: "/stock?add=1" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,webmanifest}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Expiry reminder notifications (push and notificationclick handlers).
        importScripts: ["/push-handler.js"],
      },
    }),
  ],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    // Libraries change far less often than the app, so keep them in their own
    // long-cached chunk: an app update then downloads only the small app chunk.
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: "vendor", test: /^(?!.*(?:zxing-wasm|barcode-detector)).*node_modules/ }] },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
