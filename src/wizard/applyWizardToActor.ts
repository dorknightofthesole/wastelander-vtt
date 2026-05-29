import { MODULE_ID } from "../constants.js";
import {
  addCompendiumItemToActor,
  favoriteAllWeaponsOnActor,
  getCompendiumItem,
  isEquippableFalloutGear,
  type FalloutAttributeKey,
} from "../integrations/fallout.js";
import {
  getWorldActor,
  resolveActorId,
  updateWorldActor,
} from "../integrations/falloutActor.js";
import {
  buildEquipmentItemIndex,
  enrichEquipmentLine,
} from "../integrations/equipmentItems.js";
import originsData from "../data/origins-core.json";
import survivorTraitsData from "../data/survivor-traits.json";
import {
  getEquipmentPack,
  getTagSkillLootLines,
  resolvePackItems,
  rollTrinket,
} from "./equipmentRules.js";
import { isOriginCompatibleWithActorType } from "./actorTypeRules.js";
import { getOriginImmunities, isMisterHandyOrigin } from "./originRules.js";
import { getRobotSheetTypeUpdate } from "./robotSheet.js";
import {
  computeHealthMax,
  computeStartingLuckPoints,
} from "./derivedStats.js";
import {
  getEffectiveSkillRank,
  getSkillsTagConfig,
} from "./skillsRules.js";
import type { WizardState } from "./WizardState.js";
import { validateAllWizardSteps } from "./WizardState.js";

const ATTR_KEYS: FalloutAttributeKey[] = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
];

interface OriginRow {
  id: string;
  systemOrigin: string;
  traitName: string | null;
  traitCompendiumUuid?: string;
  equipmentPackId: string;
}

interface SurvivorTraitRow {
  id: string;
  label: string;
  traitCompendiumUuid?: string;
}

const ORIGINS = originsData as OriginRow[];
const SURVIVOR_TRAITS = survivorTraitsData as SurvivorTraitRow[];
const SILENT = { render: false } as const;

async function runApplyStep(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(`${label}: ${detail}`);
  }
}

export interface ApplyWizardContext {
  skillEntries: Array<{ name: string; uuid: string }>;
  perkEligibility?: Record<string, boolean>;
}

function originById(id: string | null): OriginRow | undefined {
  if (!id) return undefined;
  return ORIGINS.find((o) => o.id === id);
}

async function findCompendiumUuidByName(
  packId: string,
  name: string,
  itemType?: string,
): Promise<string | null> {
  const pack = game.packs.get(packId);
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ["uuid", "name", "type"] });
  const lower = name.toLowerCase();
  const match = index.find((e) => {
    if (String(e.name).toLowerCase() !== lower) return false;
    if (!itemType) return true;
    return String((e as { type?: string }).type ?? "") === itemType;
  });
  return match ? String((match as { uuid?: string }).uuid ?? "") : null;
}

async function resolveTraitUuid(
  traitCompendiumUuid: string | undefined,
  traitName: string,
): Promise<string | null> {
  if (traitCompendiumUuid) {
    const doc = await fromUuid(traitCompendiumUuid);
    if (doc instanceof Item) return traitCompendiumUuid;
  }
  return findCompendiumUuidByName("fallout.traits", traitName, "trait");
}

function parseCapsFromText(text: string): number {
  const m = text.match(/(\d+)\s*caps?\b/i);
  return m ? Number(m[1]) : 0;
}

function rollDiceFormula(formula: string): number {
  const m = formula.match(/(\d+)d(\d+)/i);
  if (!m) return 0;
  const count = Number(m[1]);
  const sides = Number(m[2]);
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}

async function addEquipmentLineToActor(
  actorId: string,
  line: string,
  index: Awaited<ReturnType<typeof buildEquipmentItemIndex>>,
): Promise<number> {
  let caps = parseCapsFromText(line);
  const enriched = enrichEquipmentLine(line, index);
  if (enriched.compendiumUuid) {
    const source = await getCompendiumItem(enriched.compendiumUuid);
    await addCompendiumItemToActor(getWorldActor(actorId), enriched.compendiumUuid, {
      equipApparel: source ? isEquippableFalloutGear(source) : false,
    });
    return caps;
  }
  const diceMatch = line.match(/(\d+d\d+)/i);
  if (diceMatch && /caps/i.test(line)) {
    caps += rollDiceFormula(diceMatch[1]!);
  }
  return caps;
}

async function applySkills(
  actorId: string,
  state: WizardState,
  skillEntries: ApplyWizardContext["skillEntries"],
): Promise<void> {
  const parent = getWorldActor(actorId);
  const origin = originById(state.originId);
  const tagConfig = getSkillsTagConfig(origin, state.survivorTraitIds);

  for (const entry of skillEntries) {
    const rank = getEffectiveSkillRank(
      entry.name,
      state.skillRanks,
      state.taggedSkillNames,
      tagConfig.forcedTags,
    );
    const tagged = state.taggedSkillNames.includes(entry.name);

    const existing = parent.items.find(
      (i) => i.type === "skill" && i.name === entry.name,
    );
    if (existing) {
      await existing.update(
        { "system.value": rank, "system.tag": tagged },
        SILENT,
      );
      continue;
    }

    if (!entry.uuid) continue;
    await addCompendiumItemToActor(parent, entry.uuid, {
      equipApparel: false,
      systemOverrides: { value: rank, tag: tagged },
    });
  }
}

async function applyTraits(
  actorId: string,
  state: WizardState,
  origin: OriginRow,
): Promise<void> {
  const parent = getWorldActor(actorId);
  const names: string[] = [];
  if (origin.traitName) names.push(origin.traitName);
  if (origin.id === "survivor") {
    for (const id of state.survivorTraitIds) {
      const t = SURVIVOR_TRAITS.find((row) => row.id === id);
      if (t) names.push(t.label);
    }
  }

  for (const name of names) {
    const row =
      origin.traitName === name
        ? origin
        : SURVIVOR_TRAITS.find((t) => t.label === name);
    const uuid = await resolveTraitUuid(
      (row as { traitCompendiumUuid?: string })?.traitCompendiumUuid,
      name,
    );
    if (uuid) await addCompendiumItemToActor(parent, uuid);
  }
}

async function markCreationComplete(actorId: string): Promise<void> {
  await updateWorldActor(actorId, {
    [`flags.${MODULE_ID}.creationComplete`]: true,
    [`flags.${MODULE_ID}.wizardVersion`]: 1,
  });
}

export async function applyWizardToActor(
  actor: Actor,
  state: WizardState,
  context: ApplyWizardContext,
): Promise<void> {
  const actorId = resolveActorId(actor);
  const actorType = getWorldActor(actorId).type;

  const validation = validateAllWizardSteps(state, {
    skillNames: context.skillEntries.map((e) => e.name),
    perkEligibility: context.perkEligibility,
    actorType,
  });
  if (validation) throw new Error(validation);

  const origin = originById(state.originId);
  if (!origin) throw new Error("Missing origin.");

  if (
    state.originId &&
    !isOriginCompatibleWithActorType(state.originId, actorType)
  ) {
    throw new Error("Selected origin is not valid for this actor sheet type.");
  }

  const attributeUpdate: Record<string, number> = {};
  for (const key of ATTR_KEYS) {
    attributeUpdate[`system.attributes.${key}.value`] = state.special[key];
  }

  const actorUpdate: Record<string, unknown> = {
    ...attributeUpdate,
    "system.origin": origin.systemOrigin,
    "system.trait": origin.traitName ?? "",
  };

  for (const immunity of getOriginImmunities(state.originId)) {
    actorUpdate[`system.immunities.${immunity}`] = true;
  }

  const preApply = getWorldActor(actorId);
  const preSystem = preApply.system as {
    level?: { value?: number };
    radiation?: number;
    health?: { bonus?: number };
    derived?: {
      conditions?: { wellRested?: boolean };
    };
  };
  const level = Number(preSystem.level?.value ?? 1);
  const radiation = Number(preSystem.radiation ?? 0);
  const healthBonus = Number(preSystem.health?.bonus ?? 0);
  const wellRestedOrTinkered = Boolean(
    preSystem.derived?.conditions?.wellRested,
  );
  const healthMax = computeHealthMax(state.special, {
    level,
    radiation,
    healthBonus,
    wellRestedOrTinkered,
  });
  actorUpdate["system.health.max"] = healthMax;
  actorUpdate["system.health.value"] = healthMax;
  actorUpdate["system.luckPoints"] = computeStartingLuckPoints(
    state.special,
    state.survivorTraitIds,
  );

  await runApplyStep("Update character", async () => {
    await updateWorldActor(actorId, actorUpdate);
  });

  await runApplyStep("Apply skills", async () => {
    await applySkills(actorId, state, context.skillEntries);
  });

  await runApplyStep("Apply perks", async () => {
    const parent = getWorldActor(actorId);
    for (const uuid of state.selectedPerkUuids) {
      await addCompendiumItemToActor(parent, uuid, { equipApparel: false });
    }
  });

  await runApplyStep("Apply traits", async () => {
    await applyTraits(actorId, state, origin);
  });

  await runApplyStep("Set actor sheet type", async () => {
    const working = getWorldActor(actorId);
    if (isMisterHandyOrigin(state.originId) && working.type !== "robot") {
      await updateWorldActor(actorId, getRobotSheetTypeUpdate());
    } else if (!isMisterHandyOrigin(state.originId) && working.type === "robot") {
      await updateWorldActor(actorId, { type: "character" });
    }
  });

  await runApplyStep("Apply equipment", async () => {
    const index = await buildEquipmentItemIndex();
    let bonusCaps = 0;

    const pack = getEquipmentPack(
      origin.equipmentPackId,
      state.selectedEquipmentPackId!,
    );
    if (pack) {
      const lines = resolvePackItems(pack, state.equipmentChoices);
      if (pack.hasTrinket && state.trinketRoll !== null) {
        lines.push(rollTrinket(state.trinketRoll));
      }
      for (const line of lines) {
        bonusCaps += await addEquipmentLineToActor(actorId, line, index);
      }
    }

    for (const row of getTagSkillLootLines(state.taggedSkillNames)) {
      bonusCaps += await addEquipmentLineToActor(actorId, row.loot, index);
    }

    if (bonusCaps > 0) {
      const current = Number(
        (getWorldActor(actorId).system as { currency?: { caps?: number } })
          .currency?.caps ?? 0,
      );
      await updateWorldActor(actorId, {
        "system.currency.caps": current + bonusCaps,
      });
    }
  });

  await runApplyStep("Favorite weapons", async () => {
    await favoriteAllWeaponsOnActor(actorId);
  });

  await runApplyStep("Mark creation complete", async () => {
    await markCreationComplete(actorId);
  });
}
