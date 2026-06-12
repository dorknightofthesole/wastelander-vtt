import { MODULE_ID } from "../constants.js";
import { NPC_GENERATOR_SETTINGS } from "./npcGeneratorSettings.js";

export const DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE = `Write a Fallout RPG character biography for a friendly wasteland NPC using only the traits below.
Write 2–3 paragraphs in third person. Use a grounded, post-apocalyptic tone.
Do not invent new secrets, professions, or stats beyond what is listed.`;

export function getNpcGenAiPromptTemplate(): string {
  const settings = game.settings as {
    get: (scope: string, key: string) => unknown;
  };
  const raw = settings.get(
    MODULE_ID,
    NPC_GENERATOR_SETTINGS.npcGenAiPromptTemplate,
  );
  const trimmed = String(raw ?? "").trim();
  return trimmed || DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE;
}

export async function setNpcGenAiPromptTemplate(
  template: string,
): Promise<void> {
  const settings = game.settings as {
    set: (scope: string, key: string, value: unknown) => Promise<unknown>;
  };
  const trimmed = template.trim();
  await settings.set(
    MODULE_ID,
    NPC_GENERATOR_SETTINGS.npcGenAiPromptTemplate,
    trimmed || DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE,
  );
}
