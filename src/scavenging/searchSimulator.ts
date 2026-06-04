import type {
  ScavengerLocation,
  ScavengerLocationLootResult,
} from "./ScavengerLocation.js";
import { rollLootCategory } from "./lootRoller.js";

export async function simulateScavengerSearch(
  location: ScavengerLocation,
  success: boolean,
): Promise<ScavengerLocation> {
  if (!success) {
    return {
      ...location,
      searchSimulated: true,
      lootResults: [],
      rollLog: [
        ...location.rollLog,
        {
          id: "search-fail",
          label: "Search (PER + Survival)",
          detail: "Failed — no loot",
        },
      ],
    };
  }

  const lootResults: ScavengerLocationLootResult[] = [];
  for (const row of location.items) {
    if (row.category === "junk") continue;
    const rolls = row.min;
    for (let i = 0; i < rolls; i++) {
      const result = await rollLootCategory(row.category, 0);
      lootResults.push({
        category: row.category,
        label: result.quantity
          ? `${result.label} (×${result.quantity})`
          : result.label,
        quantityFormula: result.formula,
      });
    }
  }

  return {
    ...location,
    searchSimulated: true,
    lootResults,
    rollLog: [
      ...location.rollLog,
      {
        id: "search-success",
        label: "Search (PER + Survival)",
        detail: `Success — ${lootResults.length} loot roll(s) at category minimums`,
      },
    ],
  };
}
