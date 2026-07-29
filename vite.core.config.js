import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "packages/core/src/index.js"),
      formats: ["es"],
      fileName: () => "index.js"
    },
    outDir: resolve(import.meta.dirname, "packages/core/dist"),
    emptyOutDir: true,
    sourcemap: true
  }
});
