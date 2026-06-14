import { MODULE_ID } from "../constants.js";
import EncounterRollTableImportMenuApp from "./EncounterRollTableImportMenuApp.js";

export function registerEncounterSettings(): void {
  const settings = (game as { settings?: { register: (...args: unknown[]) => void } })
    .settings;
  if (!settings?.register) return;

  settings.registerMenu(MODULE_ID, "importEncounterRollTables", {
    name: "WASTELANDER.Encounters.Import.MenuName",
    label: "WASTELANDER.Encounters.Import.MenuLabel",
    hint: "WASTELANDER.Encounters.Import.MenuHint",
    icon: "fas fa-map",
    type: EncounterRollTableImportMenuApp,
    restricted: true,
  });
}
