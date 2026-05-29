import { t, registerTranslations } from "../integrations/i18n.js";
import { resolveActor } from "../integrations/falloutActor.js";
import { applyPdfSnapshotToActor } from "./applyPdfSnapshotToActor.js";
import {
  countSnapshotFields,
  parseCharacterSheetPdf,
} from "./parseCharacterSheetPdf.js";

function promptPdfUpload(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      cleanup();
      if (file) resolve(file);
      else reject(new Error("No file selected."));
    });

    input.addEventListener("cancel", () => {
      cleanup();
      reject(new Error("File selection cancelled."));
    });

    input.click();
  });
}

function confirmPdfImport(actorName: string): Promise<boolean> {
  return new Promise((resolve) => {
    Dialog.confirm({
      title: t("ActorSheet.Import.ConfirmTitle"),
      content: `<p>${t("ActorSheet.Import.ConfirmBody", { name: actorName })}</p>`,
      yes: () => resolve(true),
      no: () => resolve(false),
      defaultYes: false,
    });
  });
}

export async function importActorCharacterSheet(actor: Actor): Promise<void> {
  registerTranslations();

  if (actor.type === "robot") {
    ui.notifications.warn(t("ActorSheet.Import.RobotNotSupported"));
    return;
  }

  let file: File;
  try {
    file = await promptPdfUpload();
  } catch {
    return;
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    ui.notifications.warn(t("ActorSheet.Import.InvalidFile"));
    return;
  }

  const confirmed = await confirmPdfImport(actor.name);
  if (!confirmed) return;

  ui.notifications.info(t("ActorSheet.Import.InProgress"));

  try {
    const bytes = await file.arrayBuffer();
    const snapshot = await parseCharacterSheetPdf(bytes);
    if (countSnapshotFields(snapshot) === 0) {
      ui.notifications.error(t("ActorSheet.Import.NoFormFields"));
      return;
    }
    const result = await applyPdfSnapshotToActor(resolveActor(actor), snapshot);

    const summary =
      result.applied.length > 0
        ? result.applied.join(", ")
        : t("ActorSheet.Import.NothingApplied");

    ui.notifications.info(t("ActorSheet.Import.Success", { summary }));

    for (const warning of result.warnings.slice(0, 5)) {
      ui.notifications.warn(warning);
    }
    if (result.warnings.length > 5) {
      console.warn(
        "Wastelander PDF import:",
        result.warnings.slice(5).join("\n"),
      );
      ui.notifications.warn(
        t("ActorSheet.Import.MoreWarnings", {
          count: result.warnings.length - 5,
        }),
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown error";
    ui.notifications.error(t("ActorSheet.Import.Error", { error: detail }));
    console.error("Wastelander PDF import failed:", error);
  }
}
