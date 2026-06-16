type GridOffset = { i: number; j: number };

type HexGrid = {
  isGridless?: boolean;
  isHexagonal?: boolean;
  isSquare?: boolean;
  pointToCube?: (point: { x: number; y: number }) => { q: number; r: number; s: number };
  cubeToOffset?: (cube: { q: number; r: number; s: number }) => GridOffset;
  getOffset?: (coords: { x: number; y: number }) => GridOffset | null;
  getTopLeftPoint?: (offset: GridOffset) => { x: number; y: number };
  testAdjacency?: (a: GridOffset, b: GridOffset) => boolean;
  getAdjacentOffsets?: (offset: GridOffset) => GridOffset[];
  size?: number;
  sizeX?: number;
  sizeY?: number;
};

type TokenDimensions = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  getOccupiedGridSpaceOffsets?: (
    data?: Partial<{ x: number; y: number; width: number; height: number }>,
  ) => GridOffset[];
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

type TokenMovementSectionLike = {
  waypoints?: MovementWaypoint[];
};

type TokenMovementLike = {
  origin?: MovementWaypoint;
  passed?: MovementWaypoint[] | TokenMovementSectionLike;
  pending?: MovementWaypoint[] | TokenMovementSectionLike;
  history?: MovementWaypoint[] | TokenMovementSectionLike;
  destination?: MovementWaypoint;
};

function isMovementWaypoint(row: unknown): row is MovementWaypoint {
  if (!row || typeof row !== "object") return false;
  const waypoint = row as MovementWaypoint;
  return Number.isFinite(waypoint.x) && Number.isFinite(waypoint.y);
}

function movementWaypointsFromSection(section: unknown): MovementWaypoint[] {
  if (!section) return [];
  if (Array.isArray(section)) {
    return section.filter(isMovementWaypoint);
  }
  if (typeof section === "object") {
    const waypoints = (section as TokenMovementSectionLike).waypoints;
    if (Array.isArray(waypoints)) {
      return waypoints.filter(isMovementWaypoint);
    }
  }
  return [];
}

function movementWaypointsFromOperation(movement: TokenMovementLike): MovementWaypoint[] {
  for (const section of [movement.passed, movement.history, movement.pending]) {
    const waypoints = movementWaypointsFromSection(section);
    if (waypoints.length > 0) return waypoints;
  }

  const route: MovementWaypoint[] = [];
  if (isMovementWaypoint(movement.origin)) route.push(movement.origin);
  if (isMovementWaypoint(movement.destination)) route.push(movement.destination);
  return route;
}

type TokenDocWithId = TokenDimensions & { id?: string };

function appendHexKey(
  keys: string[],
  seen: Set<string>,
  key: string | null | undefined,
): void {
  if (!key || seen.has(key)) return;
  seen.add(key);
  keys.push(key);
}

function hexKeyFromCanvasToken(tokenId: string | undefined): string | null {
  if (!tokenId) return null;

  const canvas = (globalThis as {
    canvas?: {
      tokens?: {
        placeables?: Array<{
          id?: string;
          document?: TokenDimensions & { id?: string };
          center?: { x: number; y: number };
        }>;
      };
    };
  }).canvas;
  const placed = canvas?.tokens?.placeables?.find(
    (token) => token.document?.id === tokenId || token.id === tokenId,
  );
  if (!placed) return null;
  return getTokenHexKey(placed);
}

/**
 * Hex key(s) the token finished on after a move.
 * Tries several strategies so cover removal does not bail on a single failed lookup.
 */
export function resolveEnteredHexKeys(
  doc: TokenDocWithId,
  movement?: TokenMovementLike,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  appendHexKey(keys, seen, getHexKeyFromTokenDocument(doc));

  if (movement) {
    const destination = resolveMovementDestinationWaypoint(doc, movement);
    if (destination) {
      appendHexKey(keys, seen, getHexKeyFromTokenDocument(doc, destination));
    }

    appendHexKey(keys, seen, collectMovementHexKeys(doc, movement).at(-1));

    for (const section of [movement.passed, movement.history, movement.pending]) {
      for (const waypoint of movementWaypointsFromSection(section)) {
        appendHexKey(keys, seen, getHexKeyFromTokenDocument(doc, waypoint));
      }
    }
  }

  appendHexKey(keys, seen, hexKeyFromCanvasToken(doc.id));
  return keys;
}

/** Primary landing hex after a move (first successful {@link resolveEnteredHexKeys} candidate). */
export function resolveTokenLandingHexKey(
  doc: TokenDimensions,
  movement?: TokenMovementLike,
): string | null {
  return resolveEnteredHexKeys(doc, movement)[0] ?? null;
}

type HexagonalGridStatic = {
  cubeRound?: (cube: { q: number; r: number; s: number }) => { q: number; r: number; s: number };
};

function formatHexKey(offset: GridOffset): string | null {
  if (!Number.isFinite(offset.i) || !Number.isFinite(offset.j)) return null;
  return `${offset.i},${offset.j}`;
}

function hexKeyFromGridAtPoint(
  grid: HexGrid,
  point: { x: number; y: number },
): string | null {
  if (grid.isGridless) return null;
  if (!grid.pointToCube || !grid.cubeToOffset) return null;

  const cube = grid.pointToCube(point);
  const HexagonalGrid = (
    globalThis as { foundry?: { grid?: { HexagonalGrid?: HexagonalGridStatic } } }
  ).foundry?.grid?.HexagonalGrid;
  const rounded = HexagonalGrid?.cubeRound ? HexagonalGrid.cubeRound(cube) : cube;
  return formatHexKey(grid.cubeToOffset(rounded));
}

/** Hex key under a canvas pixel on the active scene grid. */
export function getHexKeyFromCanvasPoint(point: { x: number; y: number }): string | null {
  return snapCanvasPointToHex(point)?.hexKey ?? null;
}

export type HexSnapResult = { hexKey: string; x: number; y: number };

/** Resolve a canvas pixel to a grid hex and snapped token top-left position. */
export function snapCanvasPointToHex(point: { x: number; y: number }): HexSnapResult | null {
  const grid = (globalThis as { canvas?: { grid?: HexGrid } }).canvas?.grid;
  if (!grid || grid.isGridless) return null;

  let offset: GridOffset | null = null;
  if (typeof grid.getOffset === "function") {
    offset = grid.getOffset(point);
  }
  if (!offset) {
    const hexKey = hexKeyFromGridAtPoint(grid, point);
    offset = hexKey ? parseHexKey(hexKey) : null;
  }
  if (!offset || !Number.isFinite(offset.i) || !Number.isFinite(offset.j)) return null;

  const hexKey = formatHexKey(offset);
  if (!hexKey) return null;

  if (typeof grid.getTopLeftPoint === "function") {
    const topLeft = grid.getTopLeftPoint(offset);
    if (Number.isFinite(topLeft.x) && Number.isFinite(topLeft.y)) {
      return { hexKey, x: topLeft.x, y: topLeft.y };
    }
  }

  return { x: point.x, y: point.y };
}

type GridWithOffsetRange = HexGrid & {
  isHexagonal?: boolean;
  getOffset?: (coords: { x: number; y: number }) => GridOffset | null;
  getOffsetRange?: (
    bounds: { x: number; y: number; width: number; height: number },
  ) => [number, number, number, number] | { minI: number; maxI: number; minJ: number; maxJ: number };
};

function hexKeyFromGridSample(
  grid: GridWithOffsetRange,
  point: { x: number; y: number },
): string | null {
  if (typeof grid.getOffset === "function") {
    const offset = grid.getOffset(point);
    if (offset) return formatHexKey(offset);
  }
  return hexKeyFromGridAtPoint(grid, point);
}

/** Every hex cell on the active scene grid (for coordinate overlays). */
export function sceneHexKeysForGridOverlay(): string[] {
  const canvas = (globalThis as {
    canvas?: {
      grid?: GridWithOffsetRange;
      dimensions?: {
        width: number;
        height: number;
        sceneRect?: { x: number; y: number; width: number; height: number };
      };
    };
  }).canvas;
  const grid = canvas?.grid;
  if (!grid?.isHexagonal) return [];

  const dims = canvas?.dimensions;
  if (!dims) return [];

  const bounds = {
    x: dims.sceneRect?.x ?? 0,
    y: dims.sceneRect?.y ?? 0,
    width: dims.sceneRect?.width ?? dims.width,
    height: dims.sceneRect?.height ?? dims.height,
  };

  if (typeof grid.getOffsetRange === "function" && bounds.width > 0 && bounds.height > 0) {
    try {
      const range = grid.getOffsetRange(bounds);
      const keys: string[] = [];
      if (Array.isArray(range) && range.length >= 4) {
        const [i0, j0, i1, j1] = range;
        for (let i = i0; i < i1; i++) {
          for (let j = j0; j < j1; j++) {
            const key = formatHexKey({ i, j });
            if (key) keys.push(key);
          }
        }
      } else if (range && typeof range === "object") {
        const boxed = range as { minI: number; maxI: number; minJ: number; maxJ: number };
        for (let i = boxed.minI; i <= boxed.maxI; i++) {
          for (let j = boxed.minJ; j <= boxed.maxJ; j++) {
            const key = formatHexKey({ i, j });
            if (key) keys.push(key);
          }
        }
      }
      if (keys.length) return keys;
    } catch {
      // Fall through to pixel sampling.
    }
  }

  const sizeX = grid.sizeX ?? grid.size ?? 100;
  const sizeY = grid.sizeY ?? sizeX;
  const seen = new Set<string>();
  const stepX = Math.max(8, sizeX / 2);
  const stepY = Math.max(8, sizeY / 2);
  for (let y = bounds.y + stepY; y < bounds.y + bounds.height; y += stepY) {
    for (let x = bounds.x + stepX; x < bounds.x + bounds.width; x += stepX) {
      const key = hexKeyFromGridSample(grid, { x, y });
      if (key) seen.add(key);
    }
  }
  return [...seen];
}

function tokenCenterPixels(
  doc: TokenDimensions,
  position?: MovementWaypoint,
): { x: number; y: number } | null {
  const x = position?.x ?? doc.x;
  const y = position?.y ?? doc.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = position?.width ?? doc.width ?? 1;
  const height = position?.height ?? doc.height ?? 1;
  if (typeof doc.getSize === "function") {
    const size = doc.getSize({ width, height });
    return { x: x + size.width / 2, y: y + size.height / 2 };
  }

  const grid = (globalThis as { canvas?: { grid?: HexGrid } }).canvas?.grid;
  const cellW = grid?.sizeX ?? grid?.size ?? 100;
  const cellH = grid?.sizeY ?? grid?.size ?? 100;
  return { x: x + (width * cellW) / 2, y: y + (height * cellH) / 2 };
}

/** Grid offset for a token document at an optional snapped position. */
export function getHexKeyFromTokenDocument(
  doc: TokenDimensions,
  position?: MovementWaypoint,
): string | null {
  const x = position?.x ?? doc.x;
  const y = position?.y ?? doc.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = position?.width ?? doc.width ?? 1;
  const height = position?.height ?? doc.height ?? 1;

  if (typeof doc.getOccupiedGridSpaceOffsets === "function") {
    const offsets = doc.getOccupiedGridSpaceOffsets({ x, y, width, height });
    const primary = offsets[0];
    if (primary) {
      const key = formatHexKey(primary);
      if (key) return key;
    }
  }

  const center = tokenCenterPixels(doc, position);
  if (!center) return null;

  const grid = (globalThis as { canvas?: { grid?: HexGrid } }).canvas?.grid;
  if (!grid) return null;
  return hexKeyFromGridAtPoint(grid, center);
}

type CanvasToken = {
  document?: TokenDimensions & { x?: number; y?: number; width?: number; height?: number };
  center?: { x: number; y: number };
};

/** @deprecated Prefer getHexKeyFromTokenDocument with the TokenDocument. */
export function getTokenHexKey(token: CanvasToken): string | null {
  const doc = token.document;
  if (doc && typeof doc.getOccupiedGridSpaceOffsets === "function") {
    return getHexKeyFromTokenDocument(doc);
  }

  const center = token.center ?? (doc ? tokenCenterPixels(doc) : null);
  if (!center) return null;

  const grid = (globalThis as { canvas?: { grid?: HexGrid } }).canvas?.grid;
  if (!grid) return null;
  return hexKeyFromGridAtPoint(grid, center);
}

/** Movement start waypoint (hook origin or current token position). */
export function resolveMovementOriginWaypoint(
  doc: TokenDimensions,
  movement: TokenMovementLike,
): MovementWaypoint | null {
  if (movement.origin && isMovementWaypoint(movement.origin)) {
    return movement.origin;
  }
  if (Number.isFinite(doc.x) && Number.isFinite(doc.y)) {
    return { x: doc.x, y: doc.y, width: doc.width, height: doc.height };
  }
  return null;
}

/** Final movement waypoint (hook destination, else last passed waypoint). */
export function resolveMovementDestinationWaypoint(
  doc: TokenDimensions,
  movement: TokenMovementLike,
): MovementWaypoint | null {
  if (movement.destination && isMovementWaypoint(movement.destination)) {
    return movement.destination;
  }
  const passed = movementWaypointsFromSection(movement.passed);
  if (passed.length > 0) return passed[passed.length - 1] ?? null;
  return null;
}

/** Distinct hex keys crossed by a v13 token movement, in path order. */
export function collectMovementHexKeys(
  doc: TokenDimensions,
  movement: TokenMovementLike,
): string[] {
  const rows = movementWaypointsFromOperation(movement);

  const keys: string[] = [];
  let previous: string | null = null;
  for (const waypoint of rows) {
    const key = getHexKeyFromTokenDocument(doc, waypoint);
    if (!key || key === previous) continue;
    keys.push(key);
    previous = key;
  }
  return keys;
}

function canvasGrid(): HexGrid | null {
  return (globalThis as { canvas?: { grid?: HexGrid } }).canvas?.grid ?? null;
}

/** Whether two grid cells share an edge (one step on hex or square grids). */
export function areAdjacentHexKeys(fromHexKey: string, toHexKey: string): boolean {
  if (fromHexKey === toHexKey) return true;

  const from = parseHexKey(fromHexKey);
  const to = parseHexKey(toHexKey);
  if (!from || !to) return false;

  const grid = canvasGrid();
  if (!grid || grid.isGridless) return true;

  if (typeof grid.testAdjacency === "function") {
    return grid.testAdjacency(from, to);
  }

  if (typeof grid.getAdjacentOffsets === "function") {
    return grid.getAdjacentOffsets(from).some((offset) => offset.i === to.i && offset.j === to.j);
  }

  return false;
}

export type SingleHexMoveValidation = {
  allowed: boolean;
  reason?: "multi-hex" | "not-adjacent";
};

/**
 * Hard constraint for hexcrawl travel: the travel token may enter at most one new
 * grid space per drag, and that space must be adjacent to the origin.
 */
export function validateSingleHexTravelMove(
  doc: TokenDimensions,
  movement: TokenMovementLike,
): SingleHexMoveValidation {
  const grid = canvasGrid();
  if (!grid || grid.isGridless) return { allowed: true };

  const originHex = movement.origin
    ? getHexKeyFromTokenDocument(doc, movement.origin)
    : getHexKeyFromTokenDocument(doc);
  const destHex = movement.destination
    ? getHexKeyFromTokenDocument(doc, movement.destination)
    : null;

  if (!originHex || !destHex) return { allowed: true };
  if (originHex === destHex) return { allowed: true };

  const pathHexKeys = collectMovementHexKeys(doc, movement);
  const newHexes = pathHexKeys.filter((key) => key !== originHex);
  if (newHexes.length > 1) return { allowed: false, reason: "multi-hex" };
  if (newHexes.length === 1 && newHexes[0] !== destHex) {
    return { allowed: false, reason: "multi-hex" };
  }

  if (!areAdjacentHexKeys(originHex, destHex)) {
    return { allowed: false, reason: "not-adjacent" };
  }

  return { allowed: true };
}

export type { TokenMovementLike };

export function parseHexKey(hexKey: string): { i: number; j: number } | null {
  const [iRaw, jRaw] = hexKey.split(",");
  const i = Number(iRaw);
  const j = Number(jRaw);
  if (!Number.isFinite(i) || !Number.isFinite(j)) return null;
  return { i, j };
}

/** Canvas pixel vertices for a hex grid cell (aligned with Foundry's grid renderer). */
export function hexVerticesForKey(
  hexKey: string,
): { x: number; y: number }[] | null {
  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const grid = (globalThis as { canvas?: { grid?: HexGrid & {
    isHexagonal?: boolean;
    getVertices?: (coords: { i: number; j: number }) => { x: number; y: number }[];
  } } }).canvas?.grid;
  if (!grid?.isHexagonal || typeof grid.getVertices !== "function") return null;

  const vertices = grid.getVertices(offset);
  if (!Array.isArray(vertices) || vertices.length < 3) return null;

  const points = vertices.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  return points.length >= 3 ? points : null;
}

export type HexBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

/** Axis-aligned bounds and center for a hex cell on the active canvas. */
export function hexBoundsForKey(hexKey: string): HexBounds | null {
  const vertices = hexVerticesForKey(hexKey);
  if (!vertices?.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of vertices) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Top-left pixel position for placing a token on a hex grid cell. */
export function tokenPositionForHexKey(
  hexKey: string,
): { x: number; y: number } | null {
  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const grid = (globalThis as { canvas?: { grid?: HexGrid & {
    getTopLeftPoint?: (coords: { i: number; j: number }) => { x: number; y: number };
  } } }).canvas?.grid;
  if (!grid?.getTopLeftPoint) return null;

  const point = grid.getTopLeftPoint(offset);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

/** Token position for a hex on a specific scene (uses scene grid when canvas is elsewhere). */
export function tokenPositionForHexKeyOnScene(
  sceneId: string,
  hexKey: string,
): { x: number; y: number } | null {
  const canvas = (globalThis as { canvas?: { scene?: { id?: string } } }).canvas;
  if (canvas?.scene?.id === sceneId) {
    return tokenPositionForHexKey(hexKey);
  }

  const offset = parseHexKey(hexKey);
  if (!offset) return null;

  const scene = (game as {
    scenes?: {
      get: (id: string) => {
        padding?: number;
        grid?: { size?: number; sizeX?: number; sizeY?: number };
        getDimensions?: () => {
          sceneX: number;
          sceneY: number;
          sceneWidth: number;
          sceneHeight: number;
          sceneRect?: { x: number; y: number; width: number; height: number };
        };
      } | undefined;
    };
  }).scenes?.get(sceneId);
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
      // Use 0,0.
    }
  }

  const grid = scene.grid;
  const sizeX = grid?.sizeX ?? grid?.size ?? 100;
  const sizeY = grid?.sizeY ?? grid?.size ?? 100;
  return {
    x: originX + offset.i * sizeX,
    y: originY + offset.j * sizeY,
  };
}

export function findSceneTokenIdsForActor(sceneId: string, actorId: string): string[] {
  const scene = (game as { scenes?: { get: (id: string) => SceneLike | undefined } })
    .scenes?.get(sceneId);
  if (!scene?.tokens) return [];

  const ids: string[] = [];
  for (const token of scene.tokens) {
    if (token.actorId === actorId) ids.push(token.id);
  }
  return ids;
}

export function findSceneTokenIdForActor(
  sceneId: string,
  actorId: string,
): string | null {
  return findSceneTokenIdsForActor(sceneId, actorId)[0] ?? null;
}

type SceneLike = {
  tokens: Iterable<{
    id: string;
    actorId: string | null;
  }> & {
    get?: (id: string) => TokenDimensions & { id: string; actorId: string | null };
  };
};

export function seedLastHexKeyFromTravelToken(
  state: { travelTokenId: string | null; lastHexKey: string | null },
  sceneId: string,
): string | null {
  if (!state.travelTokenId) return state.lastHexKey;
  const scene = (game as { scenes?: { get: (id: string) => SceneLike | undefined } })
    .scenes?.get(sceneId);
  const tokenDoc = scene?.tokens?.get?.(state.travelTokenId);
  if (!tokenDoc) return state.lastHexKey;
  return getHexKeyFromTokenDocument(tokenDoc) ?? state.lastHexKey;
}
