import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { registerEncounterSettings } from "../encounters/encounterSettings.js";
import HexcrawlTravelApp from "./HexcrawlTravelApp.js";
import {
  HEXCRAWL_HEX_MAP_FLAG,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  removeHexCoversOnEntry,
} from "./hexcrawlScenePersist.js";
import { registerHexcrawlSettings } from "./hexcrawlSettings.js";
import { registerHexcrawlTrailOverlay } from "./hexcrawlTrailOverlay.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import {
  collectMovementHexKeys,
  resolveEnteredHexKeys,
  validateSingleHexTravelMove,
} from "./hexCoords.js";
import {
  consumeOvertravelApproval,
  needsOvertravelPrompt,
  promptAndExecuteOvertravelMove,
} from "./overtravelMove.js";
import {
  detectBorderCrossIntent,
  executeSceneCrossing,
  isSceneCrossingInProgress,
  markSceneCrossingInProgress,
  readSceneBackgroundBoundsForScene,
  unmarkSceneCrossingInProgress,
} from "./sceneBorderTravel.js";
import { debugHexCover } from "./hexCoverDebug.js";
import {
  handleResetTravelMovement,
  processTravelHexEntry,
  resolveTravelTokenId,
  shouldConstrainTravelTokenMove,
  tokenQualifiesForHexEntry,
  validateLostTravelMove,
} from "./hexcrawlTravel.js";

async function maybeRemoveHexCoverOnTokenMove(
  sceneId: string,
  doc: TokenDocument,
  movement: TokenMovementHookPayload,
): Promise<void> {
  debugHexCover("maybeRemoveHexCover: start", {
    sceneId,
    tokenId: doc.id,
    docX: doc.x,
    docY: doc.y,
  });

  const state = loadHexcrawlSceneState(sceneId);
  if (!state) {
    debugHexCover("maybeRemoveHexCover: skip — no hexcrawl scene state", { sceneId });
    return;
  }

  const travelTokenId = resolveTravelTokenId(sceneId, state);
  const qualifies = tokenQualifiesForHexEntry(sceneId, state, doc.id);
  if (!qualifies) {
    debugHexCover("maybeRemoveHexCover: skip — token does not qualify", {
      sceneId,
      tokenId: doc.id,
      travelTokenId,
      configuredTravelTokenId: state.travelTokenId,
      navigatorActorId: state.navigatorActorId,
    });
    return;
  }

  const hexKeys = resolveEnteredHexKeys(doc, movement);
  if (!hexKeys.length) {
    debugHexCover("maybeRemoveHexCover: skip — could not resolve any hex keys", {
      sceneId,
      tokenId: doc.id,
      movementOrigin: movement.origin,
      movementDestination: movement.destination,
      movementPassed: movement.passed,
    });
    return;
  }

  debugHexCover("maybeRemoveHexCover: trying hex keys", { sceneId, hexKeys });
  const removed = await removeHexCoversOnEntry(sceneId, hexKeys);
  debugHexCover("maybeRemoveHexCover: removeHexCoversOnEntry result", {
    sceneId,
    hexKeys,
    removed,
  });
}

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

  const state = loadHexcrawlSceneState(sceneId);
  const bounds = state?.enabled ? readSceneBackgroundBoundsForScene(sceneId) : null;
  const borderCross =
    state && bounds ? detectBorderCrossIntent(state, doc, movement, bounds, sceneId) : null;

  if (!borderCross) {
    const validation = validateSingleHexTravelMove(doc, movement);
    if (!validation.allowed) {
      const message =
        validation.reason === "not-adjacent"
          ? t("WASTELANDER.Hexcrawl.Notify.OneHexNotAdjacent")
          : t("WASTELANDER.Hexcrawl.Notify.OneHexOnly");
      ui.notifications.warn(message);
      return false;
    }
  }

  if (!state || !needsOvertravelPrompt(state)) return;

  const hexKey = borderCross?.exitHexKey ?? collectMovementHexKeys(doc, movement).at(-1);
  if (!hexKey) return;
  if (state.lastHexKey === hexKey) return;

  if (consumeOvertravelApproval(sceneId, doc.id, hexKey)) return;

  void promptAndExecuteOvertravelMove(doc, movement);
  return false;
}

async function handleTokenHexTravel(
  doc: TokenDocument,
  movement: TokenMovementHookPayload,
): Promise<void> {
  if (!currentUserIsOverseer()) {
    debugHexCover("moveToken: skip — not overseer", { tokenId: doc.id });
    return;
  }
  const sceneId = doc.parent?.id;
  if (!sceneId) {
    debugHexCover("moveToken: skip — token has no parent scene", { tokenId: doc.id });
    return;
  }
  if (isSceneCrossingInProgress(sceneId)) {
    debugHexCover("moveToken: skip — scene crossing in progress", { sceneId, tokenId: doc.id });
    return;
  }

  debugHexCover("moveToken: handling travel", { sceneId, tokenId: doc.id });

  try {
    await maybeRemoveHexCoverOnTokenMove(sceneId, doc, movement);

    if (await handleResetTravelMovement(sceneId, doc, movement)) {
      debugHexCover("moveToken: skip travel — reset movement consumed hook", {
        sceneId,
        tokenId: doc.id,
      });
      return;
    }

    const state = loadHexcrawlSceneState(sceneId);
    const bounds = state?.enabled ? readSceneBackgroundBoundsForScene(sceneId) : null;
    const borderCross =
      state && bounds ? detectBorderCrossIntent(state, doc, movement, bounds, sceneId) : null;

    if (borderCross) {
      markSceneCrossingInProgress(sceneId);
      try {
        const freshState = loadHexcrawlSceneState(sceneId);
        if (freshState && freshState.lastHexKey !== borderCross.exitHexKey) {
          await processTravelHexEntry({
            sceneId,
            tokenId: doc.id,
            hexKey: borderCross.exitHexKey,
          });
        }
        await executeSceneCrossing({
          sourceSceneId: sceneId,
          direction: borderCross.direction,
          targetSceneId: borderCross.targetSceneId,
          exitHexKey: borderCross.exitHexKey,
          sourceTokenDoc: doc,
        });
      } finally {
        unmarkSceneCrossingInProgress(sceneId);
      }
      return;
    }

    const hexKeys = collectMovementHexKeys(doc, movement);
    const keysToProcess =
      hexKeys.length > 0 ? hexKeys : resolveEnteredHexKeys(doc, movement);
    if (!keysToProcess.length) {
      debugHexCover("moveToken: skip travel — no hex keys for journey", {
        sceneId,
        tokenId: doc.id,
        collectMovementHexKeys: hexKeys,
      });
      return;
    }

    for (const hexKey of keysToProcess) {
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
    if (
      !flag ||
      (!(HEXCRAWL_SCENE_STATE_FLAG in flag) && !(HEXCRAWL_HEX_MAP_FLAG in flag))
    ) {
      return;
    }
    const forceHexMapReload = HEXCRAWL_HEX_MAP_FLAG in flag;
    HexcrawlTravelApp.rebindForScene(sceneId, forceHexMapReload ? { force: true } : undefined);
  });

  Hooks.on("preMoveToken", blockTravelTokenMove);

  // Foundry v13: token drags use the movement workflow (moveToken), not reliable x/y on updateToken.
  Hooks.on("moveToken", handleTokenHexTravel);
}
