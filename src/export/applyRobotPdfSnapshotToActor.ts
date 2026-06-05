import {
  resolveActor,
  resolveActorId,
  updateWorldActor,
} from "../integrations/falloutActor.js";
import type { ActorPdfSnapshot } from "./buildActorSnapshot.js";
import {
  applyPdfSnapshotToActor,
  type PdfImportResult,
} from "./applyPdfSnapshotToActor.js";

const PDF_BODY_PARTS: Array<{
  systemKey: string;
  pdfPrefix: string;
  energyField: string;
}> = [
  { systemKey: "head", pdfPrefix: "head", energyField: "head_en_dr" },
  { systemKey: "torso", pdfPrefix: "torso", energyField: "toros_en_dr" },
  { systemKey: "armL", pdfPrefix: "left-arm", energyField: "left-arm_en_dr" },
  { systemKey: "armR", pdfPrefix: "right-arm", energyField: "right-arm_en_dr" },
  { systemKey: "legL", pdfPrefix: "left-leg", energyField: "left-leg_en_dr" },
  { systemKey: "legR", pdfPrefix: "right-leg", energyField: "right-leg_en_dr" },
];

function parseIntField(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Math.trunc(Number(String(value).trim()));
  return Number.isFinite(n) ? n : null;
}

function applyRobotBodyPartsFromPdf(
  snapshot: ActorPdfSnapshot,
  systemUpdate: Record<string, unknown>,
): boolean {
  let any = false;

  for (const { systemKey, pdfPrefix, energyField } of PDF_BODY_PARTS) {
    const phys = parseIntField(snapshot.text[`${pdfPrefix}_phys_dr`]);
    const en = parseIntField(snapshot.text[energyField]);
    const rad = parseIntField(snapshot.text[`${pdfPrefix}_rad_dr`]);
    const hp = parseIntField(snapshot.text[`${pdfPrefix}_hp`]);

    if (phys !== null) {
      systemUpdate[`system.body_parts.${systemKey}.resistance.physical`] = phys;
      any = true;
    }
    if (en !== null) {
      systemUpdate[`system.body_parts.${systemKey}.resistance.energy`] = en;
      any = true;
    }
    if (rad !== null) {
      systemUpdate[`system.body_parts.${systemKey}.resistance.radiation`] = rad;
      any = true;
    }
    if (hp !== null) {
      systemUpdate[`system.body_parts.${systemKey}.hp.value`] = hp;
      systemUpdate[`system.body_parts.${systemKey}.hp.max`] = hp;
      any = true;
    }
  }

  const poison = snapshot.text.poison_dr?.trim();
  if (poison && /^immune$/i.test(poison)) {
    systemUpdate["system.immunities.poison"] = true;
    any = true;
  }

  return any;
}

/** Apply a parsed robot character sheet snapshot (v002 AcroForm, same fields as human). */
export async function applyRobotPdfSnapshotToActor(
  actor: Actor,
  snapshot: ActorPdfSnapshot,
): Promise<PdfImportResult> {
  const result = await applyPdfSnapshotToActor(actor, snapshot);

  const world = resolveActor(actor);
  const actorId = resolveActorId(world);
  const systemUpdate: Record<string, unknown> = {};

  if (applyRobotBodyPartsFromPdf(snapshot, systemUpdate)) {
    await updateWorldActor(actorId, systemUpdate);
    result.applied.push("Body parts (DR / HP)");
  }

  world.sheet?.render(true);

  return result;
}
