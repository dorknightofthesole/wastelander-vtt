import { t } from "../integrations/i18n.js";
import { getUndiscoveredPoiAlpha } from "./hexcrawlSettings.js";
import {
  appendJourneyLog,
  loadHexcrawlSceneState,
  type HexcrawlSceneState,
  type SceneCardinal,
  type SceneLinks,
} from "./hexcrawlScenePersist.js";

export type MapDestination = {
  hexKey: string;
  name: string;
};

/** Cached linked-scene destination for Progress when this scene has no local marker. */
export type InheritedProgressDestination = {
  name: string;
  hexKey: string;
  sourceSceneId: string;
  sourceSceneName: string;
};

export type MapDestinationArrival = {
  hexKey: string;
  name: string;
};

export type ResolvedProgressDestination = {
  name: string;
  hexKey: string | null;
  sourceSceneId: string;
  sourceSceneName: string;
  inherited: boolean;
};

const SCENE_CARDINALS: SceneCardinal[] = ["north", "south", "east", "west"];

export function normalizeMapDestination(raw: unknown): MapDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { hexKey?: unknown; name?: unknown };
  if (typeof row.hexKey !== "string" || !row.hexKey.trim()) return null;
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  return { hexKey: row.hexKey.trim(), name: row.name.trim() };
}

export function normalizeInheritedProgressDestination(
  raw: unknown,
): InheritedProgressDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    name?: unknown;
    hexKey?: unknown;
    sourceSceneId?: unknown;
    sourceSceneName?: unknown;
  };
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  if (typeof row.hexKey !== "string" || !row.hexKey.trim()) return null;
  if (typeof row.sourceSceneId !== "string" || !row.sourceSceneId.trim()) return null;
  if (typeof row.sourceSceneName !== "string" || !row.sourceSceneName.trim()) return null;
  return {
    name: row.name.trim(),
    hexKey: row.hexKey.trim(),
    sourceSceneId: row.sourceSceneId.trim(),
    sourceSceneName: row.sourceSceneName.trim(),
  };
}

export function promptForDestinationName(defaultName = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const DialogClass = (globalThis as { Dialog?: typeof Dialog }).Dialog;
    if (!DialogClass) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new DialogClass(
      {
        title: t("WASTELANDER.Hexcrawl.MapDestinationNameTitle"),
        content: `<div class="form-group">
          <label>${t("WASTELANDER.Hexcrawl.MapDestinationNameLabel")}</label>
          <input type="text" name="destinationName" value="${foundry.utils.escapeHTML(defaultName)}" autofocus />
        </div>`,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("Confirm"),
            callback: (html: JQuery) => {
              const value = String(html.find('[name="destinationName"]').val() ?? "").trim();
              finish(value || null);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: () => finish(null),
          },
        },
        default: "ok",
        close: () => finish(null),
      },
      { width: 420 },
    );
    dialog.render(true);
  });
}

export function setMapDestination(
  state: HexcrawlSceneState,
  hexKey: string,
  name: string,
): HexcrawlSceneState {
  const trimmedHex = hexKey.trim();
  const trimmedName = name.trim();
  if (!trimmedHex || !trimmedName) {
    return clearMapDestination(state);
  }

  const unchanged =
    state.mapDestination?.hexKey === trimmedHex &&
    state.mapDestination.name === trimmedName;
  if (unchanged) return state;

  return {
    ...state,
    mapDestination: { hexKey: trimmedHex, name: trimmedName },
    mapDestinationReached:
      state.mapDestination?.hexKey === trimmedHex ? state.mapDestinationReached : false,
    inheritedProgressDestination: null,
  };
}

export function clearMapDestination(state: HexcrawlSceneState): HexcrawlSceneState {
  if (!state.mapDestination && !state.inheritedProgressDestination) return state;
  return {
    ...state,
    mapDestination: null,
    mapDestinationReached: false,
  };
}

export function invalidateInheritedProgressDestination(
  state: HexcrawlSceneState,
): HexcrawlSceneState {
  if (!state.inheritedProgressDestination) return state;
  return { ...state, inheritedProgressDestination: null };
}

export function shouldShowMapDestination(
  state: Pick<HexcrawlSceneState, "mapDestination" | "mapDestinationReached">,
  revealAll: boolean,
): boolean {
  if (!state.mapDestination) return false;
  if (revealAll) return true;
  return state.mapDestinationReached;
}

export function mapDestinationDisplayAlpha(
  state: Pick<HexcrawlSceneState, "mapDestinationReached">,
  revealAll: boolean,
  undiscoveredAlpha?: number,
): number {
  if (!revealAll) return 1;
  if (state.mapDestinationReached) return 1;
  return undiscoveredAlpha ?? getUndiscoveredPoiAlpha();
}

export function discoverMapDestinationOnHexEntry(
  state: HexcrawlSceneState,
  hexKey: string,
): { state: HexcrawlSceneState; arrival: MapDestinationArrival | null } {
  const destination = state.mapDestination;
  if (!destination || destination.hexKey !== hexKey) {
    return { state, arrival: null };
  }
  if (state.mapDestinationReached) {
    return { state, arrival: null };
  }

  const arrival: MapDestinationArrival = {
    hexKey,
    name: destination.name,
  };
  const next = appendJourneyLog(
    {
      ...state,
      mapDestinationReached: true,
    },
    {
      kind: "destinationReached",
      travelDay: state.travelDay,
      hexKey,
      poiLabel: destination.name,
      note: destination.name,
    },
  );
  return { state: next, arrival };
}

function sceneNameForId(sceneId: string): string {
  const scene = (game as { scenes?: { get: (id: string) => { name?: string } | undefined } })
    .scenes?.get(sceneId);
  return scene?.name ?? sceneId;
}

function sceneStillLinked(state: HexcrawlSceneState, sourceSceneId: string): boolean {
  return Object.values(state.sceneLinks).some((linkedId) => linkedId === sourceSceneId);
}

export function inheritedProgressDestinationStillValid(
  state: HexcrawlSceneState,
  cache: InheritedProgressDestination,
): boolean {
  if (!sceneStillLinked(state, cache.sourceSceneId)) return false;
  const source = loadHexcrawlSceneState(cache.sourceSceneId);
  if (!source?.mapDestination?.name) return false;
  return (
    source.mapDestination.name === cache.name &&
    source.mapDestination.hexKey === cache.hexKey
  );
}

function inheritedCacheFromResolved(
  resolved: ResolvedProgressDestination,
): InheritedProgressDestination {
  return {
    name: resolved.name,
    hexKey: resolved.hexKey ?? "",
    sourceSceneId: resolved.sourceSceneId,
    sourceSceneName: resolved.sourceSceneName,
  };
}

function resolveLinkedMapDestination(
  sceneLinks: SceneLinks,
): ResolvedProgressDestination | null {
  for (const direction of SCENE_CARDINALS) {
    const linkedSceneId = sceneLinks[direction];
    if (!linkedSceneId) continue;
    const linkedState = loadHexcrawlSceneState(linkedSceneId);
    if (!linkedState?.mapDestination?.name) continue;
    return {
      name: linkedState.mapDestination.name,
      hexKey: linkedState.mapDestination.hexKey,
      sourceSceneId: linkedSceneId,
      sourceSceneName: sceneNameForId(linkedSceneId),
      inherited: true,
    };
  }
  return null;
}

/** Persist linked-scene destination locally so Progress does not re-scan every open. */
export function ensureInheritedProgressDestinationCached(
  state: HexcrawlSceneState,
): { state: HexcrawlSceneState; changed: boolean } {
  if (state.mapDestination?.name) {
    if (!state.inheritedProgressDestination) return { state, changed: false };
    return {
      state: { ...state, inheritedProgressDestination: null },
      changed: true,
    };
  }

  const cache = state.inheritedProgressDestination;
  if (cache && inheritedProgressDestinationStillValid(state, cache)) {
    const refreshedName = sceneNameForId(cache.sourceSceneId);
    if (refreshedName === cache.sourceSceneName) return { state, changed: false };
    return {
      state: {
        ...state,
        inheritedProgressDestination: { ...cache, sourceSceneName: refreshedName },
      },
      changed: true,
    };
  }

  const resolved = resolveLinkedMapDestination(state.sceneLinks);
  if (!resolved) {
    if (!cache) return { state, changed: false };
    return { state: { ...state, inheritedProgressDestination: null }, changed: true };
  }

  const nextCache = inheritedCacheFromResolved(resolved);
  if (
    cache &&
    cache.name === nextCache.name &&
    cache.hexKey === nextCache.hexKey &&
    cache.sourceSceneId === nextCache.sourceSceneId &&
    cache.sourceSceneName === nextCache.sourceSceneName
  ) {
    return { state, changed: false };
  }

  return {
    state: { ...state, inheritedProgressDestination: nextCache },
    changed: true,
  };
}

/** Destination label for Progress — local scene first, then cached or linked overworld scenes. */
export function resolveProgressDestination(
  sceneId: string,
  state: HexcrawlSceneState,
): ResolvedProgressDestination | null {
  if (state.mapDestination?.name) {
    return {
      name: state.mapDestination.name,
      hexKey: state.mapDestination.hexKey,
      sourceSceneId: sceneId,
      sourceSceneName: sceneNameForId(sceneId),
      inherited: false,
    };
  }

  const cache = state.inheritedProgressDestination;
  if (cache && inheritedProgressDestinationStillValid(state, cache)) {
    return {
      name: cache.name,
      hexKey: cache.hexKey,
      sourceSceneId: cache.sourceSceneId,
      sourceSceneName: sceneNameForId(cache.sourceSceneId),
      inherited: true,
    };
  }

  return resolveLinkedMapDestination(state.sceneLinks);
}

export function formatProgressDestinationLabel(
  resolved: ResolvedProgressDestination,
): string {
  const name = resolved.name.trim();
  if (!name) return "";
  if (!resolved.inherited) return name;
  const sceneName = resolved.sourceSceneName.trim();
  return sceneName ? `${name} (${sceneName})` : name;
}

export function progressDestinationDisplayLabel(
  sceneId: string | null,
  state: HexcrawlSceneState,
  notSetLabel: string,
): string {
  if (!sceneId) return notSetLabel;
  const resolved = resolveProgressDestination(sceneId, state);
  if (!resolved?.name?.trim()) return notSetLabel;
  return formatProgressDestinationLabel(resolved) || notSetLabel;
}

export function backfillMapDestinationReached(state: HexcrawlSceneState): HexcrawlSceneState {
  if (!state.mapDestination || state.mapDestinationReached) return state;
  const traveled = new Set([
    ...state.traveledHexKeys,
    ...(state.startingHexKey ? [state.startingHexKey] : []),
    ...(state.lastHexKey ? [state.lastHexKey] : []),
  ]);
  if (!traveled.has(state.mapDestination.hexKey)) return state;
  return { ...state, mapDestinationReached: true };
}
