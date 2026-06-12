import { t } from "../integrations/i18n.js";
import { DENIZENS_ROOT_FOLDER } from "../scavenging/denizenBookFolders.js";
import {
  resolveDemeanorGear,
  resolveProfessionGear,
  type GearItemSpec,
  type GearSpec,
} from "./npcGearMappings.js";
import type {
  NpcGeneratorGearState,
  NpcGeneratorRolls,
  NpcGeneratorState,
} from "./npcGeneratorState.js";

export type NpcGearDisplayRow = {
  label: string;
  detail: string;
};

export type NpcGearDisplaySection = {
  id: string;
  title: string;
  rows: NpcGearDisplayRow[];
};

/** Fallout embedded items that are not physical starting gear. */
const NON_GEAR_ITEM_TYPES = new Set([
  "skill",
  "trait",
  "perk",
  "ability",
  "special",
  "book",
  "feat",
  "spell",
]);

function folderChain(actor: Actor): Folder[] {
  const chain: Folder[] = [];
  let folderRef = (actor as { folder?: string | Folder | null }).folder;
  while (folderRef) {
    const folder =
      typeof folderRef === "string" ? game.folders.get(folderRef) : folderRef;
    if (!folder) break;
    chain.unshift(folder);
    folderRef = folder.folder;
  }
  return chain;
}

export function isNpcGenDenizenActor(actor: Actor): boolean {
  if (actor.type === "creature" || actor.type === "robot") return false;
  const chain = folderChain(actor);
  return chain.length > 0 && chain[0]!.name === DENIZENS_ROOT_FOLDER;
}

export type NpcGenDenizenOption = {
  id: string;
  name: string;
  subfolder: string;
};

export function resolveDenizenActor(id: string | null | undefined): Actor | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  const direct = game.actors.get(trimmed);
  if (direct) return direct;
  for (const actor of game.actors) {
    if (actor.id === trimmed) return actor;
  }
  return undefined;
}

export function listNpcGenDenizenActors(): NpcGenDenizenOption[] {
  const options: NpcGenDenizenOption[] = [];
  for (const actor of game.actors) {
    if (!isNpcGenDenizenActor(actor)) continue;
    const chain = folderChain(actor);
    const subfolder =
      chain.length > 1 ? chain[chain.length - 1]!.name : DENIZENS_ROOT_FOLDER;
    options.push({ id: actor.id, name: actor.name, subfolder });
  }
  return options.sort((a, b) =>
    a.subfolder.localeCompare(b.subfolder) || a.name.localeCompare(b.name),
  );
}

function formatGearItemLabel(item: GearItemSpec): string {
  if (item.quantityRoll) return `${item.name} (${item.quantityRoll})`;
  if (item.shots != null) return `${item.name} (${item.shots} shots)`;
  return item.name;
}

function gearSpecToRows(spec: GearSpec | undefined): NpcGearDisplayRow[] {
  if (!spec) return [];
  const rows: NpcGearDisplayRow[] = [];
  for (const item of spec.items ?? []) {
    rows.push({ label: formatGearItemLabel(item), detail: "" });
  }
  for (const roll of spec.rolls ?? []) {
    rows.push({
      label: roll.table,
      detail: `×${Math.max(1, roll.count)}`,
    });
  }
  return rows;
}

export function buildProfessionDemeanorGearSections(
  rolls: NpcGeneratorRolls,
): NpcGearDisplaySection[] {
  const sections: NpcGearDisplaySection[] = [];
  const profession = resolveProfessionGear(rolls.profession);
  const professionRows = gearSpecToRows(profession);
  if (professionRows.length) {
    sections.push({
      id: "profession",
      title: rolls.profession?.trim() || "Profession",
      rows: professionRows,
    });
  }
  const demeanor = resolveDemeanorGear(rolls.demeanor);
  const demeanorRows = gearSpecToRows(demeanor);
  if (demeanorRows.length) {
    sections.push({
      id: "demeanor",
      title: rolls.demeanor?.trim() || "Demeanor",
      rows: demeanorRows,
    });
  }
  return sections;
}

function ammoShotsFromItem(item: Item): number | undefined {
  const system = item.system as {
    quantity?: number;
    shots?: number | { current?: number; max?: number };
  };
  const quantity = Number(system.quantity ?? 0);
  if (Number.isFinite(quantity) && quantity > 0) return quantity;

  const shots = system.shots;
  if (typeof shots === "number" && Number.isFinite(shots) && shots > 0) {
    return shots;
  }
  if (shots && typeof shots === "object") {
    const current = Number(shots.current ?? 0);
    if (Number.isFinite(current) && current > 0) return current;
  }
  return undefined;
}

export function extractCombatGearFromActor(actor: Actor): GearItemSpec[] {
  const items: GearItemSpec[] = [];
  for (const item of actor.items) {
    if (NON_GEAR_ITEM_TYPES.has(item.type)) continue;
    const spec: GearItemSpec = { name: item.name };
    if (item.type === "ammo") {
      const shots = ammoShotsFromItem(item);
      if (shots != null) spec.shots = shots;
    }
    items.push(spec);
  }
  return items;
}

export function buildDenizenGearSection(
  items: GearItemSpec[],
  title: string,
): NpcGearDisplaySection | null {
  if (!items.length) return null;
  return {
    id: "denizen",
    title,
    rows: items.map((item) => ({
      label: formatGearItemLabel(item),
      detail: "",
    })),
  };
}

export function countPlannedGearItems(state: NpcGeneratorState): number {
  let count = 0;
  for (const section of buildProfessionDemeanorGearSections(state.rolls)) {
    count += section.rows.length;
  }
  count += state.gear.denizenCombatItems.length;
  return count;
}

export function gearStepValue(state: NpcGeneratorState): string {
  const count = countPlannedGearItems(state);
  return count > 0
    ? t("WASTELANDER.NpcGen.Gear.ItemCount", { count })
    : "";
}
