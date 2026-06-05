import { MODULE_ID } from "../constants.js";
import type { ActorPdfSnapshot } from "./buildActorSnapshot.js";
import {
  fetchTemplateBytes,
  pdfTemplateFilenameForActorType,
} from "./pdfTemplates.js";

let pdfLibPromise: Promise<typeof import("pdf-lib")> | null = null;

function loadPdfLib(): Promise<typeof import("pdf-lib")> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdf-lib");
  }
  return pdfLibPromise;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, "").trim() || "character";
}

function setTextField(
  form: import("pdf-lib").PDFForm,
  name: string,
  value: string,
  missing: Set<string>,
): void {
  if (!value) return;
  try {
    const field = form.getTextField(name);
    field.setText(value);
  } catch {
    missing.add(name);
  }
}

function setCheckField(
  form: import("pdf-lib").PDFForm,
  name: string,
  checked: boolean,
  missing: Set<string>,
): void {
  if (!checked) return;
  try {
    const field = form.getCheckBox(name);
    field.check();
  } catch {
    missing.add(name);
  }
}

export async function fillCharacterSheetPdf(
  actorType: string,
  snapshot: ActorPdfSnapshot,
  downloadName: string,
): Promise<void> {
  const templateFile = pdfTemplateFilenameForActorType(actorType);

  const { PDFDocument } = await loadPdfLib();
  const bytes = await fetchTemplateBytes(templateFile);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const missing = new Set<string>();

  for (const [name, value] of Object.entries(snapshot.text)) {
    setTextField(form, name, value, missing);
  }
  for (const [name, checked] of Object.entries(snapshot.checks)) {
    setCheckField(form, name, checked, missing);
  }

  if (missing.size > 0) {
    console.debug(
      `${MODULE_ID} | PDF export skipped unknown fields:`,
      [...missing].sort(),
    );
  }

  // Keep AcroForm fields editable; flatten() would bake values and remove fillability.
  form.updateFieldAppearances();

  const out = await doc.save();
  const blob = new Blob([Uint8Array.from(out)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(downloadName)}-character-sheet.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
