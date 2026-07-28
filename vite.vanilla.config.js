import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  root: resolve(import.meta.dirname, "frontends/vanilla"),
  base: command === "build" ? "/vanilla/" : "/",
  server: {
    host: "127.0.0.1",
    port: 3001,
    proxy: {
      "/api": "http://127.0.0.1:8000"
    }
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/vanilla"),
    emptyOutDir: true,
    sourcemap: true
  }
}));
