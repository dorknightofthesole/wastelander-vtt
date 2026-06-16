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
  data?: {
    getLocalPosition?: (layer: unknown) => { x: number; y: number };
  };
  clientX?: number;
  clientY?: number;
};

type EditorState = {
  sceneId: string;
  onSelect: (hexKey: string) => void;
};

const CANVAS_DOM_EVENTS = ["pointerdown", "mousedown"] as const;

let editorState: EditorState | null = null;
let canvasReadyHookInstalled = false;

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

function handleCanvasPick(event?: PointerEventLike): void {
  if (!editorState || !currentUserIsOverseer()) return;

  const canvas = getCanvas();
  if (!canvas?.ready || !canvas.grid?.isHexagonal) return;
  if (canvas.scene?.id !== editorState.sceneId) return;

  const point = resolveCanvasPoint(event);
  if (!point) return;

  const hexKey = getHexKeyFromCanvasPoint(point);
  if (!hexKey) return;

  setHexMapEditorSelectionState(editorState.sceneId, hexKey);
  editorState.onSelect(hexKey);
  void refreshHexcrawlMapOverlay(editorState.sceneId);
}

function onCanvasDomPointerDown(event: Event): void {
  if (!editorState) return;
  handleCanvasPick(event as PointerEventLike);
}

function attachCanvasDomListeners(): void {
  const view = getCanvas()?.app?.view;
  if (!view) return;
  for (const type of CANVAS_DOM_EVENTS) {
    view.removeEventListener(type, onCanvasDomPointerDown, true);
    view.addEventListener(type, onCanvasDomPointerDown, true);
  }
}

function detachCanvasDomListeners(): void {
  const view = getCanvas()?.app?.view;
  if (!view) return;
  for (const type of CANVAS_DOM_EVENTS) {
    view.removeEventListener(type, onCanvasDomPointerDown, true);
  }
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
  onSelect: (hexKey: string) => void,
): void {
  ensureCanvasReadyHook();
  detachCanvasDomListeners();
  editorState = { sceneId, onSelect };
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
