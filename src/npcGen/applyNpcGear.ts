import { MODULE_ID } from "../constants.js";
import {
  addCompendiumItemToActor,
  favoriteAllWeaponsOnActor,
  getCompendiumItem,
  isEquippableFalloutGear,
} from "../integrations/fallout.js";
import { resolveActorId, updateWorldActor, getWorldActor } from "../integrations/falloutActor.js";
import {
  buildEquipmentItemIndex,
  clearEquipmentItemIndexCache,
  findExactCompendiumMatch,
  inferPreferredItemType,
  resolveGearCompendiumMatch,
  type CompendiumItemIndexEntry,
} from "../integrations/equipmentItems.js";
import { t } from "../integrations/i18n.js";
import { syncNpcBodyResistanceFromApparel } from "../integrations/syncBodyResistanceFromApparel.js";
import { executeRollTableDraw } from "../scavenging/rollTableLookup.js";
import {
  ammoQuantityOverride,
  ammoQuantityOverrideFromRoll,
} from "../wizard/ammoQuantity.js";
import type { ResolvedEquipmentLine } from "../wizard/equipmentRules.js";
import { getWeaponAmmoBundleByWeaponName } from "../wizard/weaponAmmoBundles.js";
import {
  isGearSpecEmpty,
  resolveDemeanorGear,
  resolveFeatureGear,
  resolveProfessionGear,
  type GearItemSpec,
  type GearSpec,
} from "./npcGearMappings.js";
import { findWandererTable } from "./wandererRollTables.js";
import type {
  NpcGeneratorGearState,
  NpcGeneratorRolls,
} from "./npcGeneratorState.js";

const LOOT_TABLE_ALIASES: Record<string, string> = {
  Chems: "loot-chems",
  Supplies: "loot-supplies",
  Caps: "loot-caps",
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function gearItemToLine(item: GearItemSpec): ResolvedEquipmentLine {
  return {
    text: item.name,
    compendiumName: item.name,
    quantityRoll: item.quantityRoll,
    shots: item.shots,
  };
}

async function ammoSystemOverridesForLine(
  actor: Actor,
  source: Item,
  line: ResolvedEquipmentLine,
): Promise<Record<string, unknown> | undefined> {
  if (source.type !== "ammo") return undefined;
  if (line.shots !== undefined) {
    return ammoQuantityOverride(line.shots);
  }
  if (line.quantityRoll) {
    return ammoQuantityOverrideFromRoll(line.quantityRoll, {
      actor,
      itemName: source.name,
      label: t("WASTELANDER.NpcGen.RollChat.StartingAmmo"),
    });
  }
  return undefined;
}

async function addGearLineToActor(
  actor: Actor,
  line: ResolvedEquipmentLine,
  index: CompendiumItemIndexEntry[],
): Promise<void> {
  const lookupName = (line.compendiumName ?? line.text)?.trim();
  if (!lookupName) return;
  const match = await resolveGearCompendiumMatch(lookupName, index);
  if (!match?.uuid) {
    ui.notifications?.warn(
      t("WASTELANDER.NpcGen.Errors.GearNotFound", { item: line.text }),
    );
    return;
  }

  const source = await getCompendiumItem(match.uuid);
  if (!source) {
    ui.notifications?.warn(
      t("WASTELANDER.NpcGen.Errors.GearNotFound", { item: line.text }),
    );
    return;
  }

  const preferType = inferPreferredItemType(lookupName);
  if (preferType && source.type !== preferType) {
    ui.notifications?.warn(
      t("WASTELANDER.NpcGen.Errors.GearWrongType", {
        item: line.text,
        expected: preferType,
        actual: source.type,
      }),
    );
    return;
  }

  const systemOverrides = await ammoSystemOverridesForLine(actor, source, line);
  const created = await addCompendiumItemToActor(actor, match.uuid, {
    equipApparel: isEquippableFalloutGear(source),
    systemOverrides,
  });
  if (!created) {
    ui.notifications?.warn(
      t("WASTELANDER.NpcGen.Errors.GearNotAdded", { item: line.text }),
    );
  }
}

async function addGearItem(
  actor: Actor,
  item: GearItemSpec,
  index: CompendiumItemIndexEntry[],
): Promise<void> {
  const itemName = item.name?.trim();
  if (!itemName) return;

  if (normalizeKey(itemName) === "caps") {
    const sys = actor.system as { currency?: { caps?: number } };
    const current = Number(sys.currency?.caps ?? 0);
    await updateWorldActor(resolveActorId(actor), {
      "system.currency.caps": current + 25,
    });
    return;
  }

  await addGearLineToActor(actor, gearItemToLine({ ...item, name: itemName }), index);
}

async function addLootWeaponWithAmmo(
  actor: Actor,
  weaponName: string,
  index: CompendiumItemIndexEntry[],
): Promise<void> {
  await addGearItem(actor, { name: weaponName }, index);
  const bundle = getWeaponAmmoBundleByWeaponName(weaponName);
  if (bundle) {
    await addGearItem(
      actor,
      { name: bundle.ammo, quantityRoll: bundle.quantityRoll },
      index,
    );
  }
}

async function rollGearTable(tableName: string): Promise<string | null> {
  const slug = LOOT_TABLE_ALIASES[tableName] ?? tableName;
  const oracleTitle = slug
    .replace(/^loot-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const titles = [
    tableName,
    `Loot ${oracleTitle}`,
    oracleTitle,
    slug,
  ];
  for (const title of titles) {
    const table = findWandererTable(title);
    if (!table) continue;
    const outcome = await executeRollTableDraw(table, { displayChat: false });
    if (outcome.label && !outcome.label.startsWith("(No result on ")) {
      return outcome.label;
    }
  }
  return null;
}

async function applyGearSpec(
  actor: Actor,
  gear: GearSpec | undefined,
  index: CompendiumItemIndexEntry[],
): Promise<void> {
  if (isGearSpecEmpty(gear)) return;
  for (const item of gear.items ?? []) {
    await addGearItem(actor, item, index);
  }
  for (const roll of gear.rolls ?? []) {
    for (let i = 0; i < Math.max(1, roll.count); i++) {
      const label = await rollGearTable(roll.table);
      if (!label) {
        ui.notifications?.warn(
          t("WASTELANDER.NpcGen.Errors.GearTableMissing", {
            table: roll.table,
          }),
        );
        continue;
      }
      const match = findExactCompendiumMatch(label, index);
      if (!match?.uuid) {
        ui.notifications?.warn(
          t("WASTELANDER.NpcGen.Errors.GearNotFound", { item: label }),
        );
        continue;
      }
      const source = await getCompendiumItem(match.uuid);
      if (source?.type === "weapon") {
        await addLootWeaponWithAmmo(actor, source.name, index);
      } else {
        await addGearLineToActor(
          actor,
          { text: label, compendiumName: match.name },
          index,
        );
      }
    }
  }
}

export async function applyNpcGear(
  actor: Actor,
  rolls: NpcGeneratorRolls,
  gear?: NpcGeneratorGearState,
): Promise<void> {
  const parent = getWorldActor(resolveActorId(actor));

  clearEquipmentItemIndexCache();
  const index = await buildEquipmentItemIndex();

  await applyGearSpec(parent, resolveProfessionGear(rolls.profession), index);
  await applyGearSpec(parent, resolveDemeanorGear(rolls.demeanor), index);

  for (const feature of rolls.distinctiveFeatures) {
    await applyGearSpec(parent, resolveFeatureGear(feature), index);
  }

  for (const item of gear?.templateCombatItems ?? []) {
    await addGearItem(parent, item, index);
  }

  await favoriteAllWeaponsOnActor(parent);
  await syncNpcBodyResistanceFromApparel(parent);
  await parent.setFlag(MODULE_ID, "npcGearApplied", true);
}
