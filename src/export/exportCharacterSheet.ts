import { t, registerTranslations } from "../integrations/i18n.js";
import { buildActorPdfSnapshot } from "./buildActorSnapshot.js";
import { fillCharacterSheetPdf } from "./fillCharacterSheetPdf.js";
import {
  isPdfTemplateAvailable,
  pdfTemplateFilenameForActorType,
  PDF_SHEETS_INSTALL_DIR,
} from "./pdfTemplates.js";

export function notifyPdfTemplateMissing(actorType: string): void {
  registerTranslations();
  ui.notifications.warn(
    t("ActorSheet.Export.TemplateMissing", {
      path: PDF_SHEETS_INSTALL_DIR,
      filename: pdfTemplateFilenameForActorType(actorType),
    }),
  );
}

export async function exportActorCharacterSheet(actor: Actor): Promise<void> {
  registerTranslations();

  const available = await isPdfTemplateAvailable(actor.type);
  if (!available) {
    notifyPdfTemplateMissing(actor.type);
    return;
  }

  ui.notifications.info(t("ActorSheet.Export.InProgress"));

  try {
    const snapshot = buildActorPdfSnapshot(actor);
    await fillCharacterSheetPdf(actor.type, snapshot, actor.name);
    ui.notifications.info(t("ActorSheet.Export.Success"));
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown error";
    ui.notifications.error(
      t("ActorSheet.Export.Error", { error: detail }),
    );
    console.error("Wastelander PDF export failed:", error);
  }
}
