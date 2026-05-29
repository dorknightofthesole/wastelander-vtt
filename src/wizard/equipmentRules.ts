import equipmentPacksData from "../data/equipment-packs.json";
import tagSkillLootData from "../data/tag-skill-loot.json";
import trinketsData from "../data/trinkets-d20.json";
import { expandRobotArmEquipmentLine, ROBOT_ARM_WEAPON_AMMO_SHOTS } from "./robotArmEquipment.js";

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
const TAG_SKILL_LOOT = tagSkillLootData as Record<string, string>;
const TRINKETS = trinketsData as string[];

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
  return TAG_SKILL_LOOT[skillName];
}

export function getTagSkillLootLines(taggedSkillNames: string[]): Array<{
  skill: string;
  loot: string;
}> {
  return taggedSkillNames
    .map((skill) => ({ skill, loot: TAG_SKILL_LOOT[skill] }))
    .filter((row): row is { skill: string; loot: string } => Boolean(row.loot));
}

export function rollTrinket(d20: number): string {
  const idx = Math.max(1, Math.min(20, Math.trunc(d20))) - 1;
  return TRINKETS[idx] ?? TRINKETS[0]!;
}

/** Random d20 roll on the Personal Trinkets table (Core Rulebook p. 80). */
export function rollTrinketRandom(): { roll: number; result: string } {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { roll, result: rollTrinket(roll) };
}

function grantToLine(grant: EquipmentGrant): ResolvedEquipmentLine {
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
