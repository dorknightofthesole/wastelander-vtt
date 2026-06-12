import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import NpcGeneratorApp from "./NpcGeneratorApp.js";
import { registerNpcGenActorSheetData } from "./npcGenActorSheet.js";
import { registerNpcGeneratorSettings } from "./npcGeneratorSettings.js";

type SceneControlGroup = {
  name: string;
  tools?: Record<string, SceneControlTool>;
};

type SceneControlTool = {
  name: string;
  title: string;
  icon: string;
  order?: number;
  button?: boolean;
  visible?: boolean;
  onClick?: () => void;
  onChange?: () => void;
};

type SceneControlsRecord = Record<string, SceneControlGroup>;

function registerSceneControlTool(
  group: SceneControlGroup,
  tool: SceneControlTool,
): void {
  group.tools ??= {};
  if (group.tools[tool.name]) return;
  const order = Object.keys(group.tools).length;
  group.tools[tool.name] = { ...tool, order: tool.order ?? order };
}

export function registerNpcGeneratorHooks(): void {
  registerNpcGeneratorSettings();

  Hooks.on("renderActorSheet", (...args: unknown[]) => {
    const [app, html] = args as [
      { actor?: Actor; document?: Actor; element?: HTMLElement | HTMLElement[] },
      JQuery | HTMLElement,
    ];
    registerNpcGenActorSheetData(app, html);
  });

  Hooks.on("getSceneControlButtons", (controls: SceneControlsRecord) => {
    if (!controls || typeof controls !== "object") return;
    if (!currentUserIsOverseer()) return;

    const group = controls.tokens ?? controls.token;
    if (!group) return;

    registerSceneControlTool(group, {
      name: "wastelander-npc-generator",
      title: t("WASTELANDER.NpcGen.Tooltip"),
      icon: "fa-solid fa-user-plus",
      button: true,
      visible: true,
      onChange: () => {
        void NpcGeneratorApp.renderOpen();
      },
    });
  });
}
