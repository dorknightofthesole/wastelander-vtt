import { addCompendiumItemToActor, getCompendiumItem } from "../integrations/fallout.js";
import {
  getWorldActor,
  refreshActorSheet,
  resolveActorId,
} from "../integrations/falloutActor.js";
import { findActorPerkItem } from "./levelUpPerks.js";

const SILENT = { render: false } as const;

export async function applyLevelUpPerk(actor: Actor, perkUuid: string): Promise<void> {
  const actorId = resolveActorId(actor);
  const parent = getWorldActor(actorId);
  const source = await getCompendiumItem(perkUuid);
  if (!source) {
    throw new Error("Perk not found in compendium.");
  }

  const existing = findActorPerkItem(parent, { name: source.name, uuid: perkUuid });

  if (existing) {
    const sys = existing.system as { rank?: { value?: number; max?: number } };
    const stored = Number(sys.rank?.value ?? 0);
    const currentRank = stored > 0 ? stored : 1;
    const max = Number(sys.rank?.max ?? 1);
    if (currentRank >= max) {
      throw new Error(`${source.name} is already at maximum rank.`);
    }
    await existing.update({ "system.rank.value": currentRank + 1 }, SILENT);
    refreshActorSheet(parent);
    return;
  }

  const created = await addCompendiumItemToActor(parent, perkUuid, { equipApparel: false });
  if (!created) {
    throw new Error(`Failed to add perk "${source.name}".`);
  }

  const sys = created.system as { rank?: { value?: number } };
  if (Number(sys.rank?.value ?? 0) < 1) {
    await created.update({ "system.rank.value": 1 }, SILENT);
  }

  refreshActorSheet(parent);
}
