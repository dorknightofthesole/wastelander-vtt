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
const LANG_CORE_PATH = path.resolve(ROOT, "lang/en.core.json");
const LANG_OUT_PATH = path.resolve(ROOT, "lang/en.json");

function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value as T[Extract<keyof T, string>];
    }
  }
  return target;
}

function buildLangFile(): void {
  const core = JSON.parse(fs.readFileSync(LANG_CORE_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const merged = structuredClone(core);

  if (DENIZENS_ENABLED) {
    const extLangPath = path.join(EXTENSION_DIR, "lang/en.json");
    if (fs.existsSync(extLangPath)) {
      const ext = JSON.parse(fs.readFileSync(extLangPath, "utf8")) as Record<
        string,
        unknown
      >;
      deepMerge(merged, ext);
    }
  }

  fs.writeFileSync(LANG_OUT_PATH, `${JSON.stringify(merged, null, 2)}\n`);
}

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
      buildLangFile();
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
