import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "packages/react/src/index.jsx"),
      formats: ["es"],
      fileName: () => "index.js"
    },
    outDir: resolve(import.meta.dirname, "packages/react/dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ["react"]
    }
  }
});
