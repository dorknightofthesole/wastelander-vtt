import { MODULE_ID, MODULE_PATH } from "../constants.js";
import humanMap from "./fieldMaps/human-v002.json";

export const HUMAN_PDF_TEMPLATE = humanMap.template as string;
export const ROBOT_PDF_TEMPLATE = humanMap.robotTemplate as string;

/** Relative path under the Foundry data folder for user-installed PDFs. */
export const PDF_SHEETS_INSTALL_DIR = `modules/${MODULE_ID}/assets/sheets`;

const availabilityByFile = new Map<string, boolean>();

export function pdfTemplateFilenameForActorType(actorType: string): string {
  return actorType === "robot" ? ROBOT_PDF_TEMPLATE : HUMAN_PDF_TEMPLATE;
}

export function pdfTemplateUrl(filename: string): string {
  return `${MODULE_PATH}/assets/sheets/${filename}`;
}

export function clearPdfTemplateAvailabilityCache(): void {
  availabilityByFile.clear();
}

export async function isPdfTemplateAvailable(
  actorType: string,
): Promise<boolean> {
  const filename = pdfTemplateFilenameForActorType(actorType);
  if (availabilityByFile.has(filename)) {
    return availabilityByFile.get(filename) ?? false;
  }

  const url = pdfTemplateUrl(filename);
  let available = false;
  try {
    let response = await fetch(url, { method: "HEAD" });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, { method: "GET" });
    }
    available = response.ok;
  } catch {
    available = false;
  }

  availabilityByFile.set(filename, available);
  return available;
}

export async function fetchTemplateBytes(filename: string): Promise<ArrayBuffer> {
  const response = await fetch(pdfTemplateUrl(filename));
  if (!response.ok) {
    throw new Error(`Could not load character sheet PDF (${response.status}).`);
  }
  return response.arrayBuffer();
}

/** @deprecated Use {@link isPdfTemplateAvailable}("robot") */
export async function robotTemplateAvailable(): Promise<boolean> {
  return isPdfTemplateAvailable("robot");
}
