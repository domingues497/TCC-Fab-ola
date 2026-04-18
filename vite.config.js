import { defineConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    https: false,
  },
  plugins: [
    {
      name: "germinacao-autosave-json",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "POST" || !req.url || !req.url.startsWith("/__autosave")) return next();

          try {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", async () => {
              try {
                const raw = Buffer.concat(chunks).toString("utf-8");
                const payload = JSON.parse(raw || "{}");
                const filePath = path.resolve(process.cwd(), "germinacao_bi_autosave.json");
                await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true, file: "germinacao_bi_autosave.json" }));
              } catch (err) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: false, error: err?.message || "Erro ao salvar." }));
              }
            });
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: err?.message || "Erro interno." }));
          }
        });
      },
    },
    basicSsl(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.svg", "icon-512.svg"],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2,json}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Cacheia navegação para abrir telas mesmo offline
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages-cache",
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 7 * 24 * 60 * 60
              }
            }
          },
          {
            // CSS/JS/Web Worker: atualiza em segundo plano e abre instantâneo
            urlPattern: ({ request }) => ["style", "script", "worker"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-resources-cache",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            // Imagens/ícones para instalação e uso em tablet
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 24 * 60 * 60
              }
            }
          }
        ]
      },
      manifest: {
        name: "Ensaio de Germinacao - BI",
        short_name: "Germinacao BI",
        description: "Dashboard de contagens e indicadores de germinacao por tratamento.",
        theme_color: "#f4f6f8",
        background_color: "#f4f6f8",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/icon-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      }
    })
  ],
});
