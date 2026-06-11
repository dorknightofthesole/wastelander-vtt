import { MODULE_ID } from "../constants.js";
import OracleRollTableImportMenuApp from "./OracleRollTableImportMenuApp.js";

export function registerOracleSettings(): void {
  const settings = (game as { settings?: { register: (...args: unknown[]) => void } })
    .settings;
  if (!settings?.register) return;

  settings.registerMenu(MODULE_ID, "importOracleRollTables", {
    name: "WASTELANDER.Oracle.Import.MenuName",
    label: "WASTELANDER.Oracle.Import.MenuLabel",
    hint: "WASTELANDER.Oracle.Import.MenuHint",
    icon: "fas fa-dice",
    type: OracleRollTableImportMenuApp,
    restricted: true,
  });
}
