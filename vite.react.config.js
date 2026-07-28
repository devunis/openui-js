import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  root: resolve(import.meta.dirname, "frontends/react"),
  base: command === "build" ? "/react/" : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:8000"
    }
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/react"),
    emptyOutDir: true,
    sourcemap: true
  }
}));
