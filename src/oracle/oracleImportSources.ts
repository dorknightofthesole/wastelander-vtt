export type OracleRollTableJson = {
  name?: string;
  img?: string;
  description?: string;
  formula?: string;
  replacement?: boolean;
  displayRoll?: boolean;
  results?: unknown[];
};

/**
 * Bundled at build time from src/data/oracle/*.json when those files exist locally.
 * Raw oracle JSON stays gitignored; run `npm run build` after `npm run build:oracle`.
 */
const oracleModules = import.meta.glob("../data/oracle/*.json", {
  eager: true,
  import: "default",
}) as Record<string, OracleRollTableJson>;

export function getBundledOracleRollTables(): Array<{
  filename: string;
  data: OracleRollTableJson;
}> {
  return Object.entries(oracleModules)
    .map(([path, data]) => ({
      filename: path.split("/").pop() ?? path,
      data,
    }))
    .filter((row) => row.data && typeof row.data === "object" && row.data.name)
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
