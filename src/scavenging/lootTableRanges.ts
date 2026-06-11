import type { ScavengingRollTableKey } from "./rollTableRegistry.js";

export type LootTableRow = {
  range: [number, number];
  name: string;
  documentUuid?: string;
  /** Resolved from item.system.cost (Fallout); null = text-only / no price */
  caps: number | null;
};

export function suggestRollFormula(
  rowCount: number,
  tableKey: ScavengingRollTableKey,
): string {
  const n = Math.max(0, Math.floor(rowCount));
  if (n <= 0) return tableKey === "oddities" ? "2d20" : "2d20";
  if (n <= 20) return "1d20";
  if (n <= 39) return "2d20";
  if (n <= 59) return "3d20";
  return "4d20";
}

type RollSpace = { min: number; max: number };

export function rollSpaceForFormula(
  formula: string,
  tableKey: ScavengingRollTableKey,
): RollSpace {
  const f = formula.trim().toLowerCase();
  if (f === "1d20") return { min: 1, max: 20 };
  if (f === "3d20") return { min: 3, max: 60 };
  if (f === "4d20") return { min: 4, max: 80 };
  if (tableKey === "oddities") return { min: 3, max: 60 };
  return { min: 2, max: 40 };
}

export function assignRowRanges(
  rows: LootTableRow[],
  tableKey: ScavengingRollTableKey,
  formula: string,
): LootTableRow[] {
  const n = rows.length;
  if (n === 0) return [];

  const f = formula.trim() || suggestRollFormula(n, tableKey);
  const space = rollSpaceForFormula(f, tableKey);
  const span = space.max - space.min + 1;
  const base = Math.floor(span / n);
  let remainder = span % n;
  let cursor = space.min;

  return rows.map((row) => {
    const width = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const rangeMin = cursor;
    const rangeMax = cursor + width - 1;
    cursor = rangeMax + 1;
    return {
      ...row,
      range: [rangeMin, rangeMax] as [number, number],
    };
  });
}
