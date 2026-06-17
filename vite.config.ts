import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const ROOT = import.meta.dirname;
const EXTENSION_DIR = path.resolve(ROOT, "extensions/denizens-import");
const EXTENSION_ENTRY = path.resolve(
  EXTENSION_DIR,
  "src/wastelanderIntegration.ts",
);
const STUB_ENTRY = path.resolve(ROOT, "src/local/denizensImport.stub.ts");
const DENIZENS_ENABLED = fs.existsSync(EXTENSION_ENTRY);

function copyDenizenTemplates(): void {
  const sourceDir = path.join(EXTENSION_DIR, "templates/denizens");
  const destDir = path.resolve(ROOT, "templates/denizens");
  if (!fs.existsSync(sourceDir)) return;

  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(sourceDir)) {
    if (!name.endsWith(".hbs")) continue;
    fs.copyFileSync(path.join(sourceDir, name), path.join(destDir, name));
  }
}

function localDenizensImportPlugin(): Plugin {
  return {
    name: "local-denizens-import",
    config() {
      return {
        resolve: {
          alias: {
            "@local/denizens-import": DENIZENS_ENABLED ? EXTENSION_ENTRY : STUB_ENTRY,
            "@wastelander": path.resolve(ROOT, "src"),
          },
        },
      };
    },
    buildStart() {
      if (!DENIZENS_ENABLED) return;
      copyDenizenTemplates();
      console.log("wastelander | bundling local denizen import from extensions/denizens-import");
    },
  };
}

export default defineConfig({
  plugins: [localDenizensImportPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(ROOT, "src/module.ts"),
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
