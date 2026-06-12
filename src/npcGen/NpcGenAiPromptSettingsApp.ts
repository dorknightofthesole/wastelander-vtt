import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE,
  getNpcGenAiPromptTemplate,
  setNpcGenAiPromptTemplate,
} from "./npcGenAiPromptSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class NpcGenAiPromptSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #template = DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE;
  #loadedFromSettings = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-npc-gen-ai-prompt-settings",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-npc-gen-ai-prompt-settings-app"],
    window: {
      title: "WASTELANDER.NpcGen.Settings.AiPromptTemplate.MenuTitle",
      icon: "fa-solid fa-robot",
    },
    position: { width: 640, height: "auto" },
    actions: {
      saveTemplate: NpcGenAiPromptSettingsApp.#onSaveTemplate,
      resetDefaults: NpcGenAiPromptSettingsApp.#onResetDefaults,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/npcGen/ai-prompt-settings.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    if (!this.#loadedFromSettings) {
      this.#template = getNpcGenAiPromptTemplate();
      this.#loadedFromSettings = true;
    }
    return {
      template: this.#template,
      defaultTemplate: DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE,
    };
  }

  #rootElement(): HTMLElement | null {
    const el = this.element;
    if (el instanceof HTMLElement) return el;
    if (Array.isArray(el) && el[0] instanceof HTMLElement) return el[0];
    return null;
  }

  static async #onSaveTemplate(this: NpcGenAiPromptSettingsApp): Promise<void> {
    const root = this.#rootElement();
    const value =
      root
        ?.querySelector<HTMLTextAreaElement>('[name="npcGenAiPromptTemplate"]')
        ?.value?.trim() ?? "";
    await setNpcGenAiPromptTemplate(value);
    this.#template = getNpcGenAiPromptTemplate();
    ui.notifications?.info(t("WASTELANDER.NpcGen.Settings.AiPromptTemplate.Saved"));
    await this.render({ force: true });
  }

  static async #onResetDefaults(
    this: NpcGenAiPromptSettingsApp,
  ): Promise<void> {
    await setNpcGenAiPromptTemplate(DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE);
    this.#template = DEFAULT_NPC_GEN_AI_PROMPT_TEMPLATE;
    ui.notifications?.info(t("WASTELANDER.NpcGen.Settings.AiPromptTemplate.Reset"));
    await this.render({ force: true });
  }
}
