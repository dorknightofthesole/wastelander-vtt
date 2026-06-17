import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  collectMovementHexKeys,
  findSceneTokenIdsForActor,
  getHexKeyFromTokenDocument,
  parseHexKey,
  resolveMovementDestinationWaypoint,
  resolveMovementOriginWaypoint,
  snapCanvasPointToHex,
  tokenPositionForHexKeyOnScene,
  type HexSnapResult,
  type TokenMovementLike,
} from "./hexCoords.js";
import { applyHexEntryFogEffects } from "./hexAnnotations.js";
import {
  appendJourneyLog,
  appendTraveledHexKey,
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

type SceneBackgroundSource = {
  id: string;
  width?: number;
  height?: number;
  padding?: number;
  dimensions?: { width?: number; height?: number };
  background?: { x?: number; y?: number; width?: number; height?: number } | null;
  getDimensions?: () => {
    sceneX: number;
    sceneY: number;
    sceneWidth: number;
    sceneHeight: number;
    sceneRect?: { x: number; y: number; width: number; height: number };
  };
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
const warnedMissingBoundsScenes = new Set<string>();

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
  position?: { x?: number; y?: number; width?: number; height?: number },
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

function rectToBounds(rect: { x: number; y: number; width: number; height: number }): ImageBounds {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

export function pointInBounds(point: Point, bounds: ImageBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

/**
 * Pixel bounds of the scene background image (not the padded canvas / full grid).
 */
export function readSceneBackgroundBounds(scene: SceneBackgroundSource): ImageBounds | null {
  const canvas = (globalThis as {
    canvas?: {
      scene?: { id?: string };
      background?: CanvasBackground;
    };
  }).canvas;

  if (canvas?.scene?.id === scene.id && canvas.background?.getBounds) {
    const rect = canvas.background.getBounds();
    if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0) {
      return rectToBounds(rect);
    }
  }

  if (typeof scene.getDimensions === "function") {
    try {
      const dims = scene.getDimensions();
      const sceneRect = dims.sceneRect ?? {
        x: dims.sceneX,
        y: dims.sceneY,
        width: dims.sceneWidth,
        height: dims.sceneHeight,
      };
      if (sceneRect.width > 0 && sceneRect.height > 0) {
        return rectToBounds(sceneRect);
      }
    } catch {
      // Fall through to other sources.
    }
  }

  const bg = scene.background;
  if (bg && typeof bg === "object") {
    const width = bg.width;
    const height = bg.height;
    if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
      const x = typeof bg.x === "number" ? bg.x : 0;
      const y = typeof bg.y === "number" ? bg.y : 0;
      return rectToBounds({ x, y, width, height });
    }
  }

  const width = scene.width ?? scene.dimensions?.width;
  const height = scene.height ?? scene.dimensions?.height;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    return { left: 0, top: 0, right: width, bottom: height };
  }

  return null;
}

export function readSceneBackgroundBoundsForScene(sceneId: string): ImageBounds | null {
  const scene = (game as { scenes?: { get: (id: string) => SceneBackgroundSource | undefined } })
    .scenes?.get(sceneId);
  if (!scene) return null;

  const bounds = readSceneBackgroundBounds(scene);
  if (!bounds && !warnedMissingBoundsScenes.has(sceneId)) {
    warnedMissingBoundsScenes.add(sceneId);
    console.warn(
      `${MODULE_ID} | could not resolve background bounds for scene ${sceneId}; border travel disabled until the scene is viewed or dimensions are available`,
    );
  }
  return bounds;
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

function detectMovementCardinal(from: Point, to: Point): SceneCardinal | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function isNearBorder(
  point: Point,
  bounds: ImageBounds,
  direction: SceneCardinal,
  tolerance: number,
): boolean {
  switch (direction) {
    case "north":
      return point.y <= bounds.top + tolerance;
    case "south":
      return point.y >= bounds.bottom - tolerance;
    case "west":
      return point.x <= bounds.left + tolerance;
    case "east":
      return point.x >= bounds.right - tolerance;
  }
}

function isFurtherInDirection(
  dest: Point,
  origin: Point,
  direction: SceneCardinal,
): boolean {
  switch (direction) {
    case "north":
      return dest.y < origin.y - 0.5;
    case "south":
      return dest.y > origin.y + 0.5;
    case "west":
      return dest.x < origin.x - 0.5;
    case "east":
      return dest.x > origin.x + 0.5;
  }
}

function detectLinkedBorderStep(
  links: SceneLinks,
  origin: Point,
  dest: Point,
  bounds: ImageBounds,
  tolerance: number,
): SceneCardinal | null {
  const travelDir = detectMovementCardinal(origin, dest);
  if (!travelDir || !links[travelDir]) return null;

  const originInside = pointInBounds(origin, bounds);
  const destOutside = !pointInBounds(dest, bounds);
  const originOnBorder = isNearBorder(origin, bounds, travelDir, tolerance);
  const destFurther = isFurtherInDirection(dest, origin, travelDir);

  if (originInside && destOutside) return travelDir;
  if (originOnBorder && destFurther) return travelDir;
  return null;
}

function hexKeyInsideBounds(hexKey: string, bounds: ImageBounds, sceneId: string): boolean {
  const center = hexCenterForScene(sceneId, hexKey);
  if (!center) return false;
  return pointInBounds(center, bounds);
}

export function resolveExitHexKey(
  doc: TokenDimensions,
  movement: TokenMovementLike,
  bounds: ImageBounds,
  sceneId: string,
): string | null {
  const pathKeys = collectMovementHexKeys(doc, movement);
  const inBounds = pathKeys.filter((key) => hexKeyInsideBounds(key, bounds, sceneId));
  if (inBounds.length > 0) return inBounds[inBounds.length - 1] ?? null;

  const originWaypoint = resolveMovementOriginWaypoint(doc, movement);
  const originKey = originWaypoint
    ? getHexKeyFromTokenDocument(doc, originWaypoint)
    : getHexKeyFromTokenDocument(doc);
  if (originKey && hexKeyInsideBounds(originKey, bounds, sceneId)) return originKey;

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

/** Pixel on the target map edge that matches the source exit position laterally. */
export function mapEntryPoint(
  exitCenter: Point,
  exitDirection: SceneCardinal,
  targetBounds: ImageBounds,
  inset = 1,
): Point {
  const entryDirection = OPPOSITE_DIRECTION[exitDirection];
  switch (entryDirection) {
    case "north":
      return { x: exitCenter.x, y: targetBounds.top + inset };
    case "south":
      return { x: exitCenter.x, y: targetBounds.bottom - inset };
    case "west":
      return { x: targetBounds.left + inset, y: exitCenter.y };
    case "east":
      return { x: targetBounds.right - inset, y: exitCenter.y };
  }
}

/** Map a source-scene exit pixel onto the target scene using background-relative coordinates. */
export function projectExitPixelOntoTarget(
  exitPixel: Point,
  exitDirection: SceneCardinal,
  sourceBounds: ImageBounds,
  targetBounds: ImageBounds,
): Point {
  switch (exitDirection) {
    case "north":
    case "south":
      return {
        x: targetBounds.left + (exitPixel.x - sourceBounds.left),
        y: exitPixel.y,
      };
    case "east":
    case "west":
      return {
        x: exitPixel.x,
        y: targetBounds.top + (exitPixel.y - sourceBounds.top),
      };
  }
}

function mapEntryHexKeyLateral(
  exitCenter: Point,
  exitDirection: SceneCardinal,
  targetBounds: ImageBounds,
  targetHexCenterAt: (hexKey: string) => Point | null,
  options?: { scanMin?: number; scanMax?: number; tolerance?: number },
): string | null {
  const entryDirection = OPPOSITE_DIRECTION[exitDirection];
  const borderHexes = enumerateBorderHexKeys(
    targetBounds,
    entryDirection,
    targetHexCenterAt,
    options,
  );
  if (!borderHexes.length) return null;

  let bestKey: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hexKey of borderHexes) {
    const center = targetHexCenterAt(hexKey);
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

export type SceneEntryPlacement = HexSnapResult & {
  method: "pixel" | "lateral";
};

function placementFromHexKey(
  targetSceneId: string,
  hexKey: string,
  method: SceneEntryPlacement["method"],
): SceneEntryPlacement | null {
  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const grid = (globalThis as {
    canvas?: {
      grid?: {
        getTopLeftPoint?: (coords: { i: number; j: number }) => { x: number; y: number };
      };
    };
  }).canvas?.grid;

  if (grid && typeof grid.getTopLeftPoint === "function") {
    const topLeft = grid.getTopLeftPoint(offset);
    if (Number.isFinite(topLeft.x) && Number.isFinite(topLeft.y)) {
      return { hexKey, x: topLeft.x, y: topLeft.y, method };
    }
  }

  const position = tokenPositionForHexKeyOnScene(targetSceneId, hexKey);
  if (!position) return null;

  return { hexKey, x: position.x, y: position.y, method };
}

async function waitForActiveSceneCanvas(sceneId: string, maxMs = 8000): Promise<boolean> {
  const isReady = (): boolean => {
    const canvas = (globalThis as {
      canvas?: { ready?: boolean; scene?: { id?: string }; grid?: unknown };
    }).canvas;
    return Boolean(canvas?.ready && canvas.scene?.id === sceneId && canvas.grid);
  };

  if (isReady()) return true;

  const HooksApi = (globalThis as {
    Hooks?: {
      on: (event: string, fn: (canvas: { scene?: { id?: string } }) => void) => number;
      off: (event: string, id: number) => void;
    };
  }).Hooks;

  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    let hookId: number | undefined;

    const finish = (ok: boolean) => {
      if (hookId !== undefined) HooksApi?.off("canvasReady", hookId);
      clearInterval(pollId);
      clearTimeout(timeoutId);
      resolve(ok);
    };

    const pollId = setInterval(() => {
      if (isReady()) finish(true);
      else if (Date.now() >= deadline) finish(false);
    }, 50);

    const timeoutId = setTimeout(() => finish(isReady()), maxMs);

    if (HooksApi?.on) {
      hookId = HooksApi.on("canvasReady", (canvas) => {
        if (canvas.scene?.id === sceneId) finish(true);
      });
    }
  });
}

/** Entry hex + snapped token position for a scene border crossing. */
export function resolveSceneEntryPlacement(
  targetSceneId: string,
  exitPixel: Point,
  exitDirection: SceneCardinal,
  targetBounds: ImageBounds,
  targetHexCenterAt: (hexKey: string) => Point | null,
  options?: { scanMin?: number; scanMax?: number; tolerance?: number },
): SceneEntryPlacement | null {
  const tolerance = options?.tolerance ?? 100;
  const entryPoint = mapEntryPoint(
    exitPixel,
    exitDirection,
    targetBounds,
    Math.max(1, tolerance * 0.25),
  );

  const snapped = snapCanvasPointToHex(entryPoint);
  if (snapped) {
    const center = targetHexCenterAt(snapped.hexKey);
    if (center && pointInBounds(center, targetBounds)) {
      return { ...snapped, method: "pixel" };
    }
  }

  const hexKey = mapEntryHexKeyLateral(
    exitPixel,
    exitDirection,
    targetBounds,
    targetHexCenterAt,
    options,
  );
  if (!hexKey) return null;

  return placementFromHexKey(targetSceneId, hexKey, "lateral");
}

export function mapEntryHexKey(
  exitCenter: Point,
  exitDirection: SceneCardinal,
  targetBounds: ImageBounds,
  targetHexCenterAt: (hexKey: string) => Point | null,
  options?: { scanMin?: number; scanMax?: number; tolerance?: number },
): string | null {
  const tolerance = options?.tolerance ?? 100;
  const entryPoint = mapEntryPoint(
    exitCenter,
    exitDirection,
    targetBounds,
    Math.max(1, tolerance * 0.25),
  );
  const snapped = snapCanvasPointToHex(entryPoint);
  if (snapped) {
    const center = targetHexCenterAt(snapped.hexKey);
    if (center && pointInBounds(center, targetBounds)) {
      return snapped.hexKey;
    }
  }

  return mapEntryHexKeyLateral(
    exitCenter,
    exitDirection,
    targetBounds,
    targetHexCenterAt,
    options,
  );
}

export function detectBorderCrossIntent(
  state: Pick<HexcrawlSceneState, "sceneLinks">,
  doc: TokenDimensions,
  movement: TokenMovementLike,
  bounds: ImageBounds,
  sceneId: string,
): BorderCrossIntent | null {
  const hasLinks = Object.values(state.sceneLinks).some(
    (id) => typeof id === "string" && id.length > 0,
  );
  if (!hasLinks) return null;

  const originWaypoint = resolveMovementOriginWaypoint(doc, movement);
  const destWaypoint = resolveMovementDestinationWaypoint(doc, movement);
  if (!originWaypoint || !destWaypoint) return null;

  const originHex = getHexKeyFromTokenDocument(doc, originWaypoint);
  const destHex = getHexKeyFromTokenDocument(doc, destWaypoint);

  const originCenter =
    (originHex ? hexCenterForScene(sceneId, originHex) : null) ??
    tokenCenterPixels(doc, originWaypoint) ??
    tokenCenterPixels(doc);
  const destCenter =
    (destHex ? hexCenterForScene(sceneId, destHex) : null) ??
    tokenCenterPixels(doc, destWaypoint);

  if (!originCenter || !destCenter) return null;

  const tolerance = gridTolerance(
    (globalThis as { canvas?: { grid?: CanvasGrid } }).canvas?.grid,
  );

  let direction =
    detectBorderDirection(originCenter, destCenter, bounds) ??
    detectLinkedBorderStep(state.sceneLinks, originCenter, destCenter, bounds, tolerance);

  if (!direction) return null;

  const targetSceneId = state.sceneLinks[direction];
  if (!targetSceneId) return null;

  const exitHexKey =
    resolveExitHexKey(doc, movement, bounds, sceneId) ??
    (originHex && pointInBounds(originCenter, bounds) ? originHex : null);
  if (!exitHexKey) return null;

  console.debug(
    `${MODULE_ID} | border cross intent ${sceneId} ${direction} exit=${exitHexKey} origin=${originHex} dest=${destHex}`,
  );

  return { direction, targetSceneId, exitHexKey };
}

/** Restore a scene's prior trail when re-entering via border travel, then append the entry hex. */
export function mergeTargetSceneTrail(
  targetExisting: HexcrawlSceneState,
  entryHexKey: string,
): string[] {
  const priorTrail =
    targetExisting.trailCleared && targetExisting.traveledHexKeys.length === 0
      ? []
      : [...targetExisting.traveledHexKeys];
  return appendTraveledHexKey(priorTrail, entryHexKey);
}

export function buildCrossedSceneState(params: {
  source: HexcrawlSceneState;
  targetSceneId: string;
  entryHexKey: string;
  targetTokenId: string;
  targetExisting: HexcrawlSceneState | null;
  fromSceneId: string;
  direction: SceneCardinal;
}): { state: HexcrawlSceneState; destinationArrival: import("./hexMapDestination.js").MapDestinationArrival | null } {
  const targetBase =
    params.targetExisting ?? defaultHexcrawlState(params.targetSceneId);
  const crossedNote = `${params.fromSceneId} → ${params.targetSceneId} (${params.direction})`;

  let next: HexcrawlSceneState = {
    ...params.source,
    sceneId: params.targetSceneId,
    travelTokenId: params.targetTokenId,
    lastHexKey: params.entryHexKey,
    traveledHexKeys: mergeTargetSceneTrail(targetBase, params.entryHexKey),
    trailCleared: false,
    resetTravelPending: null,
    sceneLinks: targetBase.sceneLinks,
    startingHexKey: targetBase.startingHexKey ?? params.entryHexKey,
    terrainType: targetBase.terrainType,
    hexAnnotations: targetBase.hexAnnotations,
    hexCoverBaseline: targetBase.hexCoverBaseline,
    hiddenTrailHexKeys: targetBase.hiddenTrailHexKeys,
    discoveredPoiHexKeys: targetBase.discoveredPoiHexKeys,
    mapDestination: targetBase.mapDestination,
    inheritedProgressDestination: targetBase.inheritedProgressDestination,
    showTerrainIcons: targetBase.showTerrainIcons,
    showHexCoords: targetBase.showHexCoords,
  };
  const fog = applyHexEntryFogEffects(next, params.entryHexKey);
  if (fog.discovered) {
    void import("./poiDiscoveryChat.js").then(({ notifyPoiDiscovered }) =>
      notifyPoiDiscovered(fog.discovered!),
    );
  }
  next = fog.state;

  next = appendJourneyLog(next, {
    kind: "sceneCrossed",
    travelDay: next.travelDay,
    hexKey: params.entryHexKey,
    note: crossedNote,
  });

  return { state: next, destinationArrival: fog.destinationArrival };
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

  const scene = (game as { scenes?: { get: (id: string) => SceneBackgroundSource | undefined } })
    .scenes?.get(sceneId);
  if (!scene) return null;

  let originX = 0;
  let originY = 0;
  if (typeof scene.getDimensions === "function") {
    try {
      const dims = scene.getDimensions();
      const sceneRect = dims.sceneRect ?? {
        x: dims.sceneX,
        y: dims.sceneY,
        width: dims.sceneWidth,
        height: dims.sceneHeight,
      };
      originX = sceneRect.x;
      originY = sceneRect.y;
    } catch {
      // Use 0,0 below.
    }
  }

  const grid = (scene as { grid?: { size?: number; sizeX?: number; sizeY?: number } }).grid;
  const sizeX = grid?.sizeX ?? grid?.size ?? 100;
  const sizeY = grid?.sizeY ?? grid?.size ?? 100;
  return {
    x: originX + offset.i * sizeX + sizeX / 2,
    y: originY + offset.j * sizeY + sizeY / 2,
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
  toObject?: () => Record<string, unknown>;
};

type ActorTokenSource = {
  getTokenDocument?: (data?: Record<string, unknown>) => Promise<{
    toObject?: () => Record<string, unknown>;
  }>;
  prototypeToken?: { toObject?: () => Record<string, unknown> };
};

async function buildNavigatorTokenCreateData(
  navigatorActorId: string,
  sourceTokenDoc: SourceTokenDoc,
  position: Point,
): Promise<Record<string, unknown> | null> {
  const actor = (game as { actors?: { get: (id: string) => ActorTokenSource | undefined } })
    .actors?.get(navigatorActorId);

  if (typeof sourceTokenDoc.toObject === "function") {
    const data = foundry.utils.duplicate(sourceTokenDoc.toObject());
    delete data._id;
    delete data.sceneId;
    delete data.delta;
    return {
      ...data,
      actorId: navigatorActorId,
      actorLink: data.actorLink ?? true,
      x: position.x,
      y: position.y,
    };
  }

  if (typeof actor?.getTokenDocument === "function") {
    const tokenDoc = await actor.getTokenDocument({ x: position.x, y: position.y });
    if (tokenDoc && typeof tokenDoc.toObject === "function") {
      return tokenDoc.toObject();
    }
  }

  const prototype = actor?.prototypeToken?.toObject?.();
  if (prototype) {
    const data = foundry.utils.duplicate(prototype);
    delete data._id;
    return {
      ...data,
      actorId: navigatorActorId,
      actorLink: data.actorLink ?? true,
      x: position.x,
      y: position.y,
    };
  }

  return {
    actorId: navigatorActorId,
    actorLink: true,
    x: position.x,
    y: position.y,
    width: sourceTokenDoc.width ?? 1,
    height: sourceTokenDoc.height ?? 1,
    disposition: sourceTokenDoc.disposition ?? 1,
    elevation: sourceTokenDoc.elevation ?? 0,
  };
}

async function removeNavigatorTokensFromScene(
  targetSceneId: string,
  navigatorActorId: string,
): Promise<void> {
  const tokenIds = findSceneTokenIdsForActor(targetSceneId, navigatorActorId);
  if (!tokenIds.length) return;

  const scene = (game as {
    scenes?: {
      get: (id: string) => {
        deleteEmbeddedDocuments?: (
          type: string,
          ids: string[],
        ) => Promise<unknown[]>;
      } | undefined;
    };
  }).scenes?.get(targetSceneId);

  if (!scene?.deleteEmbeddedDocuments) return;

  await scene.deleteEmbeddedDocuments("Token", tokenIds);
}

async function ensureNavigatorTokenOnScene(
  targetSceneId: string,
  navigatorActorId: string,
  sourceTokenDoc: SourceTokenDoc,
  placement: SceneEntryPlacement,
): Promise<string | null> {
  await removeNavigatorTokensFromScene(targetSceneId, navigatorActorId);

  const tokenData = await buildNavigatorTokenCreateData(
    navigatorActorId,
    sourceTokenDoc,
    { x: placement.x, y: placement.y },
  );
  if (!tokenData) return null;

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

  const created = await scene.createEmbeddedDocuments("Token", [tokenData]);

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
      get: (id: string) => (SceneBackgroundSource & { activate?: () => Promise<unknown> }) | undefined;
    };
  }).scenes?.get(params.targetSceneId);
  if (!targetScene) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkMissing"));
    return false;
  }

  const sourceScene = (game as {
    scenes?: { get: (id: string) => SceneBackgroundSource | undefined };
  }).scenes?.get(params.sourceSceneId);

  const sourceBounds = sourceScene ? readSceneBackgroundBounds(sourceScene) : null;

  const sourceExitPixel =
    hexCenterForScene(params.sourceSceneId, params.exitHexKey) ??
    tokenCenterPixels(params.sourceTokenDoc);
  if (!sourceExitPixel) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkEntryHex"));
    return false;
  }

  await moveTokenToHexKey(
    params.sourceSceneId,
    params.sourceTokenDoc.id,
    params.exitHexKey,
  );

  if (typeof targetScene.activate === "function") {
    await targetScene.activate();
  }

  const canvasReady = await waitForActiveSceneCanvas(params.targetSceneId);
  if (!canvasReady) {
    console.warn(
      `${MODULE_ID} | target scene canvas not ready; entry placement may be approximate`,
    );
  }

  const targetBounds = readSceneBackgroundBounds(targetScene);
  if (!targetBounds) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkBounds"));
    return false;
  }

  const entryExitPixel =
    sourceBounds != null
      ? projectExitPixelOntoTarget(
          sourceExitPixel,
          params.direction,
          sourceBounds,
          targetBounds,
        )
      : sourceExitPixel;

  const tolerance = gridTolerance(
    (globalThis as { canvas?: { grid?: CanvasGrid } }).canvas?.grid,
  );
  const placement = resolveSceneEntryPlacement(
    params.targetSceneId,
    entryExitPixel,
    params.direction,
    targetBounds,
    hexCenterAtForScene(params.targetSceneId),
    { tolerance },
  );

  if (!placement) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkEntryHex"));
    return false;
  }

  console.info(
    `${MODULE_ID} | scene entry ${placement.method} hex=${placement.hexKey} @ ${placement.x},${placement.y} (exit ${sourceExitPixel.x},${sourceExitPixel.y} → ${entryExitPixel.x},${entryExitPixel.y})`,
  );

  const targetTokenId = await ensureNavigatorTokenOnScene(
    params.targetSceneId,
    sourceState.navigatorActorId,
    params.sourceTokenDoc,
    placement,
  );
  if (!targetTokenId) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.SceneLinkToken"));
    return false;
  }

  const targetExisting = loadHexcrawlSceneState(params.targetSceneId);
  const { state: crossedState, destinationArrival } = buildCrossedSceneState({
    source: sourceState,
    targetSceneId: params.targetSceneId,
    entryHexKey: placement.hexKey,
    targetTokenId,
    targetExisting,
    fromSceneId: params.sourceSceneId,
    direction: params.direction,
  });

  const destinationArrived = Boolean(destinationArrival);
  const saved = await saveHexcrawlSceneState(crossedState, { writeHexMap: destinationArrived });
  let state = saved ?? crossedState;

  if (destinationArrived && destinationArrival) {
    state = await (
      await import("./hexMapDestination.js")
    ).handleMapDestinationArrival({
      sceneId: params.targetSceneId,
      tokenId: targetTokenId,
      state,
      arrival: destinationArrival,
    });
  } else {
    await moveTokenToHexKey(
      params.targetSceneId,
      targetTokenId,
      placement.hexKey,
      { x: placement.x, y: placement.y },
    );
  }

  ui.notifications.info(
    t("WASTELANDER.Hexcrawl.Notify.SceneCrossed", {
      scene: (targetScene as { name?: string }).name ?? params.targetSceneId,
      hex: placement.hexKey,
    }),
  );

  console.info(
    `${MODULE_ID} | scene border cross ${params.sourceSceneId} ${params.direction} → ${params.targetSceneId} @ ${placement.hexKey} (${placement.method})`,
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
