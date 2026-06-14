import { MODULE_ID } from "./constants.js";
import {
  registerActorSheetControlHooks,
  registerActorSheetControls,
} from "./integrations/actorSheetControls.js";
import { registerTranslations } from "./integrations/i18n.js";
import {
  getBundledOracleRollTableCount,
  importBundledOracleRollTables,
} from "./oracle/oracleRollTableImport.js";
import {
  getBundledEncounterRollTableCount,
  importBundledEncounterRollTables,
} from "./encounters/encounterRollTableImport.js";
import { registerHexcrawlHooks } from "./hexcrawl/hexcrawlHooks.js";
import { registerOracleSettings } from "./oracle/oracleSettings.js";
import { getBundledDenizenCount, importBundledDenizens } from "./scavenging/denizenImport.js";
import { registerCombatDiceChatButton } from "./integrations/combatDiceChatButton.js";
import {
  createInitialNpcGeneratorState,
  type NpcGenStepId,
} from "./npcGen/npcGeneratorState.js";
import NpcGeneratorApp from "./npcGen/NpcGeneratorApp.js";
import { registerNpcGeneratorHooks } from "./npcGen/npcGeneratorHooks.js";
import {
  diagnoseNpcGenTables,
  logNpcGenTableDiagnostics,
} from "./npcGen/wandererRollTables.js";
import { registerScavengingHooks } from "./scavenging/scavengingHooks.js";

Hooks.once("init", () => {
  registerTranslations();
  registerActorSheetControlHooks();
  registerCombatDiceChatButton();
  registerScavengingHooks();
  registerHexcrawlHooks();
  registerNpcGeneratorHooks();
  registerOracleSettings();
  console.log(`${MODULE_ID} | initializing`);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID) as { api?: Record<string, unknown> } | undefined;
  if (!mod) return;
  mod.api = {
    importDenizens: importBundledDenizens,
    bundledDenizenCount: getBundledDenizenCount,
    importOracleRollTables: importBundledOracleRollTables,
    bundledOracleRollTableCount: getBundledOracleRollTableCount,
    importEncounterRollTables: importBundledEncounterRollTables,
    bundledEncounterRollTableCount: getBundledEncounterRollTableCount,
    /** Console diagnostics for NPC generator roll tables (optional step id). */
    debugNpcGenTables: (step?: NpcGenStepId) => {
      const state =
        NpcGeneratorApp.getOpenState() ?? createInitialNpcGeneratorState();
      if (step) state.step = step;
      return logNpcGenTableDiagnostics(diagnoseNpcGenTables(state.step, state));
    },
  };
});

Hooks.on("renderActorSheet", (...args: unknown[]) => {
  const [app, html] = args as [{ actor?: Actor; document?: Actor }, JQuery];
  registerActorSheetControls(app, html);
});
