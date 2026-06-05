import {
  addCompendiumItemToActor,
  favoriteAllWeaponsOnActor,
  getCompendiumItem,
  isEquippableFalloutGear,
} from "../integrations/fallout.js";
import {
  buildEquipmentItemIndex,
  enrichEquipmentLine,
} from "../integrations/equipmentItems.js";
import { getActorItems } from "./actorItems.js";
import type { ActorPdfSnapshot } from "./buildActorSnapshot.js";
import { ammoLoadedShotsUpdate, ammoQuantityOverride } from "../wizard/ammoQuantity.js";

const SILENT = { render: false } as const;

interface PerkTraitIndexEntry {
  name: string;
  uuid: string;
  itemType: "perk" | "trait";
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function parseIntField(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Math.trunc(Number(String(value).trim()));
  return Number.isFinite(n) ? n : null;
}

function perkTraitLookupCandidates(name: string): string[] {
  const trimmed = name.trim();
  const out: string[] = [];
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!out.some((existing) => existing.toLowerCase() === v.toLowerCase())) {
      out.push(v);
    }
  };

  add(trimmed);
  if (trimmed.includes("/")) {
    for (const part of trimmed.split("/")) {
      add(part);
    }
  }

  return out;
}

async function buildPerkTraitIndex(): Promise<PerkTraitIndexEntry[]> {
  const entries: PerkTraitIndexEntry[] = [];
  const packs: Array<{ id: string; itemType: "perk" | "trait" }> = [
    { id: "fallout.traits", itemType: "trait" },
    { id: "fallout.perks", itemType: "perk" },
  ];

  for (const { id, itemType } of packs) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    const index = await pack.getIndex({ fields: ["uuid", "name", "type"] });
    for (const row of index) {
      const type = String((row as { type?: string }).type ?? "");
      if (type && type !== itemType) continue;
      entries.push({
        name: String(row.name),
        uuid: String((row as { uuid?: string }).uuid ?? ""),
        itemType,
      });
    }
  }

  return entries;
}

function resolvePerkTraitFromIndex(
  name: string,
  index: PerkTraitIndexEntry[],
): PerkTraitIndexEntry | undefined {
  for (const candidate of perkTraitLookupCandidates(name)) {
    const lower = candidate.toLowerCase();
    const trait = index.find(
      (e) => e.itemType === "trait" && e.name.toLowerCase() === lower,
    );
    if (trait) return trait;
    const perk = index.find(
      (e) => e.itemType === "perk" && e.name.toLowerCase() === lower,
    );
    if (perk) return perk;
  }
  return undefined;
}

export function collectPerkTraitRows(
  snapshot: ActorPdfSnapshot,
): Array<{ name: string; rank: number | null }> {
  const rows: Array<{ name: string; rank: number | null }> = [];
  for (let n = 1; n <= 13; n++) {
    const name = snapshot.text[`Perks_Traits_name${n}`]?.trim();
    if (!name) continue;
    const rank = parseIntField(snapshot.text[`Perks_Traits_rank${n}`]);
    rows.push({ name, rank });
  }
  return rows;
}

export async function importPdfPerksAndTraits(
  actor: Actor,
  snapshot: ActorPdfSnapshot,
): Promise<{ added: number; updated: number; warnings: string[] }> {
  const rows = collectPerkTraitRows(snapshot);
  const warnings: string[] = [];
  if (!rows.length) return { added: 0, updated: 0, warnings };

  const parent = actor;
  const perkTraitIndex = await buildPerkTraitIndex();
  const items = getActorItems(parent).filter(
    (i) => i.type === "perk" || i.type === "trait",
  );
  const byName = new Map(items.map((i) => [normalizeName(i.name), i]));

  let added = 0;
  let updated = 0;

  for (const row of rows) {
    let item = byName.get(normalizeName(row.name));

    if (!item) {
      const match = resolvePerkTraitFromIndex(row.name, perkTraitIndex);
      if (match) {
        const created = await addCompendiumItemToActor(parent, match.uuid, {
          equipApparel: false,
        });
        if (created) {
          added++;
          byName.set(normalizeName(created.name), created);
          item = created;
        }
      }
    }

    if (!item) {
      warnings.push(`No matching perk/trait in compendium: "${row.name}".`);
      continue;
    }

    if (row.rank !== null) {
      const current = Number(
        (item.system as { rank?: number }).rank ?? NaN,
      );
      if (current !== row.rank) {
        await item.update({ "system.rank": row.rank }, SILENT);
        updated++;
      }
    }
  }

  return { added, updated, warnings };
}

function itemOwnershipKey(type: string, name: string): string {
  return `${type}:${normalizeName(name)}`;
}

export async function importPdfInventory(
  actor: Actor,
  snapshot: ActorPdfSnapshot,
): Promise<{
  weapons: number;
  gear: number;
  ammo: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let weapons = 0;
  let gear = 0;
  let ammo = 0;

  const hasData =
    Array.from({ length: 5 }, (_, i) => snapshot.text[`weapons_name${i + 1}`]?.trim()).some(Boolean) ||
    Array.from({ length: 18 }, (_, i) => snapshot.text[`gear_item${i + 1}`]?.trim()).some(Boolean) ||
    Array.from({ length: 8 }, (_, i) => snapshot.text[`ammo_caliber${i + 1}`]?.trim()).some(Boolean);

  if (!hasData) {
    return { weapons: 0, gear: 0, ammo: 0, warnings };
  }

  const index = await buildEquipmentItemIndex();
  const owned = new Set(
    getActorItems(actor).map((i) => itemOwnershipKey(i.type, i.name)),
  );

  for (let n = 1; n <= 5; n++) {
    const name = snapshot.text[`weapons_name${n}`]?.trim();
    if (!name) continue;

    const enriched = enrichEquipmentLine(name, index);
    if (!enriched.compendiumUuid) {
      warnings.push(`No compendium match for weapon: "${name}".`);
      continue;
    }

    const source = await getCompendiumItem(enriched.compendiumUuid);
    if (!source || source.type !== "weapon") {
      warnings.push(`"${name}" did not resolve to a weapon.`);
      continue;
    }

    const key = itemOwnershipKey("weapon", source.name);
    if (owned.has(key)) continue;

    await addCompendiumItemToActor(actor, enriched.compendiumUuid);
    owned.add(key);
    weapons++;
  }

  for (let n = 1; n <= 18; n++) {
    const name = snapshot.text[`gear_item${n}`]?.trim();
    if (!name) continue;

    const enriched = enrichEquipmentLine(name, index);
    if (!enriched.compendiumUuid) {
      warnings.push(`No compendium match for gear: "${name}".`);
      continue;
    }

    const source = await getCompendiumItem(enriched.compendiumUuid);
    if (!source) {
      warnings.push(`Could not load compendium item for gear: "${name}".`);
      continue;
    }

    const key = itemOwnershipKey(source.type, source.name);
    if (owned.has(key)) continue;

    await addCompendiumItemToActor(actor, enriched.compendiumUuid, {
      equipApparel: isEquippableFalloutGear(source),
    });
    owned.add(key);
    gear++;
  }

  for (let n = 1; n <= 8; n++) {
    const name = snapshot.text[`ammo_caliber${n}`]?.trim();
    if (!name) continue;

    const qty = parseIntField(snapshot.text[`ammo_caliber_quantity${n}`]) ?? 1;
    const enriched = enrichEquipmentLine(name, index);
    if (!enriched.compendiumUuid) {
      warnings.push(`No compendium match for ammunition: "${name}".`);
      continue;
    }

    const source = await getCompendiumItem(enriched.compendiumUuid);
    if (!source || source.type !== "ammo") {
      warnings.push(`"${name}" did not resolve to ammunition.`);
      continue;
    }

    const key = itemOwnershipKey("ammo", source.name);
    const existing = getActorItems(actor).find(
      (i) => i.type === "ammo" && normalizeName(i.name) === normalizeName(source.name),
    );

    if (existing) {
      const current = Number(
        (existing.system as { quantity?: number }).quantity ?? 0,
      );
      if (qty > current) {
        await existing.update(
          { "system.quantity": qty, ...ammoLoadedShotsUpdate() },
          SILENT,
        );
        ammo++;
      }
      continue;
    }

    if (owned.has(key)) continue;

    await addCompendiumItemToActor(actor, enriched.compendiumUuid, {
      equipApparel: false,
      systemOverrides: ammoQuantityOverride(qty),
    });
    owned.add(key);
    ammo++;
  }

  if (weapons > 0) {
    await favoriteAllWeaponsOnActor(actor);
  }

  return { weapons, gear, ammo, warnings };
}
