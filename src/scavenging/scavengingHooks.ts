import { t } from "../integrations/i18n.js";
import ScavengerLocationApp from "./ScavengerLocationApp.js";
import { registerDenizenImportHooks } from "./registerDenizenImportHooks.js";
import { registerScavengingSettings } from "./scavengingSettings.js";

/** Foundry v13+: Record of control name → SceneControl; tools are Record<string, SceneControlTool>. */
type SceneControlsRecord = Record<string, SceneControlGroup>;

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

export function registerScavengingHooks(): void {
  registerScavengingSettings();
  registerDenizenImportHooks();

  Hooks.on("getSceneControlButtons", (controls: SceneControlsRecord) => {
    if (!game.user?.isGM) return;
    if (!controls || typeof controls !== "object") return;

    const group = controls.tokens ?? controls.token;
    if (!group) return;

    group.tools ??= {};
    if (group.tools["wastelander-scavenging"]) return;

    const order = Object.keys(group.tools).length;
    group.tools["wastelander-scavenging"] = {
      name: "wastelander-scavenging",
      title: t("WASTELANDER.Scavenging.Tooltip"),
      icon: "fa-solid fa-warehouse",
      order,
      button: true,
      visible: true,
      onChange: () => {
        void ScavengerLocationApp.renderOpen();
      },
    };
  });
}
