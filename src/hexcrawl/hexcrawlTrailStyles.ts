import {
  DEFAULT_TRAIL_OVERLAY_COLOR,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { visibleTrailHexKeys } from "./hexAnnotations.js";

export type TrailStrokeStyle = {
  color: number;
  width: number;
  alpha: number;
};

export function parseTrailOverlayColor(hex: string | undefined): number {
  const normalized = (hex ?? DEFAULT_TRAIL_OVERLAY_COLOR).trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return Number.parseInt(DEFAULT_TRAIL_OVERLAY_COLOR.slice(1), 16);
  }
  return Number.parseInt(normalized, 16);
}

export function trailStyleForHex(hexKey: string, state: HexcrawlSceneState): TrailStrokeStyle {
  const baseColor = parseTrailOverlayColor(state.trailOverlayColor);
  if (hexKey === state.lastHexKey) {
    return { color: baseColor, width: 3, alpha: 0.95 };
  }
  if (hexKey === state.startingHexKey) {
    return { color: baseColor, width: 2, alpha: 0.6 };
  }
  return { color: baseColor, width: 2, alpha: 0.8 };
}

export function trailHexKeysForState(state: HexcrawlSceneState): string[] {
  return visibleTrailHexKeys(state);
}
