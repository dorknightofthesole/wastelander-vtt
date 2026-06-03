import equipmentPacksData from "../data/equipment-packs.json";
import tagSkillLootData from "../data/tag-skill-loot.json";
import {
  evaluateRoll,
  postWizardRollChat,
} from "../integrations/fallout.js";
import trinketsData from "../data/trinkets-d20.json";
import { expandRobotArmEquipmentLine, ROBOT_ARM_WEAPON_AMMO_SHOTS } from "./robotArmEquipment.js";
import { expandWeaponAmmoBundle } from "./weaponAmmoBundles.js";

export interface EquipmentGrant {
  name: string;
  quantityRoll?: string;
  /** Fixed shots on an ammo item (e.g. 20 for Mister Handy arm weapons). */
  shots?: number;
}

export interface EquipmentPackChoiceOption {
  id: string;
  label: string;
  /** Exact compendium item names to grant (overrides fuzzy match on label). */
  grants?: EquipmentGrant[];
}

export interface EquipmentPackChoice {
  id: string;
  label: string;
  prompt: string;
  options: EquipmentPackChoiceOption[];
}

export interface EquipmentPackDefinition {
  id: string;
  label: string;
  tagline: string;
  items: string[];
  choices?: EquipmentPackChoice[];
  hasTrinket?: boolean;
  /** Overrides origin `packSystemOrigin` rule for `system.origin` on the actor. */
  systemOrigin?: string;
}

export interface EquipmentPackGroup {
  label: string;
  description: string;
  packs: EquipmentPackDefinition[];
}

/** One line in the equipment list / apply pipeline. */
export interface ResolvedEquipmentLine {
  /** Display text in the wizard UI. */
  text: string;
  /** When set, resolve this exact compendium item name instead of fuzzy-matching text. */
  compendiumName?: string;
  /** Fallout ammo quantity formula (e.g. 10+5dc) applied when the item is ammunition. */
  quantityRoll?: string;
  /** Fixed shots on an ammo item (overrides compendium default). */
  shots?: number;
}

const PACK_GROUPS = equipmentPacksData as Record<string, EquipmentPackGroup>;

export interface TagSkillLootGrant {
  name: string;
  quantityRoll?: string;
  shots?: number;
}

export type TagSkillLootEntry =
  | string
  | {
      display: string;
      grant?: TagSkillLootGrant;
      /** Add rolled shots to each ammo item already on the actor (Small Guns tag loot). */
      addToOwnedAmmo?: string;
    };

const TAG_SKILL_LOOT = tagSkillLootData as Record<string, TagSkillLootEntry>;
const TRINKETS = trinketsData as string[];

function tagSkillLootDisplay(entry: TagSkillLootEntry): string {
  return typeof entry === "string" ? entry : entry.display;
}

export function getEquipmentPackGroup(groupId: string): EquipmentPackGroup | undefined {
  return PACK_GROUPS[groupId];
}

export function getEquipmentPack(
  groupId: string,
  packId: string,
): EquipmentPackDefinition | undefined {
  return PACK_GROUPS[groupId]?.packs.find((p) => p.id === packId);
}

export function getTagSkillLoot(skillName: string): string | undefined {
  const entry = TAG_SKILL_LOOT[skillName];
  return entry ? tagSkillLootDisplay(entry) : undefined;
}

export function getTagSkillLootLines(taggedSkillNames: string[]): Array<{
  skill: string;
  loot: string;
}> {
  return taggedSkillNames
    .map((skill) => {
      const entry = TAG_SKILL_LOOT[skill];
      if (!entry) return null;
      return { skill, loot: tagSkillLootDisplay(entry) };
    })
    .filter((row): row is { skill: string; loot: string } => Boolean(row));
}

export type TagSkillLootApplyEntry =
  | { skill: string; kind: "text"; text: string }
  | { skill: string; kind: "grant"; grant: TagSkillLootGrant }
  | { skill: string; kind: "addToOwnedAmmo"; quantityRoll: string };

export function getTagSkillLootApplyEntries(
  taggedSkillNames: string[],
): TagSkillLootApplyEntry[] {
  const out: TagSkillLootApplyEntry[] = [];
  for (const skill of taggedSkillNames) {
    const entry = TAG_SKILL_LOOT[skill];
    if (!entry) continue;
    if (typeof entry === "string") {
      out.push({ skill, kind: "text", text: entry });
      continue;
    }
    if (entry.grant) {
      out.push({ skill, kind: "grant", grant: entry.grant });
    }
    if (entry.addToOwnedAmmo) {
      out.push({
        skill,
        kind: "addToOwnedAmmo",
        quantityRoll: entry.addToOwnedAmmo,
      });
    }
  }
  return out;
}

export function rollTrinket(d20: number): string {
  const idx = Math.max(1, Math.min(20, Math.trunc(d20))) - 1;
  return TRINKETS[idx] ?? TRINKETS[0]!;
}

/** Random d20 roll on the Personal Trinkets table (Core Rulebook p. 80). */
export async function rollTrinketRandom(
  actor?: Actor | null,
): Promise<{ roll: number; result: string }> {
  const evaluated = await evaluateRoll("1d20");
  const face = Math.max(1, Math.min(20, evaluated.total));
  const result = rollTrinket(face);

  await postWizardRollChat(evaluated.roll, {
    actor,
    detail: result,
    formula: evaluated.formula,
    label: game.i18n.localize("WASTELANDER.Wizard.RollChat.PersonalTrinket"),
    total: face,
  });

  return { roll: face, result };
}

export function grantToLine(grant: EquipmentGrant): ResolvedEquipmentLine {
  return {
    text: grant.name,
    compendiumName: grant.name,
    quantityRoll: grant.quantityRoll,
    shots: grant.shots,
  };
}

function expandPackLine(
  text: string,
  robotArmAmmoShots?: number,
): ResolvedEquipmentLine[] {
  const weaponAmmo = expandWeaponAmmoBundle(text);
  if (weaponAmmo) return weaponAmmo;

  if (robotArmAmmoShots) {
    return expandRobotArmEquipmentLine(text, robotArmAmmoShots);
  }
  return [{ text }];
}

export function resolvePackItems(
  pack: EquipmentPackDefinition,
  choices: Record<string, string>,
  options?: { robotArmAmmoShots?: number },
): ResolvedEquipmentLine[] {
  const { robotArmAmmoShots } = options ?? {};
  const lines: ResolvedEquipmentLine[] = [];
  for (const item of pack.items) {
    // Mercenary (and similar): ammo is granted via the ranged `grants` choice, not this summary line.
    if (/chosen ranged weapon/i.test(item)) continue;
    lines.push(...expandPackLine(item, robotArmAmmoShots));
  }
  for (const choice of pack.choices ?? []) {
    const picked = choice.options.find((o) => o.id === choices[choice.id]);
    if (!picked) continue;
    if (picked.grants?.length) {
      lines.push(...picked.grants.map(grantToLine));
    } else {
      lines.push(...expandPackLine(picked.label, robotArmAmmoShots));
    }
  }
  return lines;
}

export function validateEquipmentChoices(
  pack: EquipmentPackDefinition,
  choices: Record<string, string>,
): string | null {
  for (const choice of pack.choices ?? []) {
    const value = choices[choice.id];
    if (!value) return `Choose: ${choice.prompt}`;
    if (!choice.options.some((o) => o.id === value)) {
      return `Invalid choice for ${choice.label}.`;
    }
  }
  return null;
}
