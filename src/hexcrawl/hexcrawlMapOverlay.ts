import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import {
  annotatedHexKeys,
  parseHexCoverColor,
  poiIconById,
  shouldShowHexCover,
  shouldShowPoiIcon,
  poiDisplayAlpha,
  terrainBadgePath,
} from "./hexAnnotations.js";
import { hexBoundsForKey, hexVerticesForKey, sceneHexKeysForGridOverlay } from "./hexCoords.js";
import { resolvePoiIconImageUrl } from "./hexPoiCatalog.js";
import {
  mapDestinationDisplayAlpha,
  shouldShowMapDestination,
} from "./hexMapDestination.js";
import {
  clearStagedHexcrawlMapOverlayState,
  resolveHexcrawlMapOverlayState,
  stageHexcrawlMapOverlayState,
} from "./hexMapOverlayState.js";
import { loadHexcrawlSceneState, type HexcrawlSceneState } from "./hexcrawlScenePersist.js";
import { getHexMapEditorSelection } from "./hexMapEditorState.js";
import { resolveGridBorderStyle } from "./gridBorderStyle.js";
import { trailHexKeysForState, trailStyleForHex } from "./hexcrawlTrailStyles.js";

type Point = { x: number; y: number };

type PixiGraphics = {
  clear: () => void;
  destroy: (options?: { children?: boolean }) => void;
  lineStyle?: (width: number, color: number, alpha: number) => PixiGraphics;
  drawPolygon?: (points: number[]) => void;
  moveTo?: (x: number, y: number) => void;
  lineTo?: (x: number, y: number) => void;
  closePath?: () => void;
  stroke?: (style: { width: number; color: number; alpha: number }) => void;
  beginFill?: (color: number, alpha: number) => PixiGraphics;
  endFill?: () => void;
  fill?: (style: { color: number; alpha: number }) => void;
};

type PixiSprite = PixiGraphics & {
  anchor?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  scale?: { set: (x: number, y: number) => void };
  alpha?: number;
};

type PixiContainer = {
  destroyed?: boolean;
  children: PixiGraphics[];
  addChild: (child: PixiGraphics) => PixiGraphics;
  removeChildren: () => PixiGraphics[];
  destroy: (options?: { children?: boolean }) => void;
  eventMode?: string;
  interactiveChildren?: boolean;
  name?: string;
};

type PixiText = PixiGraphics & {
  anchor?: { set: (x: number, y: number) => void };
  position?: { set: (x: number, y: number) => void };
  text?: string;
  alpha?: number;
};

type PixiNamespace = {
  Container: new () => PixiContainer;
  Graphics: new () => PixiGraphics;
  Sprite: new (texture?: unknown) => PixiSprite;
  Text: new (text: string, style?: Record<string, unknown>) => PixiText;
  Texture: {
    from: (path: string) => unknown;
  };
  Assets?: {
    load: (path: string) => Promise<unknown>;
  };
};

type CanvasLike = {
  ready?: boolean;
  scene?: { id: string } | null;
  grid?: { isHexagonal?: boolean };
  tokens?: PixiContainer & { addChildAt?: (child: PixiContainer, index: number) => PixiContainer };
};

const MAP_CONTAINER_NAME = "wastelander-hexcrawl-map";
const SELECTION_COLOR = 0x4fc3f7;
const HEX_COORD_LABEL_ALPHA = 0.5;
const MAP_DESTINATION_GLYPH = "\uf3c5";
const MAP_DESTINATION_COLOR = 0xff5252;
/** Overseer-only ghost alpha for hex hide cover fills. */
const HEX_COVER_OVERSEER_ALPHA = 0.7;

export { stageHexcrawlMapOverlayState, clearStagedHexcrawlMapOverlayState };

let mapContainer: PixiContainer | null = null;
const textureCache = new Map<string, unknown>();
let refreshGeneration = 0;

function getCanvas(): CanvasLike | null {
  return (globalThis as { canvas?: CanvasLike }).canvas ?? null;
}

function getPixi(): PixiNamespace | null {
  return (globalThis as { PIXI?: PixiNamespace }).PIXI ?? null;
}

function moduleAssetUrl(relativePath: string): string {
  return `${MODULE_PATH}/${relativePath}`;
}

async function loadTextureFromUrl(PIXI: PixiNamespace, url: string): Promise<unknown | null> {
  if (textureCache.has(url)) return textureCache.get(url) ?? null;

  try {
    if (PIXI.Assets?.load) {
      const texture = await PIXI.Assets.load(url);
      textureCache.set(url, texture);
      return texture;
    }
  } catch {
    // Fall through to Texture.from.
  }

  try {
    const texture = PIXI.Texture.from(url);
    textureCache.set(url, texture);
    return texture;
  } catch {
    return null;
  }
}

async function loadTexture(PIXI: PixiNamespace, relativePath: string): Promise<unknown | null> {
  return loadTextureFromUrl(PIXI, moduleAssetUrl(relativePath));
}

function strokeHexOutline(
  graphics: PixiGraphics,
  vertices: Point[],
  width: number,
  color: number,
  alpha: number,
): void {
  if (vertices.length < 3) return;

  if (typeof graphics.lineStyle === "function" && typeof graphics.drawPolygon === "function") {
    graphics.lineStyle(width, color, alpha);
    graphics.drawPolygon(vertices.flatMap((point) => [point.x, point.y]));
    return;
  }

  graphics.moveTo?.(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    graphics.lineTo?.(vertices[i].x, vertices[i].y);
  }
  graphics.closePath?.();
  graphics.stroke?.({ width, color, alpha });
}

function fillHexPolygon(
  graphics: PixiGraphics,
  vertices: Point[],
  color: number,
  alpha: number,
): void {
  if (vertices.length < 3) return;

  if (typeof graphics.beginFill === "function" && typeof graphics.drawPolygon === "function") {
    graphics.beginFill(color, alpha);
    graphics.drawPolygon(vertices.flatMap((point) => [point.x, point.y]));
    graphics.endFill?.();
    return;
  }

  graphics.moveTo?.(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    graphics.lineTo?.(vertices[i].x, vertices[i].y);
  }
  graphics.closePath?.();
  graphics.fill?.({ color, alpha });
}

function scaleVerticesTowardCenter(vertices: Point[], scale: number): Point[] {
  if (vertices.length === 0) return vertices;
  const centerX = vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length;
  const centerY = vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length;
  return vertices.map((point) => ({
    x: centerX + (point.x - centerX) * scale,
    y: centerY + (point.y - centerY) * scale,
  }));
}

function addHexBorder(
  PIXI: PixiNamespace,
  container: PixiContainer,
  vertices: Point[],
  border: { color: number; alpha: number; width: number },
): void {
  const borderGraphics = new PIXI.Graphics() as PixiGraphics & { alpha?: number };
  if (typeof borderGraphics.alpha === "number") {
    borderGraphics.alpha = border.alpha;
  }
  strokeHexOutline(
    borderGraphics,
    vertices,
    border.width,
    border.color,
    typeof borderGraphics.alpha === "number" ? 1 : border.alpha,
  );
  container.addChild(borderGraphics);
}

function fillAndStrokeHexPolygon(
  PIXI: PixiNamespace,
  container: PixiContainer,
  vertices: Point[],
  fillColor: number,
  fillAlpha: number,
  border: { color: number; alpha: number; width: number },
): void {
  const fillGraphics = new PIXI.Graphics();
  fillHexPolygon(fillGraphics, vertices, fillColor, fillAlpha);
  container.addChild(fillGraphics);
  addHexBorder(PIXI, container, vertices, border);
}

function ensureMapContainer(): PixiContainer | null {
  const canvas = getCanvas();
  const PIXI = getPixi();
  if (!canvas?.ready || !canvas.tokens || !PIXI) return null;

  if (mapContainer && !mapContainer.destroyed) {
    return mapContainer;
  }

  mapContainer = new PIXI.Container();
  mapContainer.name = MAP_CONTAINER_NAME;
  mapContainer.eventMode = "none";
  mapContainer.interactiveChildren = false;

  if (typeof canvas.tokens.addChildAt === "function") {
    canvas.tokens.addChildAt(mapContainer, 0);
  } else {
    canvas.tokens.addChild(mapContainer as unknown as PixiGraphics);
  }

  return mapContainer;
}

function placeSprite(
  PIXI: PixiNamespace,
  container: PixiContainer,
  texture: unknown,
  x: number,
  y: number,
  width: number,
  height: number,
  anchorX = 0.5,
  anchorY = 0.5,
  alpha = 1,
): void {
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor?.set(anchorX, anchorY);
  sprite.position?.set(x, y);
  const texWidth = Number((texture as { width?: number }).width ?? width);
  const texHeight = Number((texture as { height?: number }).height ?? height);
  const scaleX = width / Math.max(1, texWidth);
  const scaleY = height / Math.max(1, texHeight);
  sprite.scale?.set(scaleX, scaleY);
  if (typeof sprite.alpha === "number") {
    sprite.alpha = alpha;
  }
  container.addChild(sprite as unknown as PixiGraphics);
}

function createMapLabel(
  PIXI: PixiNamespace,
  text: string,
  fontSize: number,
): PixiText | null {
  const strokeThickness = Math.max(2, Math.round(fontSize * 0.2));
  const PreciseText = (
    globalThis as {
      foundry?: {
        canvas?: {
          containers?: {
            PreciseText?: new (label: string, style?: Record<string, unknown>) => PixiText;
            getTextStyle?: (options?: Record<string, unknown>) => Record<string, unknown>;
          };
        };
      };
    }
  ).foundry?.canvas?.containers?.PreciseText;

  const baseStyle =
    typeof PreciseText?.getTextStyle === "function" ? PreciseText.getTextStyle() : {};
  const style = {
    ...baseStyle,
    fontFamily: "Signika, sans-serif",
    fontSize,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness,
    align: "center",
  };

  if (PreciseText) {
    return new PreciseText(text, style);
  }
  if (typeof PIXI.Text === "function") {
    return new PIXI.Text(text, style);
  }
  return null;
}

function placeHexCoordLabel(
  PIXI: PixiNamespace,
  container: PixiContainer,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): void {
  const label = createMapLabel(PIXI, text, fontSize);
  if (!label) return;
  label.anchor?.set(0.5, 1);
  label.position?.set(x, y);
  if (typeof label.alpha === "number") {
    label.alpha = HEX_COORD_LABEL_ALPHA;
  }
  container.addChild(label as unknown as PixiGraphics);
}

function placeMapDestinationMarker(
  PIXI: PixiNamespace,
  container: PixiContainer,
  x: number,
  y: number,
  fontSize: number,
  alpha: number,
): void {
  const strokeThickness = Math.max(2, Math.round(fontSize * 0.12));
  const PreciseText = (
    globalThis as {
      foundry?: {
        canvas?: {
          containers?: {
            PreciseText?: new (label: string, style?: Record<string, unknown>) => PixiText;
          };
        };
      };
    }
  ).foundry?.canvas?.containers?.PreciseText;

  const style = {
    fontFamily: '"Font Awesome 6 Free", FontAwesome',
    fontSize,
    fontWeight: "900",
    fill: MAP_DESTINATION_COLOR,
    stroke: 0x000000,
    strokeThickness,
    align: "center",
  };

  const label = PreciseText
    ? new PreciseText(MAP_DESTINATION_GLYPH, style)
    : typeof PIXI.Text === "function"
      ? new PIXI.Text(MAP_DESTINATION_GLYPH, style)
      : null;
  if (!label) return;
  label.anchor?.set(0.5, 0.85);
  label.position?.set(x, y);
  if (typeof label.alpha === "number") {
    label.alpha = alpha;
  }
  container.addChild(label as unknown as PixiGraphics);
}

async function drawMapForState(
  state: HexcrawlSceneState,
  sceneId: string,
  generation: number,
): Promise<void> {
  if (generation !== refreshGeneration) return;

  const container = ensureMapContainer();
  const PIXI = getPixi();
  if (!container || !PIXI) return;

  container.removeChildren();

  if (generation !== refreshGeneration) return;

  if (!state.enabled) return;

  const trailKeys = trailHexKeysForState(state);
  for (const hexKey of trailKeys) {
    if (generation !== refreshGeneration) return;
    const vertices = hexVerticesForKey(hexKey);
    if (!vertices) continue;
    const style = trailStyleForHex(hexKey, state);
    const graphics = new PIXI.Graphics();
    strokeHexOutline(graphics, vertices, style.width, style.color, style.alpha);
    container.addChild(graphics);
  }

  if (generation !== refreshGeneration) return;

  const selection = getHexMapEditorSelection(sceneId);
  if (selection) {
    const vertices = hexVerticesForKey(selection);
    if (vertices) {
      const graphics = new PIXI.Graphics();
      strokeHexOutline(graphics, vertices, 3, SELECTION_COLOR, 0.95);
      container.addChild(graphics);
    }
  }

  const annotationKeys = new Set(annotatedHexKeys(state));
  if (selection) annotationKeys.add(selection);
  const revealAllMapFog = currentUserIsOverseer();
  const gridBorder = resolveGridBorderStyle();

  for (const hexKey of annotationKeys) {
    if (generation !== refreshGeneration) return;

    const annotation = state.hexAnnotations[hexKey];
    if (!annotation?.hexCoverColor || !shouldShowHexCover(state, hexKey, revealAllMapFog)) {
      continue;
    }
    const vertices = hexVerticesForKey(hexKey);
    if (!vertices) continue;
    const hexCoverAlpha = revealAllMapFog ? HEX_COVER_OVERSEER_ALPHA : 1;
    fillAndStrokeHexPolygon(
      PIXI,
      container,
      vertices,
      parseHexCoverColor(annotation.hexCoverColor),
      hexCoverAlpha,
      gridBorder,
    );
  }

  for (const hexKey of annotationKeys) {
    if (generation !== refreshGeneration) return;

    const bounds = hexBoundsForKey(hexKey);
    if (!bounds) continue;
    const annotation = state.hexAnnotations[hexKey];
    if (annotation?.terrain && state.showTerrainIcons) {
      const badgeSize = Math.max(12, bounds.width * 0.18);
      const badgeTexture = await loadTexture(PIXI, terrainBadgePath(annotation.terrain));
      if (generation !== refreshGeneration) return;
      if (badgeTexture) {
        placeSprite(
          PIXI,
          container,
          badgeTexture,
          bounds.maxX - badgeSize * 0.35,
          bounds.minY + badgeSize * 0.35,
          badgeSize,
          badgeSize,
          1,
          0,
        );
      }
    }

    const iconId = annotation?.iconId;
    if (!iconId || !shouldShowPoiIcon(state, hexKey, revealAllMapFog)) continue;
    const poiAlpha = poiDisplayAlpha(state, hexKey, revealAllMapFog);
    const poi = poiIconById(iconId);
    if (!poi) continue;
    const iconTexture = await loadTextureFromUrl(PIXI, resolvePoiIconImageUrl(poi.path));
    if (generation !== refreshGeneration) return;
    if (!iconTexture) continue;
    const iconSize = bounds.width * 0.8;
    const iconVertices = hexVerticesForKey(hexKey);
    if (iconVertices) {
      addHexBorder(
        PIXI,
        container,
        scaleVerticesTowardCenter(iconVertices, 0.8),
        { ...gridBorder, alpha: gridBorder.alpha * poiAlpha },
      );
    }
    placeSprite(
      PIXI,
      container,
      iconTexture,
      bounds.centerX,
      bounds.centerY,
      iconSize,
      iconSize,
      0.5,
      0.5,
      poiAlpha,
    );
  }

  const destination = state.mapDestination;
  if (destination && shouldShowMapDestination(state, revealAllMapFog)) {
    const destBounds = hexBoundsForKey(destination.hexKey);
    if (destBounds) {
      const destAlpha = mapDestinationDisplayAlpha(state, revealAllMapFog);
      const destVertices = hexVerticesForKey(destination.hexKey);
      if (destVertices) {
        addHexBorder(
          PIXI,
          container,
          scaleVerticesTowardCenter(destVertices, 0.82),
          { ...gridBorder, alpha: gridBorder.alpha * destAlpha },
        );
      }
      const markerSize = Math.max(18, destBounds.width * 0.42);
      placeMapDestinationMarker(
        PIXI,
        container,
        destBounds.centerX,
        destBounds.centerY,
        markerSize,
        destAlpha,
      );
    }
  }

  if (state.showHexCoords) {
    const coordHexKeys = sceneHexKeysForGridOverlay();
    for (const hexKey of coordHexKeys) {
      if (generation !== refreshGeneration) return;

      const bounds = hexBoundsForKey(hexKey);
      if (!bounds) continue;
      const fontSize = Math.max(10, Math.round(bounds.width * 0.14));
      placeHexCoordLabel(
        PIXI,
        container,
        hexKey,
        bounds.centerX,
        bounds.maxY - Math.max(2, fontSize * 0.15),
        fontSize,
      );
    }
  }
}

export function destroyHexcrawlMapOverlay(): void {
  refreshGeneration += 1;
  if (!mapContainer || mapContainer.destroyed) {
    mapContainer = null;
    return;
  }

  mapContainer.destroy({ children: true });
  mapContainer = null;
}

export async function refreshHexcrawlMapOverlay(
  sceneId?: string,
  stateOverride?: HexcrawlSceneState | null,
): Promise<void> {
  const generation = ++refreshGeneration;

  const canvas = getCanvas();
  if (!canvas?.ready || !canvas.grid?.isHexagonal) {
    destroyHexcrawlMapOverlay();
    return;
  }

  const activeSceneId = sceneId ?? getActiveSceneId() ?? canvas.scene?.id ?? null;
  if (!activeSceneId || canvas.scene?.id !== activeSceneId) {
    destroyHexcrawlMapOverlay();
    return;
  }

  const loaded = loadHexcrawlSceneState(activeSceneId);
  const state =
    stateOverride ?? resolveHexcrawlMapOverlayState(activeSceneId, loaded);
  if (!state?.enabled) {
    if (mapContainer && !mapContainer.destroyed) {
      mapContainer.removeChildren();
    }
    return;
  }

  await drawMapForState(state, activeSceneId, generation);
}

function scheduleRefresh(sceneId?: string): void {
  void refreshHexcrawlMapOverlay(sceneId);
}

export function registerHexcrawlMapOverlay(): void {
  Hooks.on("canvasReady", () => {
    scheduleRefresh();
  });

  Hooks.on("canvasTearDown", () => {
    clearStagedHexcrawlMapOverlayState();
    destroyHexcrawlMapOverlay();
  });

  Hooks.on("activateScene", () => {
    clearStagedHexcrawlMapOverlayState();
    destroyHexcrawlMapOverlay();
    scheduleRefresh();
  });

  Hooks.on("updateScene", (doc: { id?: string }, changed: { flags?: Record<string, unknown>; grid?: unknown }) => {
    const sceneId = doc?.id;
    if (!sceneId) return;
    if (changed.grid && getActiveSceneId() === sceneId) {
      scheduleRefresh(sceneId);
      return;
    }
    const flag = changed.flags?.[MODULE_ID] as Record<string, unknown> | undefined;
    if (!flag) return;
    if (
      !("hexcrawlSceneState" in flag) &&
      !("hexcrawlHexMap" in flag)
    ) {
      return;
    }
    if (getActiveSceneId() !== sceneId) return;
    scheduleRefresh(sceneId);
  });
}

/** @deprecated Use registerHexcrawlMapOverlay */
export const registerHexcrawlTrailOverlay = registerHexcrawlMapOverlay;

/** @deprecated Use refreshHexcrawlMapOverlay */
export const refreshHexcrawlTrailOverlay = refreshHexcrawlMapOverlay;

/** @deprecated Use destroyHexcrawlMapOverlay */
export const destroyHexcrawlTrailOverlay = destroyHexcrawlMapOverlay;
