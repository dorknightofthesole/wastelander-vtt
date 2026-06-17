import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { getHexKeyFromCanvasPoint } from "./hexCoords.js";
import { refreshHexcrawlMapOverlay } from "./hexcrawlMapOverlay.js";
import {
  clearHexMapEditorSelectionState,
  getHexMapEditorSelection,
  setHexMapEditorSelectionState,
} from "./hexMapEditorState.js";

type CanvasLike = {
  ready?: boolean;
  scene?: { id?: string } | null;
  grid?: { isHexagonal?: boolean };
  stage?: unknown;
  background?: unknown;
  mousePosition?: { x: number; y: number };
  app?: { view?: HTMLCanvasElement };
  canvasCoordinatesFromClient?: (coords: { x: number; y: number }) => { x: number; y: number };
};

type PointerEventLike = {
  button?: number;
  pointerId?: number;
  data?: {
    getLocalPosition?: (layer: unknown) => { x: number; y: number };
  };
  clientX?: number;
  clientY?: number;
};

export type HexMapEditorCallbacks = {
  onSelect: (hexKey: string) => void;
  /** Drag across hexes to paint cover (additive brush). */
  onPaintHexCover?: (hexKey: string) => void;
  onPaintStrokeEnd?: () => void | Promise<void>;
  paintHexCoverEnabled?: boolean;
};

const POINTER_DOWN_EVENTS = ["pointerdown", "mousedown"] as const;
const POINTER_MOVE_EVENTS = ["pointermove", "mousemove"] as const;
const POINTER_UP_EVENTS = ["pointerup", "mouseup", "pointercancel"] as const;

let editorState: EditorState | null = null;
let canvasReadyHookInstalled = false;
let pointerDown = false;
let strokePainted = false;
let lastPaintedKey: string | null = null;
let activePointerId: number | null = null;

type EditorState = HexMapEditorCallbacks & {
  sceneId: string;
};

function getCanvas(): CanvasLike | null {
  return (globalThis as { canvas?: CanvasLike }).canvas ?? null;
}

function resolveCanvasPoint(event?: PointerEventLike): { x: number; y: number } | null {
  const canvas = getCanvas();
  if (!canvas?.ready) return null;

  if (event?.data?.getLocalPosition) {
    const layers = [canvas.grid, canvas.background, canvas.stage];
    for (const layer of layers) {
      if (!layer) continue;
      try {
        const pos = event.data.getLocalPosition(layer);
        if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
      } catch {
        // Try the next layer.
      }
    }
  }

  if (
    event &&
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY) &&
    typeof canvas.canvasCoordinatesFromClient === "function"
  ) {
    const pos = canvas.canvasCoordinatesFromClient({
      x: event.clientX!,
      y: event.clientY!,
    });
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) return pos;
  }

  const mouse = canvas.mousePosition;
  if (mouse && Number.isFinite(mouse.x) && Number.isFinite(mouse.y)) return mouse;
  return null;
}

function resolveHexKey(event?: PointerEventLike): string | null {
  if (!editorState || !currentUserIsOverseer()) return null;

  const canvas = getCanvas();
  if (!canvas?.ready || !canvas.grid?.isHexagonal) return null;
  if (canvas.scene?.id !== editorState.sceneId) return null;

  const point = resolveCanvasPoint(event);
  if (!point) return null;
  return getHexKeyFromCanvasPoint(point);
}

function handleCanvasPick(event?: PointerEventLike): void {
  const hexKey = resolveHexKey(event);
  if (!hexKey || !editorState) return;

  setHexMapEditorSelectionState(editorState.sceneId, hexKey);
  editorState.onSelect(hexKey);
  void refreshHexcrawlMapOverlay(editorState.sceneId);
}

function paintEnabled(): boolean {
  return Boolean(
    editorState?.onPaintHexCover && editorState.paintHexCoverEnabled !== false,
  );
}

function paintHexAtEvent(event: PointerEventLike): void {
  if (!pointerDown || !paintEnabled() || !editorState?.onPaintHexCover) return;

  const hexKey = resolveHexKey(event);
  if (!hexKey || hexKey === lastPaintedKey) return;

  lastPaintedKey = hexKey;
  strokePainted = true;
  editorState.onPaintHexCover(hexKey);
}

function onPointerDown(event: Event): void {
  if (!editorState) return;
  const pe = event as PointerEventLike;
  if (pe.button !== undefined && pe.button !== 0) return;

  pointerDown = true;
  strokePainted = false;
  lastPaintedKey = null;
  activePointerId = pe.pointerId ?? 0;

  const view = getCanvas()?.app?.view;
  if (
    view &&
    "setPointerCapture" in view &&
    typeof pe.pointerId === "number"
  ) {
    try {
      view.setPointerCapture(pe.pointerId);
    } catch {
      /* pointer capture unsupported */
    }
  }
}

function onPointerMove(event: Event): void {
  if (!pointerDown || !editorState) return;
  const pe = event as PointerEventLike;
  if (pe.pointerId !== undefined && pe.pointerId !== activePointerId) return;
  paintHexAtEvent(pe);
  if (strokePainted) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function finishPointerStroke(event: Event): void {
  if (!pointerDown || !editorState) return;
  const pe = event as PointerEventLike;
  if (pe.pointerId !== undefined && pe.pointerId !== activePointerId) return;

  pointerDown = false;
  activePointerId = null;

  const view = getCanvas()?.app?.view;
  if (
    view &&
    "releasePointerCapture" in view &&
    typeof pe.pointerId === "number"
  ) {
    try {
      view.releasePointerCapture(pe.pointerId);
    } catch {
      /* ignore */
    }
  }

  if (strokePainted) {
    void editorState.onPaintStrokeEnd?.();
  } else {
    handleCanvasPick(pe);
  }

  strokePainted = false;
  lastPaintedKey = null;
}

function attachCanvasDomListeners(): void {
  const view = getCanvas()?.app?.view;
  if (!view) return;

  for (const type of POINTER_DOWN_EVENTS) {
    view.removeEventListener(type, onPointerDown, true);
    view.addEventListener(type, onPointerDown, true);
  }
  for (const type of POINTER_MOVE_EVENTS) {
    view.removeEventListener(type, onPointerMove, true);
    view.addEventListener(type, onPointerMove, true);
  }
  for (const type of POINTER_UP_EVENTS) {
    view.removeEventListener(type, finishPointerStroke, true);
    view.addEventListener(type, finishPointerStroke, true);
  }
  window.removeEventListener("pointerup", finishPointerStroke, true);
  window.removeEventListener("mouseup", finishPointerStroke, true);
  window.addEventListener("pointerup", finishPointerStroke, true);
  window.addEventListener("mouseup", finishPointerStroke, true);
}

function detachCanvasDomListeners(): void {
  const view = getCanvas()?.app?.view;
  if (view) {
    for (const type of POINTER_DOWN_EVENTS) {
      view.removeEventListener(type, onPointerDown, true);
    }
    for (const type of POINTER_MOVE_EVENTS) {
      view.removeEventListener(type, onPointerMove, true);
    }
    for (const type of POINTER_UP_EVENTS) {
      view.removeEventListener(type, finishPointerStroke, true);
    }
  }
  window.removeEventListener("pointerup", finishPointerStroke, true);
  window.removeEventListener("mouseup", finishPointerStroke, true);

  pointerDown = false;
  strokePainted = false;
  lastPaintedKey = null;
  activePointerId = null;
}

function ensureCanvasReadyHook(): void {
  if (canvasReadyHookInstalled) return;
  canvasReadyHookInstalled = true;
  Hooks.on("canvasReady", () => {
    if (editorState) attachCanvasDomListeners();
  });
  Hooks.on("canvasTearDown", () => {
    detachCanvasDomListeners();
  });
}

export { getHexMapEditorSelection };

export function enableHexMapEditor(
  sceneId: string,
  callbacks: HexMapEditorCallbacks,
): void {
  ensureCanvasReadyHook();
  detachCanvasDomListeners();
  editorState = { sceneId, ...callbacks };
  attachCanvasDomListeners();
}

export function disableHexMapEditor(): void {
  const sceneId = editorState?.sceneId;
  detachCanvasDomListeners();
  editorState = null;
  if (sceneId) clearHexMapEditorSelectionState(sceneId);
}

export function clearHexMapEditorSelection(sceneId?: string): void {
  clearHexMapEditorSelectionState(sceneId);
  if (sceneId) void refreshHexcrawlMapOverlay(sceneId);
}

export function setHexMapEditorSelection(sceneId: string, hexKey: string | null): void {
  setHexMapEditorSelectionState(sceneId, hexKey);
  void refreshHexcrawlMapOverlay(sceneId);
}
