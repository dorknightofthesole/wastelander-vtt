import { MODULE_ID } from "../constants.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import { hexVerticesForKey } from "./hexCoords.js";
import { loadHexcrawlSceneState, type HexcrawlSceneState } from "./hexcrawlScenePersist.js";
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

type CanvasLike = {
  ready?: boolean;
  scene?: { id: string } | null;
  grid?: { isHexagonal?: boolean };
  tokens?: PixiContainer & { addChildAt?: (child: PixiContainer, index: number) => PixiContainer };
};

type PixiNamespace = {
  Container: new () => PixiContainer;
  Graphics: new () => PixiGraphics;
};

const TRAIL_CONTAINER_NAME = "wastelander-hexcrawl-trail";

let trailContainer: PixiContainer | null = null;
let boundSceneId: string | null = null;

function getCanvas(): CanvasLike | null {
  return (globalThis as { canvas?: CanvasLike }).canvas ?? null;
}

function getPixi(): PixiNamespace | null {
  return (globalThis as { PIXI?: PixiNamespace }).PIXI ?? null;
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

function ensureTrailContainer(): PixiContainer | null {
  const canvas = getCanvas();
  const PIXI = getPixi();
  if (!canvas?.ready || !canvas.tokens || !PIXI) return null;

  if (trailContainer && !trailContainer.destroyed) {
    return trailContainer;
  }

  trailContainer = new PIXI.Container();
  trailContainer.name = TRAIL_CONTAINER_NAME;
  trailContainer.eventMode = "none";
  trailContainer.interactiveChildren = false;

  if (typeof canvas.tokens.addChildAt === "function") {
    canvas.tokens.addChildAt(trailContainer, 0);
  } else {
    canvas.tokens.addChild(trailContainer as unknown as PixiGraphics);
  }

  return trailContainer;
}

function drawTrailForState(state: HexcrawlSceneState): void {
  const container = ensureTrailContainer();
  const PIXI = getPixi();
  if (!container || !PIXI) return;

  container.removeChildren();

  const hexKeys = trailHexKeysForState(state);
  if (!state.enabled || hexKeys.length === 0) return;

  for (const hexKey of hexKeys) {
    const vertices = hexVerticesForKey(hexKey);
    if (!vertices) continue;

    const style = trailStyleForHex(hexKey, state);
    const graphics = new PIXI.Graphics();
    strokeHexOutline(graphics, vertices, style.width, style.color, style.alpha);
    container.addChild(graphics);
  }
}

export function destroyHexcrawlTrailOverlay(): void {
  if (!trailContainer || trailContainer.destroyed) {
    trailContainer = null;
    boundSceneId = null;
    return;
  }

  trailContainer.destroy({ children: true });
  trailContainer = null;
  boundSceneId = null;
}

export function refreshHexcrawlTrailOverlay(sceneId?: string): void {
  const canvas = getCanvas();
  if (!canvas?.ready || !canvas.grid?.isHexagonal) {
    destroyHexcrawlTrailOverlay();
    return;
  }

  const activeSceneId = sceneId ?? getActiveSceneId() ?? canvas.scene?.id ?? null;
  if (!activeSceneId || canvas.scene?.id !== activeSceneId) {
    destroyHexcrawlTrailOverlay();
    return;
  }

  const state = loadHexcrawlSceneState(activeSceneId);
  if (!state?.enabled) {
    if (trailContainer && !trailContainer.destroyed) {
      trailContainer.removeChildren();
    }
    boundSceneId = activeSceneId;
    return;
  }

  boundSceneId = activeSceneId;
  drawTrailForState(state);
}

export function registerHexcrawlTrailOverlay(): void {
  Hooks.on("canvasReady", () => {
    refreshHexcrawlTrailOverlay();
  });

  Hooks.on("canvasTearDown", () => {
    destroyHexcrawlTrailOverlay();
  });

  Hooks.on("activateScene", () => {
    destroyHexcrawlTrailOverlay();
    refreshHexcrawlTrailOverlay();
  });

  Hooks.on("updateScene", (doc: { id?: string }, changed: { flags?: Record<string, unknown> }) => {
    const sceneId = doc?.id;
    if (!sceneId) return;
    const flag = changed.flags?.[MODULE_ID] as Record<string, unknown> | undefined;
    if (!flag || !("hexcrawlSceneState" in flag)) return;
    if (getActiveSceneId() !== sceneId) return;
    refreshHexcrawlTrailOverlay(sceneId);
  });
}
