import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  collectMovementHexKeys,
  findSceneTokenIdForActor,
  getHexKeyFromTokenDocument,
  parseHexKey,
  tokenPositionForHexKeyOnScene,
  type TokenMovementLike,
} from "./hexCoords.js";
import {
  appendJourneyLog,
  defaultHexcrawlState,
  loadHexcrawlSceneState,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
  type SceneCardinal,
  type SceneLinks,
} from "./hexcrawlScenePersist.js";
import { moveTokenToHexKey } from "./hexcrawlTravel.js";

export type ImageBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type BorderCrossIntent = {
  direction: SceneCardinal;
  targetSceneId: string;
  exitHexKey: string;
};

export const OPPOSITE_DIRECTION: Record<SceneCardinal, SceneCardinal> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

type Point = { x: number; y: number };

type TokenDimensions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  getOccupiedGridSpaceOffsets?: (
    data?: Partial<{ x: number; y: number; width: number; height: number }>,
  ) => Array<{ i: number; j: number }>;
  getSize?: (data?: Partial<{ width: number; height: number }>) => {
    width: number;
    height: number;
  };
};

type MovementWaypoint = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type SceneBoundsSource = {
  id: string;
  padding?: number;
  dimensions?: { width?: number; height?: number };
};

type CanvasBackground = {
  getBounds?: () => { x: number; y: number; width: number; height: number };
};

type CanvasGrid = {
  size?: number;
  sizeX?: number;
  sizeY?: number;
  getCenterPoint?: (coords: { i: number; j: number }) => { x: number; y: number };
};

const crossingInProgressScenes = new Set<string>();

export function isSceneCrossingInProgress(sceneId: string): boolean {
  return crossingInProgressScenes.has(sceneId);
}

export function markSceneCrossingInProgress(sceneId: string): void {
  crossingInProgressScenes.add(sceneId);
}

export function unmarkSceneCrossingInProgress(sceneId: string): void {
  crossingInProgressScenes.delete(sceneId);
}

function tokenCenterPixels(
  doc: TokenDimensions,
  position?: MovementWaypoint,
): Point | null {
  const x = position?.x ?? doc.x;
  const y = position?.y ?? doc.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = position?.width ?? doc.width ?? 1;
  const height = position?.height ?? doc.height ?? 1;
  if (typeof doc.getSize === "function") {
    const size = doc.getSize({ width, height });
    return { x: x + size.width / 2, y: y + size.height / 2 };
  }

  const grid = (globalThis as { canvas?: { grid?: CanvasGrid } }).canvas?.grid;
  const cellW = grid?.sizeX ?? grid?.size ?? 100;
  const cellH = grid?.sizeY ?? grid?.size ?? 100;
  return { x: x + (width * cellW) / 2, y: y + (height * cellH) / 2 };
}

export function pointInBounds(point: Point, bounds: ImageBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

export function readSceneBackgroundBounds(scene: SceneBoundsSource): ImageBounds | null {
  const canvas = (globalThis as {
    canvas?: {
      scene?: { id?: string };
      background?: CanvasBackground;
    };
  }).canvas;

  if (canvas?.scene?.id === scene.id && canvas.background?.getBounds) {
    const rect = canvas.background.getBounds();
    if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
      return {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
      };
    }
  }

  const padding = scene.padding ?? 0;
  const width = scene.dimensions?.width;
  const height = scene.dimensions?.height;
  if (!width || !height) return null;

  return {
    left: padding,
    top: padding,
    right: padding + width,
    bottom: padding + height,
  };
}

export function readSceneBackgroundBoundsForScene(sceneId: string): ImageBounds | null {
  const scene = (game as { scenes?: { get: (id: string) => SceneBoundsSource | undefined } })
    .scenes?.get(sceneId);
  if (!scene) return null;
  return readSceneBackgroundBounds(scene);
}

/**
 * Which image edge the destination crosses when leaving the background bounds.
 * Corners resolve by dominant movement axis.
 */
export function detectBorderDirection(
  origin: Point,
  destination: Point,
  bounds: ImageBounds,
): SceneCardinal | null {
  if (!pointInBounds(origin, bounds)) return null;
  if (pointInBounds(destination, bounds)) return null;

  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;

  const crossedNorth = destination.y < bounds.top;
  const crossedSouth = destination.y > bounds.bottom;
  const crossedWest = destination.x < bounds.left;
  const crossedEast = destination.x > bounds.right;

  const count = [crossedNorth, crossedSouth, crossedWest, crossedEast].filter(Boolean).length;
  if (count === 0) return null;
  if (count === 1) {
    if (crossedNorth) return "north";
    if (crossedSouth) return "south";
    if (crossedWest) return "west";
    return "east";
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "east" : "west";
  }
  return dy >= 0 ? "south" : "north";
}

function hexKeyInsideBounds(
  doc: TokenDimensions,
  hexKey: string,
  bounds: ImageBounds,
): boolean {
  const center = hexCenterForKey(hexKey);
  if (!center) return false;
  return pointInBounds(center, bounds);
}

export function resolveExitHexKey(
  doc: TokenDimensions,
  movement: TokenMovementLike,
  bounds: ImageBounds,
): string | null {
  const pathKeys = collectMovementHexKeys(doc, movement);
  const inBounds = pathKeys.filter((key) => hexKeyInsideBounds(doc, key, bounds));
  if (inBounds.length > 0) return inBounds[inBounds.length - 1] ?? null;

  const originKey = movement.origin
    ? getHexKeyFromTokenDocument(doc, movement.origin)
    : getHexKeyFromTokenDocument(doc);
  if (originKey && hexKeyInsideBounds(doc, originKey, bounds)) return originKey;

  return pathKeys[0] ?? originKey;
}

function gridTolerance(grid?: CanvasGrid | null): number {
  return grid?.sizeY ?? grid?.size ?? 100;
}

export function enumerateBorderHexKeys(
  bounds: ImageBounds,
  direction: SceneCardinal,
  hexCenterAt: (hexKey: string) => Point | null,
  options?: { scanMin?: number; scanMax?: number; tolerance?: number },
): string[] {
  const tolerance = options?.tolerance ?? 100;
  const min = options?.scanMin ?? -80;
  const max = options?.scanMax ?? 80;
  const keys: string[] = [];

  for (let i = min; i <= max; i += 1) {
    for (let j = min; j <= max; j += 1) {
      const hexKey = `${i},${j}`;
      const center = hexCenterAt(hexKey);
      if (!center || !pointInBounds(center, bounds)) continue;

      const onBorder =
        direction === "north"
          ? center.y <= bounds.top + tolerance
          : direction === "south"
            ? center.y >= bounds.bottom - tolerance
            : direction === "west"
              ? center.x <= bounds.left + tolerance
              : center.x >= bounds.right - tolerance;

      if (onBorder) keys.push(hexKey);
    }
  }

  return keys;
}

export function mapEntryHexKey(
  exitHexKey: string,
  exitDirection: SceneCardinal,
  targetBounds: ImageBounds,
  hexCenterAt: (hexKey: string) => Point | null,
  options?: { scanMin?: number; scanMax?: number; tolerance?: number },
): string | null {
  const exitCenter = hexCenterAt(exitHexKey);
  if (!exitCenter) return null;

  const entryDirection = OPPOSITE_DIRECTION[exitDirection];
  const borderHexes = enumerateBorderHexKeys(
    targetBounds,
    entryDirection,
    hexCenterAt,
    options,
  );
  if (!borderHexes.length) return null;

  let bestKey: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hexKey of borderHexes) {
    const center = hexCenterAt(hexKey);
    if (!center) continue;
    const lateral =
      exitDirection === "north" || exitDirection === "south"
        ? Math.abs(center.x - exitCenter.x)
        : Math.abs(center.y - exitCenter.y);
    if (lateral < bestDistance) {
      bestDistance = lateral;
      bestKey = hexKey;
    }
  }

  return bestKey;
}

export function detectBorderCrossIntent(
  state: Pick<HexcrawlSceneState, "sceneLinks">,
  doc: TokenDimensions,
  movement: TokenMovementLike,
  bounds: ImageBounds,
): BorderCrossIntent | null {
  const origin = tokenCenterPixels(doc, movement.origin) ?? tokenCenterPixels(doc);
  const destination = movement.destination
    ? tokenCenterPixels(doc, movement.destination)
    : null;
  if (!origin || !destination) return null;

  const direction = detectBorderDirection(origin, destination, bounds);
  if (!direction) return null;

  const targetSceneId = state.sceneLinks[direction];
  if (!targetSceneId) return null;

  const exitHexKey = resolveExitHexKey(doc, movement, bounds);
  if (!exitHexKey) return null;

  return { direction, targetSceneId, exitHexKey };
}

export function buildCrossedSceneState(params: {
  source: HexcrawlSceneState;
  targetSceneId: string;
  entryHexKey: string;
  targetTokenId: string;
  targetExisting: HexcrawlSceneState | null;
  fromSceneId: string;
  direction: SceneCardinal;
}): HexcrawlSceneState {
  const targetBase =
    params.targetExisting ?? defaultHexcrawlState(params.targetSceneId);
  const crossedNote = `${params.fromSceneId} → ${params.targetSceneId} (${params.direction})`;

  let next: HexcrawlSceneState = {
    ...params.source,
    sceneId: params.targetSceneId,
    travelTokenId: params.targetTokenId,
    lastHexKey: params.entryHexKey,
    traveledHexKeys: [params.entryHexKey],
    trailCleared: false,
    resetTravelPending: null,
    sceneLinks: targetBase.sceneLinks,
    startingHexKey: targetBase.startingHexKey ?? params.entryHexKey,
  };

  next = appendJourneyLog(next, {
    kind: "sceneCrossed",
    travelDay: next.travelDay,
    hexKey: params.entryHexKey,
    note: crossedNote,
  });

  return next;
}

function hexCenterForKey(hexKey: string): Point | null {
  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const canvas = (globalThis as { canvas?: { grid?: CanvasGrid } }).canvas;
  if (canvas?.grid?.getCenterPoint) {
    const center = canvas.grid.getCenterPoint(offset);
    if (Number.isFinite(center.x) && Number.isFinite(center.y)) {
      return center;
    }
  }

  const grid = canvas?.grid;
  const sizeX = grid?.sizeX ?? grid?.size ?? 100;
  const sizeY = grid?.sizeY ?? grid?.size ?? 100;
  return {
    x: offset.i * sizeX + sizeX / 2,
    y: offset.j * sizeY + sizeY / 2,
  };
}

function hexCenterForScene(sceneId: string, hexKey: string): Point | null {
  const canvas = (globalThis as { canvas?: { scene?: { id?: string }; grid?: CanvasGrid } })
    .canvas;
  if (canvas?.scene?.id === sceneId) {
    return hexCenterForKey(hexKey);
  }

  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const scene = (game as { scenes?: { get: (id: string) => SceneBoundsSource | undefined } })
    .scenes?.get(sceneId);
  if (!scene) return null;

  const padding = scene.padding ?? 0;
  const grid = (scene as { grid?: { size?: number; sizeX?: number; sizeY?: number } }).grid;
  const sizeX = grid?.sizeX ?? grid?.size ?? 100;
  const sizeY = grid?.sizeY ?? grid?.size ?? 100;
  return {
    x: padding + offset.i * sizeX + sizeX / 2,
    y: padding + offset.j * sizeY + sizeY / 2,
  };
}

function hexCenterAtForScene(sceneId: string): (hexKey: string) => Point | null {
  return (hexKey) => hexCenterForScene(sceneId, hexKey);
}

type SourceTokenDoc = TokenDimensions & {
  id: string;
  actorId?: string | null;
  disposition?: number;
  elevation?: number;
};

async function ensureNavigatorTokenOnScene(
  targetSceneId: string,
  navigatorActorId: string,
  sourceTokenDoc: SourceTokenDoc,
  entryHexKey: string,
): Promise<string | null> {
  const existing = findSceneTokenIdForActor(targetSceneId, navigatorActorId);
  if (existing) return existing;

  const position = tokenPositionForHexKeyOnScene(targetSceneId, entryHexKey);
  if (!position) return null;

  const scene = (game as {
    scenes?: {
      get: (id: string) => {
        createEmbeddedDocuments?: (
          type: string,
          data: Record<string, unknown>[],
        ) => Promise<Array<{ id: string }>>;
      } | undefined;
    };
  }).scenes?.get(targetSceneId);

  if (!scene?.createEmbeddedDocuments) return null;

  const created = await scene.createEmbeddedDocuments("Token", [
    {
      actorId: navigatorActorId,
      x: position.x,
      y: position.y,
      width: sourceTokenDoc.width ?? 1,
      height: sourceTokenDoc.height ?? 1,
      disposition: sourceTokenDoc.disposition ?? 1,
      elevation: sourceTokenDoc.elevation ?? 0,
    },
  ]);

  return created[0]?.id ?? null;
}

export async function executeSceneCrossing(params: {
  sourceSceneId: string;
  direction: SceneCardinal;
  targetSceneId: string;
  exitHexKey: string;
  sourceTokenDoc: SourceTokenDoc;
}): Promise<boolean> {
  const sourceState = loadHexcrawlSceneState(params.sourceSceneId);
  if (!sourceState?.enabled || sourceState.arrived) return false;
  if (!sourceState.navigatorActorId) return false;

  const targetScene = (game as {
    scenes?: {
      get: (id: string) => (SceneBoundsSource & { activate?: () => Promise<unknown> }) | undefined;
    };
  }).scenes?.get(params.targetSceneId);
  if (!targetScene) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkMissing"));
    return false;
  }

  const targetBounds = readSceneBackgroundBounds(targetScene);
  if (!targetBounds) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkBounds"));
    return false;
  }

  const tolerance = gridTolerance(
    (globalThis as { canvas?: { grid?: CanvasGrid } }).canvas?.grid,
  );
  const entryHexKey = mapEntryHexKey(
    params.exitHexKey,
    params.direction,
    targetBounds,
    hexCenterAtForScene(params.targetSceneId),
    { tolerance },
  );

  if (!entryHexKey) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkEntryHex"));
    return false;
  }

  const targetTokenId = await ensureNavigatorTokenOnScene(
    params.targetSceneId,
    sourceState.navigatorActorId,
    params.sourceTokenDoc,
    entryHexKey,
  );
  if (!targetTokenId) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkToken"));
    return false;
  }

  const targetExisting = loadHexcrawlSceneState(params.targetSceneId);
  const crossedState = buildCrossedSceneState({
    source: sourceState,
    targetSceneId: params.targetSceneId,
    entryHexKey,
    targetTokenId,
    targetExisting,
    fromSceneId: params.sourceSceneId,
    direction: params.direction,
  });

  await saveHexcrawlSceneState(crossedState);
  await moveTokenToHexKey(params.targetSceneId, targetTokenId, entryHexKey);
  await moveTokenToHexKey(
    params.sourceSceneId,
    params.sourceTokenDoc.id,
    params.exitHexKey,
  );

  if (typeof targetScene.activate === "function") {
    await targetScene.activate();
  }

  ui.notifications.info(
    t("WASTELANDER.Hexcrawl.Notify.SceneCrossed", {
      scene: (targetScene as { name?: string }).name ?? params.targetSceneId,
      hex: entryHexKey,
    }),
  );

  console.info(
    `${MODULE_ID} | scene border cross ${params.sourceSceneId} ${params.direction} → ${params.targetSceneId} @ ${entryHexKey}`,
  );

  return true;
}

export function normalizeSceneLinkValue(value: string, currentSceneId: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === currentSceneId) return undefined;
  return trimmed;
}

export function applySceneLinkUpdate(
  links: SceneLinks,
  field: string,
  value: string,
  currentSceneId: string,
): SceneLinks {
  const direction = field.replace("sceneLinks.", "") as SceneCardinal;
  const next = { ...links };
  const normalized = normalizeSceneLinkValue(value, currentSceneId);
  if (normalized) {
    next[direction] = normalized;
  } else {
    delete next[direction];
  }
  return next;
}
