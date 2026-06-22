import specialBobbleheads from "../data/bobbleheads/special.json";

export type FalloutSpecialAttribute =
  | "str"
  | "per"
  | "end"
  | "cha"
  | "int"
  | "agi"
  | "luc";

export type SpecialBobbleheadEntry = {
  attribute: FalloutSpecialAttribute;
  bonus: number;
};

export type BobbleheadBonus = {
  category: "special";
  attribute: FalloutSpecialAttribute;
  bonus: number;
};

const SPECIAL_CATALOG = specialBobbleheads as Record<string, SpecialBobbleheadEntry>;

const ATTRIBUTE_LABELS: Record<FalloutSpecialAttribute, string> = {
  str: "STR",
  per: "PER",
  end: "END",
  cha: "CHA",
  int: "INT",
  agi: "AGI",
  luc: "LUC",
};

export function specialAttributeLabel(attribute: FalloutSpecialAttribute): string {
  return ATTRIBUTE_LABELS[attribute];
}

export function resolveBobbleheadBonus(
  item: { name?: string; type?: string; system?: { stashed?: boolean } },
): BobbleheadBonus | null {
  if (item.type !== "miscellany") return null;
  if (item.system?.stashed) return null;

  const name = item.name?.trim();
  if (!name) return null;

  const entry = SPECIAL_CATALOG[name];
  if (!entry) return null;

  return {
    category: "special",
    attribute: entry.attribute,
    bonus: entry.bonus,
  };
}

export function isBobbleheadEligibleActor(actor: Actor): boolean {
  return actor.type === "character" || actor.type === "robot";
}
