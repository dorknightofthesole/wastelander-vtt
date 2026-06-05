import type { FalloutAttributeKey } from "../integrations/fallout.js";
import {
  getWorldActor,
  resolveActor,
  resolveActorId,
  updateWorldActor,
} from "../integrations/falloutActor.js";
import { getActorItems } from "./actorItems.js";
import type { ActorPdfSnapshot } from "./buildActorSnapshot.js";
import {
  countSnapshotFields,
  snapshotHasFormValues,
} from "./parseCharacterSheetPdf.js";
import {
  importPdfInventory,
  importPdfPerksAndTraits,
} from "./pdfCompendiumImport.js";
import { skillPdfFieldBase } from "./skillPdfSlugs.js";

const SILENT = { render: false } as const;

const PDF_ATTR_TO_KEY: Record<string, FalloutAttributeKey> = {
  strenght: "str",
  perception: "per",
  endurance: "end",
  charisma: "cha",
  intelligence: "int",
  agility: "agi",
  Luck: "luc",
};

export interface PdfImportResult {
  applied: string[];
  warnings: string[];
}

function parseIntField(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Math.trunc(Number(String(value).trim()));
  return Number.isFinite(n) ? n : null;
}

export async function applyPdfSnapshotToActor(
  actor: Actor,
  snapshot: ActorPdfSnapshot,
): Promise<PdfImportResult> {
  const world = resolveActor(actor);
  const actorId = resolveActorId(world);
  const parent = getWorldActor(actorId);
  const applied: string[] = [];
  const warnings: string[] = [];

  const actorUpdate: Record<string, unknown> = {};
  const systemUpdate: Record<string, unknown> = {};

  const pdfName = snapshot.text.character_name?.trim();
  if (pdfName && pdfName !== world.name) {
    actorUpdate.name = pdfName;
    applied.push("Character name");
  }

  const origin = snapshot.text.origin?.trim();
  if (origin) {
    systemUpdate["system.origin"] = origin;
    applied.push("Origin");
  }

  for (const [pdfKey, attr] of Object.entries(PDF_ATTR_TO_KEY)) {
    const value = parseIntField(snapshot.text[pdfKey]);
    if (value === null) continue;
    systemUpdate[`system.attributes.${attr}.value`] = value;
  }
  if (Object.keys(PDF_ATTR_TO_KEY).some((k) => parseIntField(snapshot.text[k]) !== null)) {
    applied.push("S.P.E.C.I.A.L.");
  }

  const luck = parseIntField(snapshot.text.luck_points);
  if (luck !== null) {
    systemUpdate["system.luckPoints"] = luck;
    applied.push("Luck points");
  }

  const level = parseIntField(snapshot.text.level);
  if (level !== null) {
    systemUpdate["system.level.value"] = level;
    applied.push("Level");
  }

  const xp = parseIntField(snapshot.text.xp_earned);
  if (xp !== null) {
    systemUpdate["system.level.currentXP"] = xp;
  }

  const xpNext = parseIntField(snapshot.text.xp_to_nextlevel);
  if (xpNext !== null) {
    systemUpdate["system.level.nextLevelXP"] = xpNext;
  }
  if (xp !== null || xpNext !== null) {
    applied.push("Experience");
  }

  const hpMax = parseIntField(snapshot.text.health_maximum_hp);
  const hpCur = parseIntField(snapshot.text.health_current_hp);
  if (hpMax !== null) {
    systemUpdate["system.health.max"] = hpMax;
  }
  if (hpCur !== null) {
    systemUpdate["system.health.value"] = hpCur;
  } else if (hpMax !== null) {
    systemUpdate["system.health.value"] = hpMax;
  }
  if (hpMax !== null || hpCur !== null) {
    applied.push("Health");
  }

  const caps = parseIntField(snapshot.text.Caps);
  if (caps !== null) {
    systemUpdate["system.currency.caps"] = caps;
    applied.push("Caps");
  }

  const carryMax = parseIntField(snapshot.text.maximum_carry_weight);
  const carryCur = parseIntField(snapshot.text.current_carry_weight);
  if (carryMax !== null) {
    systemUpdate["system.derived.carryWeight.max"] = carryMax;
  }
  if (carryCur !== null) {
    systemUpdate["system.derived.carryWeight.value"] = carryCur;
  }
  if (carryMax !== null || carryCur !== null) {
    applied.push("Carry weight");
  }

  const mergedUpdate = { ...actorUpdate, ...systemUpdate };
  if (Object.keys(mergedUpdate).length > 0) {
    await updateWorldActor(actorId, mergedUpdate);
  }

  const skillUpdates: Array<Record<string, unknown>> = [];
  for (const item of getActorItems(parent)) {
    if (item.type !== "skill") continue;
    const base = skillPdfFieldBase(item.name);
    if (!base) {
      warnings.push(`No PDF mapping for skill "${item.name}".`);
      continue;
    }
    const rank = parseIntField(snapshot.text[`${base}_rank`]);
    if (rank === null) continue;
    const tagged = Boolean(snapshot.checks[`${base}_tag`]);
    skillUpdates.push({
      _id: item.id,
      "system.value": rank,
      "system.tag": tagged,
    });
  }
  if (skillUpdates.length > 0) {
    await parent.updateEmbeddedDocuments("Item", skillUpdates, SILENT);
    applied.push(`Skills (${skillUpdates.length})`);
  }

  const perkImport = await importPdfPerksAndTraits(parent, snapshot);
  warnings.push(...perkImport.warnings);
  if (perkImport.added > 0 || perkImport.updated > 0) {
    const parts: string[] = [];
    if (perkImport.added > 0) parts.push(`${perkImport.added} added`);
    if (perkImport.updated > 0) parts.push(`${perkImport.updated} updated`);
    applied.push(`Perks/traits (${parts.join(", ")})`);
  }

  const inventoryImport = await importPdfInventory(parent, snapshot);
  warnings.push(...inventoryImport.warnings);
  const inventoryParts: string[] = [];
  if (inventoryImport.weapons > 0) {
    inventoryParts.push(`${inventoryImport.weapons} weapon(s)`);
  }
  if (inventoryImport.gear > 0) {
    inventoryParts.push(`${inventoryImport.gear} gear`);
  }
  if (inventoryImport.ammo > 0) {
    inventoryParts.push(`${inventoryImport.ammo} ammo`);
  }
  if (inventoryParts.length > 0) {
    applied.push(`Equipment (${inventoryParts.join(", ")})`);
  }

  if (applied.length === 0) {
    const fieldCount = countSnapshotFields(snapshot);
    if (fieldCount === 0) {
      warnings.push(
        "No form fields could be read from this PDF. Use a fillable Fallout 2d20 character sheet.",
      );
    } else if (!snapshotHasFormValues(snapshot)) {
      warnings.push(
        `Read ${fieldCount} form fields, but they are all empty. Fill in the PDF before importing.`,
      );
    } else {
      warnings.push(
        "PDF values were read but none could be applied to this actor (check skill items exist on the sheet).",
      );
    }
  }

  parent.sheet?.render(true);

  return { applied, warnings };
}
