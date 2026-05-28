import equipmentPacksData from "../data/equipment-packs.json";
import tagSkillLootData from "../data/tag-skill-loot.json";
import trinketsData from "../data/trinkets-d20.json";

export interface EquipmentPackChoiceOption {
  id: string;
  label: string;
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
}

export interface EquipmentPackGroup {
  label: string;
  description: string;
  packs: EquipmentPackDefinition[];
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

export function resolvePackItems(
  pack: EquipmentPackDefinition,
  choices: Record<string, string>,
): string[] {
  const lines = [...pack.items];
  for (const choice of pack.choices ?? []) {
    const picked = choice.options.find((o) => o.id === choices[choice.id]);
    if (picked) lines.push(picked.label);
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
