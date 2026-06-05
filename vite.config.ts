import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/module.ts"),
      formats: ["es"],
      fileName: () => "wastelander.mjs",
    },
    rollupOptions: {
      external: (id) => id.startsWith("@foundry") || id === "foundry",
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
