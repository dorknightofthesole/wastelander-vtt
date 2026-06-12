import { MODULE_ID } from "../constants.js";
import NpcGearMappingsSettingsApp from "./NpcGearMappingsSettingsApp.js";
import NpcGenAiPromptSettingsApp from "./NpcGenAiPromptSettingsApp.js";
import { DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE } from "./npcGenAiPromptSettings.js";

export const NPC_GENERATOR_SETTINGS = {
  npcGeneratorJournalId: "npcGeneratorJournalId",
  /** GM override for profession + demeanor starting gear. */
  npcGearMappings: "npcGearMappings",
  /** World-level instructions prepended to the NPC generator AI biography prompt. */
  npcGenAiPromptTemplate: "npcGenAiPromptTemplate",
} as const;

export function registerNpcGeneratorSettings(): void {
  const settings = (
    game as {
      settings?: {
        register: (...args: unknown[]) => void;
        registerMenu: (...args: unknown[]) => void;
      };
    }
  ).settings;
  if (!settings?.register) return;

  settings.register(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGeneratorJournalId, {
    name: "WASTELANDER.NpcGen.Settings.JournalId",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  settings.register(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGearMappings, {
    scope: "world",
    type: Object,
    default: {},
    config: false,
  });

  settings.registerMenu(MODULE_ID, "npcGearMappings", {
    name: "WASTELANDER.NpcGen.Settings.GearMappingsMenuName",
    label: "WASTELANDER.NpcGen.Settings.GearMappingsMenuLabel",
    hint: "WASTELANDER.NpcGen.Settings.GearMappingsMenuHint",
    icon: "fas fa-suitcase",
    type: NpcGearMappingsSettingsApp,
    restricted: true,
  });

  settings.register(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGenAiPromptTemplate, {
    scope: "world",
    type: String,
    default: DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE,
    config: false,
  });

  settings.registerMenu(MODULE_ID, "npcGenAiPromptTemplate", {
    name: "WASTELANDER.NpcGen.Settings.AiPromptTemplate.MenuName",
    label: "WASTELANDER.NpcGen.Settings.AiPromptTemplate.MenuLabel",
    hint: "WASTELANDER.NpcGen.Settings.AiPromptTemplate.MenuHint",
    icon: "fas fa-robot",
    type: NpcGenAiPromptSettingsApp,
    restricted: true,
  });
}
