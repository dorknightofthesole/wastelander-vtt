import type { ActorPdfSnapshot } from "./buildActorSnapshot.js";

let pdfLibPromise: Promise<typeof import("pdf-lib")> | null = null;

function loadPdfLib(): Promise<typeof import("pdf-lib")> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdf-lib");
  }
  return pdfLibPromise;
}

/**
 * Read AcroForm values without relying on `field.constructor.name` (broken in Vite production builds).
 */
function readFormField(
  form: import("pdf-lib").PDFForm,
  name: string,
): { kind: "text"; value: string } | { kind: "check"; value: boolean } | null {
  try {
    const value = form.getTextField(name).getText() ?? "";
    return { kind: "text", value: String(value) };
  } catch {
    // not a text field
  }

  try {
    return { kind: "check", value: form.getCheckBox(name).isChecked() };
  } catch {
    // not a checkbox
  }

  try {
    const selected = form.getDropdown(name).getSelected();
    const value = Array.isArray(selected)
      ? selected.join(", ")
      : String(selected ?? "");
    return { kind: "text", value };
  } catch {
    // not a dropdown
  }

  try {
    const value = form.getRadioGroup(name).getSelected() ?? "";
    return { kind: "text", value: String(value) };
  } catch {
    // not a radio group
  }

  return null;
}

export async function parseCharacterSheetPdf(
  bytes: ArrayBuffer,
): Promise<ActorPdfSnapshot> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const text: Record<string, string> = {};
  const checks: Record<string, boolean> = {};

  for (const field of form.getFields()) {
    const name = field.getName();
    const read = readFormField(form, name);
    if (!read) continue;
    if (read.kind === "text") {
      text[name] = read.value;
    } else {
      checks[name] = read.value;
    }
  }

  return { text, checks };
}

export function snapshotHasFormValues(snapshot: ActorPdfSnapshot): boolean {
  const hasText = Object.values(snapshot.text).some(
    (v) => String(v ?? "").trim() !== "",
  );
  const hasChecks = Object.values(snapshot.checks).some((v) => v === true);
  return hasText || hasChecks;
}

export function countSnapshotFields(snapshot: ActorPdfSnapshot): number {
  return Object.keys(snapshot.text).length + Object.keys(snapshot.checks).length;
}

/** Robot v002 sheets use the same AcroForm field names as the human sheet. */
export { parseCharacterSheetPdf as parseRobotCharacterSheetPdf };
