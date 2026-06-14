export type EncounterRollTableJson = {
  name?: string;
  img?: string;
  description?: string;
  formula?: string;
  replacement?: boolean;
  displayRoll?: boolean;
  results?: unknown[];
};

const encounterModules = import.meta.glob("../data/encounters/*.json", {
  eager: true,
  import: "default",
}) as Record<string, EncounterRollTableJson>;

export function getBundledEncounterRollTables(): Array<{
  filename: string;
  data: EncounterRollTableJson;
}> {
  return Object.entries(encounterModules)
    .map(([path, data]) => ({
      filename: path.split("/").pop() ?? path,
      data,
    }))
    .filter((row) => row.data && typeof row.data === "object" && row.data.name)
    .sort((a, b) => a.filename.localeCompare(b.filename));
}
