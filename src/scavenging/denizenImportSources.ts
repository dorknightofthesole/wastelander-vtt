import type { FalloutActorJson } from "./denizenCatalogParse.js";

/**
 * Bundled at build time from src/data/denizens/*.json when those files exist locally.
 * Raw exports stay gitignored; run `npm run build` after adding JSON to include them.
 */
const denizenModules = import.meta.glob("../data/denizens/*.json", {
  eager: true,
  import: "default",
}) as Record<string, FalloutActorJson>;

export function getBundledDenizenExports(): Array<{
  filename: string;
  data: FalloutActorJson;
}> {
  return Object.entries(denizenModules)
    .map(([path, data]) => ({
      filename: path.split("/").pop() ?? path,
      data,
    }))
    .filter((row) => row.data && typeof row.data === "object")
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
