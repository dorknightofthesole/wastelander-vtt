import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  handlePlayerSearchSocket,
  isPlayerSearchSocketRequest,
} from "./playerSearchActions.js";
import ScavengerLocationApp from "./ScavengerLocationApp.js";
import ScavengerSearchApp from "./ScavengerSearchApp.js";
import { registerDenizenImportHooks } from "./registerDenizenImportHooks.js";
import { registerSearchRollChatSyncHooks } from "./searchRollChatSync.js";
import { SCENE_PLAYER_SEARCH_FLAG, SCENE_STATE_FLAG } from "./scenePersist.js";
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

function registerSceneControlTool(
  group: SceneControlGroup,
  tool: SceneControlTool,
): void {
  group.tools ??= {};
  if (group.tools[tool.name]) return;
  const order = Object.keys(group.tools).length;
  group.tools[tool.name] = { ...tool, order: tool.order ?? order };
}

export function registerScavengingHooks(): void {
  registerScavengingSettings();
  registerDenizenImportHooks();
  registerSearchRollChatSyncHooks();

  Hooks.once("ready", () => {
    const channel = `module.${MODULE_ID}`;
    const socket = game as {
      socket?: {
        register?: (ch: string, fn: (data: unknown, userId: string) => void) => void;
        on?: (ch: string, fn: (data: unknown) => void) => void;
      };
    };
    const handler = (data: unknown, _userId: string): void => {
      if (!game.user?.isGM) return;
      if (isPlayerSearchSocketRequest(data as Parameters<typeof isPlayerSearchSocketRequest>[0])) {
        void handlePlayerSearchSocket(
          data as Parameters<typeof handlePlayerSearchSocket>[0],
        );
      }
    };
    if (socket.socket?.register) {
      socket.socket.register(channel, handler);
    }
    socket.socket?.on(channel, (data: unknown) => handler(data, ""));
  });

  Hooks.on("getSceneControlButtons", (controls: SceneControlsRecord) => {
    if (!controls || typeof controls !== "object") return;

    const group = controls.tokens ?? controls.token;
    if (!group) return;

    if (game.user?.isGM) {
      registerSceneControlTool(group, {
        name: "wastelander-scavenging",
        title: t("WASTELANDER.Scavenging.Tooltip"),
        icon: "fa-solid fa-warehouse",
        button: true,
        visible: true,
        onChange: () => {
          void ScavengerLocationApp.renderOpen();
        },
      });
    }

    registerSceneControlTool(group, {
      name: "wastelander-scavenge",
      title: t("WASTELANDER.Scavenging.PlayerSearch.Tooltip"),
      icon: "fa-solid fa-magnifying-glass",
      button: true,
      visible: true,
      onChange: () => {
        void ScavengerSearchApp.renderOpen();
      },
    });
  });

  Hooks.on("activateScene", (scene: { id?: string }) => {
    const sceneId = scene?.id;
    if (!sceneId) return;
    void ScavengerLocationApp.onActivateScene(sceneId);
    void ScavengerSearchApp.onActivateScene(sceneId);
  });

  Hooks.on("updateScene", (doc: { id?: string }, changes: { flags?: Record<string, unknown> }) => {
    const sceneId = doc?.id;
    if (!sceneId) return;
    const wastelanderFlags = changes.flags?.[MODULE_ID] as
      | Record<string, unknown>
      | undefined;
    if (
      wastelanderFlags &&
      (SCENE_STATE_FLAG in wastelanderFlags ||
        SCENE_PLAYER_SEARCH_FLAG in wastelanderFlags)
    ) {
      ScavengerSearchApp.onSceneUpdated(sceneId);
      void ScavengerLocationApp.onActivateScene(sceneId);
    }
  });
}
