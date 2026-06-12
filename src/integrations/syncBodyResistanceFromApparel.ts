import { resolveActorId, updateWorldActor } from "./falloutActor.js";

type ResistanceSlice = {
  physical: number;
  energy: number;
  radiation: number;
  poison: number;
};

type ApparelSystem = {
  apparelType?: string;
  equipped?: boolean;
  stashed?: boolean;
  location?: Record<string, boolean>;
  resistance?: {
    physical?: number;
    energy?: number;
    radiation?: number;
  };
  powerArmor?: {
    powered?: boolean;
    isFrame?: boolean;
  };
};

type ApparelSnapshot = {
  name: string;
  system: ApparelSystem;
};

function readResistanceValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readActorBaseResistance(actor: Actor): ResistanceSlice {
  const sys = actor.system as {
    resistance?: Partial<ResistanceSlice>;
    derived?: { resistance?: Partial<ResistanceSlice> };
  };
  const base = sys.resistance ?? sys.derived?.resistance ?? {};
  return {
    physical: readResistanceValue(base.physical),
    energy: readResistanceValue(base.energy),
    radiation: readResistanceValue(base.radiation),
    poison: readResistanceValue(base.poison),
  };
}

function isEquippedApparel(item: Item): boolean {
  if (item.type !== "apparel") return false;
  const system = item.system as ApparelSystem;
  return Boolean(system.equipped) && !system.stashed;
}

function hasEquippedApparel(actor: Actor): boolean {
  return actor.items.some(isEquippedApparel);
}

/**
 * Mirror Fallout PC apparel layering ({@link FalloutActor#_calculateCharacterBodyResistance})
 * for NPC sheets, which store DR on `system.body_parts` instead of deriving it each prepare.
 */
function computeOutfittedLocations(actor: Actor): Record<string, ApparelSnapshot | false> {
  const bodyParts = (actor.system as { body_parts?: Record<string, unknown> })
    .body_parts;
  const outfittedLocations: Record<string, ApparelSnapshot | false> = {};
  if (!bodyParts) return outfittedLocations;

  for (const key of Object.keys(bodyParts)) {
    outfittedLocations[key] = false;
  }

  for (const [partKey, occupied] of Object.entries(outfittedLocations)) {
    if (occupied) continue;
    const piece = actor.items.find((item) => {
      if (!isEquippedApparel(item)) return false;
      const system = item.system as ApparelSystem;
      return (
        system.apparelType === "powerArmor" &&
        system.powerArmor?.powered &&
        system.powerArmor?.isFrame === false &&
        system.location?.[partKey] === true
      );
    });
    if (piece) {
      outfittedLocations[partKey] = snapshotApparel(piece);
    }
  }

  for (const [partKey, occupied] of Object.entries(outfittedLocations)) {
    if (occupied) continue;
    const armor = actor.items.find((item) => {
      if (!isEquippedApparel(item)) return false;
      const system = item.system as ApparelSystem;
      return (
        system.apparelType === "armor" && system.location?.[partKey] === true
      );
    });
    if (armor) {
      outfittedLocations[partKey] = snapshotApparel(armor);
    }
  }

  const torsoCovered = Boolean(outfittedLocations.torso);
  const armRCovered = Boolean(outfittedLocations.armR);
  const armLCovered = Boolean(outfittedLocations.armL);
  const legLCovered = Boolean(outfittedLocations.legL);
  const legRCovered = Boolean(outfittedLocations.legR);

  if (!torsoCovered && !armRCovered && !armLCovered && !legLCovered && !legRCovered) {
    const outfit = actor.items.find((item) => {
      if (!isEquippedApparel(item)) return false;
      return (item.system as ApparelSystem).apparelType === "outfit";
    });
    if (outfit) {
      const location = (outfit.system as ApparelSystem).location ?? {};
      for (const [partKey, covered] of Object.entries(location)) {
        if (covered && partKey in outfittedLocations) {
          outfittedLocations[partKey] = snapshotApparel(outfit);
        }
      }
    }
  }

  if (!outfittedLocations.head) {
    const headgear = actor.items.find((item) => {
      if (!isEquippedApparel(item)) return false;
      return (item.system as ApparelSystem).apparelType === "headgear";
    });
    if (headgear) {
      outfittedLocations.head = snapshotApparel(headgear);
    }
  }

  const clothing = actor.items.find((item) => {
    if (!isEquippedApparel(item)) return false;
    return (item.system as ApparelSystem).apparelType === "clothing";
  });

  if (clothing) {
    const location = (clothing.system as ApparelSystem).location ?? {};
    for (const [partKey, covered] of Object.entries(location)) {
      if (!(partKey in outfittedLocations) || !covered) continue;
      const existing = outfittedLocations[partKey];
      if (existing) {
        const merged = foundry.utils.duplicate(existing) as ApparelSnapshot;
        merged.name = `${merged.name} over ${clothing.name}`;
        merged.system.resistance = {
          physical: Math.max(
            readResistanceValue(existing.system.resistance?.physical),
            readResistanceValue(clothing.system.resistance?.physical),
          ),
          energy: Math.max(
            readResistanceValue(existing.system.resistance?.energy),
            readResistanceValue(clothing.system.resistance?.energy),
          ),
          radiation: Math.max(
            readResistanceValue(existing.system.resistance?.radiation),
            readResistanceValue(clothing.system.resistance?.radiation),
          ),
        };
        outfittedLocations[partKey] = merged;
      } else {
        outfittedLocations[partKey] = snapshotApparel(clothing);
      }
    }
  }

  return outfittedLocations;
}

function snapshotApparel(item: Item): ApparelSnapshot {
  const system = item.system as ApparelSystem;
  return {
    name: item.name,
    system: foundry.utils.duplicate(system) as ApparelSystem,
  };
}

function computeBodyPartResistances(
  actor: Actor,
): Record<string, ResistanceSlice> | null {
  const bodyParts = (actor.system as { body_parts?: Record<string, unknown> })
    .body_parts;
  if (!bodyParts || !Object.keys(bodyParts).length) return null;
  if (!hasEquippedApparel(actor)) return null;

  const base = readActorBaseResistance(actor);
  const outfitted = computeOutfittedLocations(actor);
  const result: Record<string, ResistanceSlice> = {};

  for (const partKey of Object.keys(bodyParts)) {
    const apparel = outfitted[partKey];
    if (apparel) {
      result[partKey] = {
        physical:
          readResistanceValue(apparel.system.resistance?.physical) +
          base.physical,
        energy:
          readResistanceValue(apparel.system.resistance?.energy) + base.energy,
        radiation:
          readResistanceValue(apparel.system.resistance?.radiation) +
          base.radiation,
        poison: base.poison,
      };
    } else {
      result[partKey] = { ...base };
    }
  }

  return result;
}

function buildBodyPartResistanceUpdate(
  actor: Actor,
): Record<string, unknown> | null {
  const resistances = computeBodyPartResistances(actor);
  if (!resistances) return null;

  const update: Record<string, unknown> = {};
  for (const [partKey, values] of Object.entries(resistances)) {
    update[`system.body_parts.${partKey}.resistance.physical`] = values.physical;
    update[`system.body_parts.${partKey}.resistance.energy`] = values.energy;
    update[`system.body_parts.${partKey}.resistance.radiation`] =
      values.radiation;
    update[`system.body_parts.${partKey}.resistance.poison`] = values.poison;
  }
  return update;
}

/** Persist NPC body-part DR from equipped apparel (partial coverage supported). */
export async function syncNpcBodyResistanceFromApparel(
  actor: Actor,
): Promise<boolean> {
  if (actor.type !== "npc") return false;

  const update = buildBodyPartResistanceUpdate(actor);
  if (!update) return false;

  await updateWorldActor(resolveActorId(actor), update);
  return true;
}
