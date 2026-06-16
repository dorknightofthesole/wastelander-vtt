import { MODULE_ID } from "../constants.js";
import { isStartingLocationDebugEnabled } from "./hexcrawlSettings.js";

/** Console trace for first-token starting location prompt (enable in module settings). */
export function debugStartingLocation(step: string, detail?: Record<string, unknown>): void {
  if (!isStartingLocationDebugEnabled()) return;
  const label = `${MODULE_ID} | starting location`;
  if (detail !== undefined) {
    console.log(label, step, detail);
  } else {
    console.log(label, step);
  }
}
