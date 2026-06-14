import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { registerEncounterSettings } from "../encounters/encounterSettings.js";
import HexcrawlTravelApp from "./HexcrawlTravelApp.js";
import { HEXCRAWL_SCENE_STATE_FLAG, loadHexcrawlSceneState } from "./hexcrawlScenePersist.js";
import { registerHexcrawlSettings } from "./hexcrawlSettings.js";
import { registerHexcrawlTrailOverlay } from "./hexcrawlTrailOverlay.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import { collectMovementHexKeys, validateSingleHexTravelMove } from "./hexCoords.js";
import {
  consumeOvertravelApproval,
  needsOvertravelPrompt,
  promptAndExecuteOvertravelMove,
} from "./overtravelMove.js";
import {
  handleResetTravelMovement,
  processTravelHexEntry,
  shouldConstrainTravelTokenMove,
  validateLostTravelMove,
} from "./hexcrawlTravel.js";

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

type TokenMovementHookPayload = {
  origin?: { x?: number; y?: number; width?: number; height?: number };
  passed?: unknown;
  destination?: { x?: number; y?: number; width?: number; height?: number };
};

function isHexcrawlEnabledOnActiveScene(): boolean {
  const sceneId = getActiveSceneId();
  if (!sceneId) return false;
  const state = loadHexcrawlSceneState(sceneId);
  return Boolean(state?.enabled);
}

function blockTravelTokenMove(
  doc: TokenDocument,
  movement: TokenMovementHookPayload,
): boolean | void {
  const sceneId = doc.parent?.id;
  if (!sceneId || !shouldConstrainTravelTokenMove(sceneId, doc.id)) return;

  const lostValidation = validateLostTravelMove(sceneId, doc, movement);
  if (!lostValidation.allowed) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.LostCannotLeave"));
    return false;
  }

  const validation = validateSingleHexTravelMove(doc, movement);
  if (!validation.allowed) {
    const message =
      validation.reason === "not-adjacent"
        ? t("WASTELANDER.Hexcrawl.Notify.OneHexNotAdjacent")
        : t("WASTELANDER.Hexcrawl.Notify.OneHexOnly");
    ui.notifications.warn(message);
    return false;
  }

  const state = loadHexcrawlSceneState(sceneId);
  if (!state || !needsOvertravelPrompt(state)) return;

  const hexKeys = collectMovementHexKeys(doc, movement);
  if (!hexKeys.length) return;
  const destHex = hexKeys[hexKeys.length - 1];
  if (state.lastHexKey === destHex) return;

  if (consumeOvertravelApproval(sceneId, doc.id, destHex)) return;

  void promptAndExecuteOvertravelMove(doc, movement);
  return false;
}

async function handleTokenHexTravel(
  doc: TokenDocument,
  movement: TokenMovementHookPayload,
): Promise<void> {
  if (!currentUserIsOverseer()) return;
  const sceneId = doc.parent?.id;
  if (!sceneId) return;

  try {
    if (await handleResetTravelMovement(sceneId, doc, movement)) return;

    const hexKeys = collectMovementHexKeys(doc, movement);
    if (!hexKeys.length) return;

    for (const hexKey of hexKeys) {
      await processTravelHexEntry({
        sceneId,
        tokenId: doc.id,
        hexKey,
      });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | hexcrawl token move failed`, error);
  }
}

export function registerHexcrawlHooks(): void {
  registerHexcrawlSettings();
  registerEncounterSettings();
  registerHexcrawlTrailOverlay();

  Hooks.on("getSceneControlButtons", (controls: SceneControlsRecord) => {
    if (!controls || typeof controls !== "object") return;

    const isOverseer = currentUserIsOverseer();
    if (!isOverseer && !isHexcrawlEnabledOnActiveScene()) return;

    const group = controls.tokens ?? controls.token;
    if (!group) return;

    registerSceneControlTool(group, {
      name: "wastelander-hexcrawl",
      title: isOverseer
        ? t("WASTELANDER.Hexcrawl.Tooltip")
        : t("WASTELANDER.Hexcrawl.PlayerParty.Tooltip"),
      icon: "fa-solid fa-map",
      button: true,
      visible: true,
      onClick: () => {
        void HexcrawlTravelApp.renderOpen();
      },
      onChange: () => {
        void HexcrawlTravelApp.renderOpen();
      },
    });
  });

  Hooks.on("activateScene", (scene: { id?: string }) => {
    const sceneId = scene?.id;
    if (sceneId) HexcrawlTravelApp.rebindForScene(sceneId);
  });

  Hooks.on("updateScene", (doc: { id?: string }, changed: { flags?: Record<string, unknown> }) => {
    const sceneId = doc?.id;
    if (!sceneId) return;
    const flag = changed.flags?.[MODULE_ID] as Record<string, unknown> | undefined;
    if (!flag || !(HEXCRAWL_SCENE_STATE_FLAG in flag)) return;
    HexcrawlTravelApp.rebindForScene(sceneId);
  });

  Hooks.on("preMoveToken", blockTravelTokenMove);

  // Foundry v13: token drags use the movement workflow (moveToken), not reliable x/y on updateToken.
  Hooks.on("moveToken", handleTokenHexTravel);
}
