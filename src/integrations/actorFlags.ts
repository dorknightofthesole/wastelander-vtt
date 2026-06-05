import { MODULE_ID } from "../constants.js";

/** True after the character wizard has been finished at least once for this actor. */
export function isWizardCreationComplete(actor: Actor): boolean {
  return Boolean(actor.getFlag(MODULE_ID, "creationComplete"));
}
