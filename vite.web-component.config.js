import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "packages/web-component/src/index.js"),
      formats: ["es"],
      fileName: () => "index.js"
    },
    outDir: resolve(import.meta.dirname, "packages/web-component/dist"),
    emptyOutDir: true,
    sourcemap: true
  }
});
