import hexIconsManifest from "../data/hexcrawl/hex-icons.json";
import { getUndiscoveredPoiAlpha } from "./hexcrawlSettings.js";
import {
  appendJourneyLog,
  appendTraveledHexKey,
  resolveTrailHexKeys,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import {
  normalizeTravelTerrainType,
  type TravelTerrainType,
} from "./travelRules.js";

export type HexPoiIcon = {
  id: string;
  label: string;
  path: string;
};

export type HexAnnotation = {
  terrain?: TravelTerrainType;
  iconId?: string;
  /** Solid fill hiding the hex map until players enter (overseer sets per-hex color). */
  hexCoverColor?: string;
};

export const DEFAULT_HEX_COVER_COLOR = "#808080";

export const HEX_POI_ICONS = hexIconsManifest as HexPoiIcon[];

const VALID_POI_ICON_IDS = new Set(HEX_POI_ICONS.map((row) => row.id));

const TERRAIN_BADGE_PATHS: Record<TravelTerrainType, string> = {
  open: "assets/hexcrawl/terrain-open.png",
  normal: "assets/hexcrawl/terrain-normal.png",
  rough: "assets/hexcrawl/terrain-rough.png",
  hard: "assets/hexcrawl/terrain-hard.png",
};

export function terrainBadgePath(terrain: TravelTerrainType): string {
  return TERRAIN_BADGE_PATHS[terrain];
}

export function poiIconById(iconId: string | undefined): HexPoiIcon | undefined {
  if (!iconId) return undefined;
  return HEX_POI_ICONS.find((row) => row.id === iconId);
}

export function normalizeHexCoverColor(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const hex = (raw & 0xffffff).toString(16).padStart(6, "0");
    return `#${hex}`;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  return undefined;
}

export function parseHexCoverColor(hex: string | undefined): number {
  const normalized = (hex ?? DEFAULT_HEX_COVER_COLOR).trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return Number.parseInt(DEFAULT_HEX_COVER_COLOR.slice(1), 16);
  }
  return Number.parseInt(normalized, 16);
}

function normalizeHexAnnotation(raw: unknown): HexAnnotation | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { terrain?: unknown; iconId?: unknown; hexCoverColor?: unknown };
  const annotation: HexAnnotation = {};
  if (row.terrain !== undefined && row.terrain !== null && row.terrain !== "") {
    annotation.terrain = normalizeTravelTerrainType(row.terrain);
  }
  if (typeof row.iconId === "string" && VALID_POI_ICON_IDS.has(row.iconId)) {
    annotation.iconId = row.iconId;
  }
  const coverColor = normalizeHexCoverColor(row.hexCoverColor);
  if (coverColor) annotation.hexCoverColor = coverColor;
  if (!annotation.terrain && !annotation.iconId && !annotation.hexCoverColor) return null;
  return annotation;
}

export function normalizeHexAnnotations(raw: unknown): Record<string, HexAnnotation> {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  const annotations: Record<string, HexAnnotation> = {};
  for (const [hexKey, value] of Object.entries(row)) {
    if (!hexKey || typeof hexKey !== "string") continue;
    const annotation = normalizeHexAnnotation(value);
    if (annotation) annotations[hexKey] = annotation;
  }
  return annotations;
}

export function normalizeHiddenTrailHexKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((key): key is string => typeof key === "string" && key.length > 0);
}

export function normalizeDiscoveredPoiHexKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of raw) {
    if (typeof key !== "string" || !key.length || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function mergeDiscoveredPoiHexKeys(a: string[], b: string[]): string[] {
  return normalizeDiscoveredPoiHexKeys([...a, ...b]);
}

export function hexHasDiscoverablePoi(
  state: Pick<HexcrawlSceneState, "hexAnnotations">,
  hexKey: string,
): boolean {
  return Boolean(state.hexAnnotations[hexKey]?.iconId);
}

export type PoiDiscovery = {
  hexKey: string;
  iconId: string;
  label: string;
};

/** Reveal a hex POI icon for players after the travel token enters that hex. */
export function discoverPoiOnHexEntry(
  state: HexcrawlSceneState,
  hexKey: string,
): { state: HexcrawlSceneState; discovered: PoiDiscovery | null } {
  if (!hexHasDiscoverablePoi(state, hexKey)) {
    return { state, discovered: null };
  }
  if (state.discoveredPoiHexKeys.includes(hexKey)) {
    return { state, discovered: null };
  }

  const iconId = state.hexAnnotations[hexKey]?.iconId;
  const poi = poiIconById(iconId);
  if (!iconId || !poi) {
    return { state, discovered: null };
  }

  const discovered: PoiDiscovery = {
    hexKey,
    iconId,
    label: poi.label,
  };
  const next = appendJourneyLog(
    {
      ...state,
      discoveredPoiHexKeys: [...state.discoveredPoiHexKeys, hexKey],
    },
    {
      kind: "poiDiscovered",
      travelDay: state.travelDay,
      hexKey,
      poiLabel: poi.label,
      note: iconId,
    },
  );
  return { state: next, discovered };
}

/** Overseers always see POI icons; players only see discovered hexes. */
export function shouldShowPoiIcon(
  state: Pick<HexcrawlSceneState, "hexAnnotations" | "discoveredPoiHexKeys">,
  hexKey: string,
  revealAll: boolean,
): boolean {
  if (!state.hexAnnotations[hexKey]?.iconId) return false;
  if (revealAll) return true;
  return state.discoveredPoiHexKeys.includes(hexKey);
}

export function poiDisplayAlpha(
  state: Pick<HexcrawlSceneState, "discoveredPoiHexKeys">,
  hexKey: string,
  revealAll: boolean,
  undiscoveredAlpha?: number,
): number {
  if (!revealAll) return 1;
  if (state.discoveredPoiHexKeys.includes(hexKey)) return 1;
  return undiscoveredAlpha ?? getUndiscoveredPoiAlpha();
}

export function hexHasCover(
  state: Pick<HexcrawlSceneState, "hexAnnotations">,
  hexKey: string,
): boolean {
  return Boolean(state.hexAnnotations[hexKey]?.hexCoverColor);
}

/** Delete the solid hex cover from scene data after the travel token enters that hex. */
export function revealHexCoverOnHexEntry(
  state: HexcrawlSceneState,
  hexKey: string,
): HexcrawlSceneState {
  if (!hexHasCover(state, hexKey)) return state;
  return setHexCover(state, hexKey, null);
}

/** Draw hex covers that still exist in annotations (removed on travel entry). */
export function shouldShowHexCover(
  state: Pick<HexcrawlSceneState, "hexAnnotations">,
  hexKey: string,
  _revealAll: boolean,
): boolean {
  return hexHasCover(state, hexKey);
}

/** POI reveal and hex-cover removal on travel token entry. */
export function applyHexEntryFogEffects(
  state: HexcrawlSceneState,
  hexKey: string,
): { state: HexcrawlSceneState; discovered: PoiDiscovery | null } {
  const poi = discoverPoiOnHexEntry(state, hexKey);
  return {
    state: revealHexCoverOnHexEntry(poi.state, hexKey),
    discovered: poi.discovered,
  };
}

export function resolveTerrainForHex(
  state: Pick<HexcrawlSceneState, "terrainType" | "hexAnnotations">,
  hexKey: string,
): TravelTerrainType {
  const override = state.hexAnnotations[hexKey]?.terrain;
  return override ?? state.terrainType;
}

export function visibleTrailHexKeys(
  state: Pick<
    HexcrawlSceneState,
    "traveledHexKeys" | "startingHexKey" | "trailCleared" | "hiddenTrailHexKeys"
  >,
): string[] {
  const hidden = new Set(state.hiddenTrailHexKeys);
  return resolveTrailHexKeys(state).filter((hexKey) => !hidden.has(hexKey));
}

export function isTrailHiddenForHex(
  state: Pick<HexcrawlSceneState, "hiddenTrailHexKeys">,
  hexKey: string,
): boolean {
  return state.hiddenTrailHexKeys.includes(hexKey);
}

export function setHexAnnotation(
  state: HexcrawlSceneState,
  hexKey: string,
  patch: Partial<HexAnnotation>,
): HexcrawlSceneState {
  const current = state.hexAnnotations[hexKey] ?? {};
  const next: HexAnnotation = { ...current };

  if ("terrain" in patch) {
    if (patch.terrain === undefined) {
      delete next.terrain;
    } else {
      next.terrain = normalizeTravelTerrainType(patch.terrain);
    }
  }

  if ("iconId" in patch) {
    if (!patch.iconId || !VALID_POI_ICON_IDS.has(patch.iconId)) {
      delete next.iconId;
    } else {
      next.iconId = patch.iconId;
    }
  }

  if ("hexCoverColor" in patch) {
    if (!patch.hexCoverColor) {
      delete next.hexCoverColor;
    } else {
      const coverColor = normalizeHexCoverColor(patch.hexCoverColor);
      if (coverColor) next.hexCoverColor = coverColor;
      else delete next.hexCoverColor;
    }
  }

  const hexAnnotations = { ...state.hexAnnotations };
  if (!next.terrain && !next.iconId && !next.hexCoverColor) {
    delete hexAnnotations[hexKey];
  } else {
    hexAnnotations[hexKey] = next;
  }

  return { ...state, hexAnnotations };
}

/** Assign or clear the POI icon on a hex (`null` clears). */
export function setHexPoiIcon(
  state: HexcrawlSceneState,
  hexKey: string,
  iconId: string | null,
): HexcrawlSceneState {
  return setHexAnnotation(state, hexKey, iconId ? { iconId } : { iconId: undefined });
}

export function extractHexCoverBaseline(
  annotations: Record<string, HexAnnotation>,
): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const [hexKey, row] of Object.entries(annotations)) {
    if (row.hexCoverColor) baseline[hexKey] = row.hexCoverColor;
  }
  return baseline;
}

export function normalizeHexCoverBaseline(
  annotationsRaw: unknown,
  baselineRaw: unknown,
): Record<string, string> {
  const baseline: Record<string, string> = {};
  if (baselineRaw && typeof baselineRaw === "object") {
    for (const [hexKey, value] of Object.entries(baselineRaw as Record<string, unknown>)) {
      const color = normalizeHexCoverColor(value);
      if (hexKey && color) baseline[hexKey] = color;
    }
  }
  if (Object.keys(baseline).length > 0) return baseline;
  return extractHexCoverBaseline(normalizeHexAnnotations(annotationsRaw));
}

export function syncHexCoverBaselineEntry(
  baseline: Record<string, string>,
  hexKey: string,
  color: string | null,
): Record<string, string> {
  const next = { ...baseline };
  if (color) next[hexKey] = color;
  else delete next[hexKey];
  return next;
}

/** Restore live hex covers from the persisted baseline (Reset Map). */
export function restoreHexCoversFromBaseline(state: HexcrawlSceneState): HexcrawlSceneState {
  let next = state;
  for (const [hexKey, color] of Object.entries(state.hexCoverBaseline)) {
    next = setHexCover(next, hexKey, color);
  }
  return next;
}

export function setHexCoverForEditor(
  state: HexcrawlSceneState,
  hexKey: string,
  color: string | null,
): HexcrawlSceneState {
  const next = setHexCover(state, hexKey, color);
  return {
    ...next,
    hexCoverBaseline: syncHexCoverBaselineEntry(
      state.hexCoverBaseline,
      hexKey,
      color ? (normalizeHexCoverColor(color) ?? null) : null,
    ),
  };
}

export function toggleHexCoverForEditor(
  state: HexcrawlSceneState,
  hexKey: string,
  defaultColor: string = DEFAULT_HEX_COVER_COLOR,
): HexcrawlSceneState {
  const current = state.hexAnnotations[hexKey]?.hexCoverColor;
  return setHexCoverForEditor(state, hexKey, current ? null : defaultColor);
}

/** Assign or clear the solid hex cover (`null` clears). */
export function setHexCover(
  state: HexcrawlSceneState,
  hexKey: string,
  color: string | null,
): HexcrawlSceneState {
  return setHexAnnotation(
    state,
    hexKey,
    color ? { hexCoverColor: color } : { hexCoverColor: undefined },
  );
}

export function toggleHexCover(
  state: HexcrawlSceneState,
  hexKey: string,
  defaultColor: string = DEFAULT_HEX_COVER_COLOR,
): HexcrawlSceneState {
  const current = state.hexAnnotations[hexKey]?.hexCoverColor;
  return setHexCover(state, hexKey, current ? null : defaultColor);
}

export function clearHexAnnotation(
  state: HexcrawlSceneState,
  hexKey: string,
): HexcrawlSceneState {
  if (!state.hexAnnotations[hexKey]) return state;
  const hexAnnotations = { ...state.hexAnnotations };
  delete hexAnnotations[hexKey];
  return { ...state, hexAnnotations };
}

export function hexHasMapEdits(
  state: Pick<HexcrawlSceneState, "hexAnnotations" | "hiddenTrailHexKeys">,
  hexKey: string,
): boolean {
  return Boolean(state.hexAnnotations[hexKey]) || state.hiddenTrailHexKeys.includes(hexKey);
}

/** Remove per-hex terrain, POI icon, and restore hidden travel trail on one hex. */
export function clearHexMapEdits(state: HexcrawlSceneState, hexKey: string): HexcrawlSceneState {
  if (!hexHasMapEdits(state, hexKey)) return state;
  const cleared = unhideTrailForHex(clearHexAnnotation(state, hexKey), hexKey);
  let next = cleared;
  if (cleared.discoveredPoiHexKeys.includes(hexKey)) {
    next = {
      ...next,
      discoveredPoiHexKeys: next.discoveredPoiHexKeys.filter((key) => key !== hexKey),
    };
  }
  if (state.hexCoverBaseline[hexKey]) {
    next = {
      ...next,
      hexCoverBaseline: syncHexCoverBaselineEntry(next.hexCoverBaseline, hexKey, null),
    };
  }
  return next;
}

export function hideTrailForHex(state: HexcrawlSceneState, hexKey: string): HexcrawlSceneState {
  if (state.hiddenTrailHexKeys.includes(hexKey)) return state;
  return {
    ...state,
    hiddenTrailHexKeys: [...state.hiddenTrailHexKeys, hexKey],
  };
}

export function unhideTrailForHex(state: HexcrawlSceneState, hexKey: string): HexcrawlSceneState {
  if (!state.hiddenTrailHexKeys.includes(hexKey)) return state;
  return {
    ...state,
    hiddenTrailHexKeys: state.hiddenTrailHexKeys.filter((key) => key !== hexKey),
  };
}

/** Hex keys that should render annotation overlays (terrain badge and/or POI icon). */
export function annotatedHexKeys(state: Pick<HexcrawlSceneState, "hexAnnotations">): string[] {
  return Object.keys(state.hexAnnotations);
}

export function resolveCurrentTravelTerrain(state: HexcrawlSceneState): TravelTerrainType {
  if (state.lastHexKey) return resolveTerrainForHex(state, state.lastHexKey);
  return state.terrainType;
}
