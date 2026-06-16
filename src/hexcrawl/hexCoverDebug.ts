import { MODULE_ID } from "../constants.js";
import { isHexCoverDebugEnabled } from "./hexcrawlSettings.js";

/** Console trace for hex cover removal (enable in module settings). */
export function debugHexCover(step: string, detail?: Record<string, unknown>): void {
  if (!isHexCoverDebugEnabled()) return;
  const label = `${MODULE_ID} | hex cover`;
  if (detail !== undefined) {
    console.log(label, step, detail);
  } else {
    console.log(label, step);
  }
}
