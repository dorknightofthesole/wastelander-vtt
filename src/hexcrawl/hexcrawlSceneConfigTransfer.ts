import { MODULE_ID } from "../constants.js";
import {
  getWorldPoiIcons,
  saveWorldPoiIcons,
  type HexPoiIcon,
} from "./hexPoiCatalog.js";
import {
  normalizeHexAnnotations,
  normalizeHexCoverBaseline,
  normalizeHiddenTrailHexKeys,
  restoreHexCoversFromBaseline,
} from "./hexAnnotations.js";
import { stageHexcrawlMapOverlayState } from "./hexMapOverlayState.js";
import {
  defaultHexcrawlState,
  loadHexcrawlSceneState,
  persistHexMapFlag,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
  type SceneCardinal,
  type SceneLinks,
} from "./hexcrawlScenePersist.js";
import {
  normalizeTravelEventMode,
  normalizeTravelTerrainType,
  type TravelEventMode,
  type TravelTerrainType,
} from "./travelRules.js";

export const HEXCRAWL_CONFIG_EXPORT_VERSION = 1;

const SCENE_CARDINALS: SceneCardinal[] = ["north", "south", "east", "west"];

export type HexcrawlSceneMapConfig = {
  enabled: boolean;
  travelEventMode: TravelEventMode;
  terrainType: TravelTerrainType;
  navigationConditionId: string;
  baseDifficulty: number;
  trailOverlayColor: string;
  sceneLinks: SceneLinks;
  hexAnnotations: HexcrawlSceneState["hexAnnotations"];
  hexCoverBaseline: HexcrawlSceneState["hexCoverBaseline"];
  hiddenTrailHexKeys: string[];
  showTerrainIcons: boolean;
  showHexCoords: boolean;
};

export type HexcrawlConfigExportScene = {
  name: string;
  foundrySceneId?: string;
  config: HexcrawlSceneMapConfig;
};

export type HexcrawlConfigExportBundle = {
  formatVersion: typeof HEXCRAWL_CONFIG_EXPORT_VERSION;
  moduleId: string;
  exportedAt: number;
  rootSceneName: string;
  poiIcons: HexPoiIcon[];
  scenes: HexcrawlConfigExportScene[];
};

export type ImportHexcrawlConfigResult =
  | { ok: true; idMismatch?: boolean; state: HexcrawlSceneState }
  | {
      ok: false;
      reason:
        | "no_match"
        | "invalid_version"
        | "invalid_bundle"
        | "scene_not_found"
        | "save_failed";
    };

function normalizeTrailOverlayColor(raw: unknown): string {
  if (typeof raw !== "string") return "#863e0e";
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return "#863e0e";
}

function normalizeSceneMapConfig(
  raw: unknown,
  options?: { allowedPoiIconIds?: ReadonlySet<string> },
): HexcrawlSceneMapConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const hexAnnotations = normalizeHexAnnotations(row.hexAnnotations, options);
  return {
    enabled: row.enabled === true,
    travelEventMode: normalizeTravelEventMode(row.travelEventMode),
    terrainType: normalizeTravelTerrainType(row.terrainType),
    navigationConditionId:
      typeof row.navigationConditionId === "string" && row.navigationConditionId.trim()
        ? row.navigationConditionId.trim()
        : "clear-trail",
    baseDifficulty:
      typeof row.baseDifficulty === "number" && Number.isFinite(row.baseDifficulty)
        ? row.baseDifficulty
        : 1,
    trailOverlayColor: normalizeTrailOverlayColor(row.trailOverlayColor),
    sceneLinks: normalizeSceneLinksByName(row.sceneLinks),
    hexAnnotations,
    hexCoverBaseline: normalizeHexCoverBaseline(hexAnnotations, row.hexCoverBaseline),
    hiddenTrailHexKeys: normalizeHiddenTrailHexKeys(row.hiddenTrailHexKeys),
    showTerrainIcons: row.showTerrainIcons !== false,
    showHexCoords: row.showHexCoords === true,
  };
}

function normalizeSceneLinksByName(raw: unknown): SceneLinks {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  const links: SceneLinks = {};
  for (const direction of SCENE_CARDINALS) {
    const value = row[direction];
    if (typeof value === "string" && value.trim().length > 0) {
      links[direction] = value.trim();
    }
  }
  return links;
}

export function parseHexcrawlConfigBundle(raw: unknown): HexcrawlConfigExportBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.formatVersion !== HEXCRAWL_CONFIG_EXPORT_VERSION) return null;
  if (typeof row.moduleId !== "string" || !row.moduleId.trim()) return null;
  if (typeof row.rootSceneName !== "string" || !row.rootSceneName.trim()) return null;
  if (!Array.isArray(row.scenes) || row.scenes.length === 0) return null;

  const scenes: HexcrawlConfigExportScene[] = [];
  for (const entry of row.scenes) {
    if (!entry || typeof entry !== "object") return null;
    const sceneRow = entry as Record<string, unknown>;
    if (typeof sceneRow.name !== "string" || !sceneRow.name.trim()) return null;
    const config = normalizeSceneMapConfig(sceneRow.config);
    if (!config) return null;
    scenes.push({
      name: sceneRow.name.trim(),
      foundrySceneId:
        typeof sceneRow.foundrySceneId === "string" && sceneRow.foundrySceneId.trim()
          ? sceneRow.foundrySceneId.trim()
          : undefined,
      config,
    });
  }

  const poiIconsRaw = Array.isArray(row.poiIcons) ? row.poiIcons : [];
  const poiIcons: HexPoiIcon[] = [];
  const seenPoiIds = new Set<string>();
  for (const icon of poiIconsRaw) {
    if (!icon || typeof icon !== "object") continue;
    const iconRow = icon as Record<string, unknown>;
    if (typeof iconRow.id !== "string" || !iconRow.id.trim()) continue;
    if (typeof iconRow.label !== "string" || !iconRow.label.trim()) continue;
    if (typeof iconRow.path !== "string" || !iconRow.path.trim()) continue;
    const id = iconRow.id.trim();
    if (seenPoiIds.has(id)) continue;
    seenPoiIds.add(id);
    poiIcons.push({
      id,
      label: iconRow.label.trim(),
      path: iconRow.path.trim(),
    });
  }

  return {
    formatVersion: HEXCRAWL_CONFIG_EXPORT_VERSION,
    moduleId: row.moduleId.trim(),
    exportedAt: typeof row.exportedAt === "number" ? row.exportedAt : Date.now(),
    rootSceneName: row.rootSceneName.trim(),
    poiIcons,
    scenes,
  };
}

export function sceneLinksToNames(
  links: SceneLinks,
  currentSceneId: string,
  resolveSceneName: (sceneId: string) => string | undefined,
): SceneLinks {
  const result: SceneLinks = {};
  for (const direction of SCENE_CARDINALS) {
    const targetId = links[direction];
    if (!targetId || targetId === currentSceneId) continue;
    const name = resolveSceneName(targetId);
    if (name) result[direction] = name;
  }
  return result;
}

export function sceneLinksFromNames(
  links: SceneLinks,
  currentSceneId: string,
  resolveSceneId: (sceneName: string) => string | undefined,
): SceneLinks {
  const result: SceneLinks = {};
  for (const direction of SCENE_CARDINALS) {
    const name = links[direction];
    if (!name?.trim()) continue;
    const id = resolveSceneId(name.trim());
    if (!id || id === currentSceneId) continue;
    result[direction] = id;
  }
  return result;
}

export function collectLinkedSceneIds(
  rootId: string,
  getSceneLinks: (sceneId: string) => SceneLinks = (id) => {
    const state = loadHexcrawlSceneState(id) ?? defaultHexcrawlState(id);
    return state.sceneLinks;
  },
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [rootId];
  visited.add(rootId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const links = getSceneLinks(current);
    for (const direction of SCENE_CARDINALS) {
      const targetId = links[direction];
      if (targetId && !visited.has(targetId)) {
        visited.add(targetId);
        queue.push(targetId);
      }
    }
  }

  return [...visited];
}

export function buildSceneMapConfig(
  state: HexcrawlSceneState,
  sceneLinksByName: SceneLinks,
): HexcrawlSceneMapConfig {
  const restored = restoreHexCoversFromBaseline(state);
  return {
    enabled: restored.enabled,
    travelEventMode: restored.travelEventMode,
    terrainType: restored.terrainType,
    navigationConditionId: restored.navigationConditionId,
    baseDifficulty: restored.baseDifficulty,
    trailOverlayColor: restored.trailOverlayColor,
    sceneLinks: sceneLinksByName,
    hexAnnotations: structuredClone(restored.hexAnnotations),
    hexCoverBaseline: structuredClone(restored.hexCoverBaseline),
    hiddenTrailHexKeys: [...restored.hiddenTrailHexKeys],
    showTerrainIcons: restored.showTerrainIcons,
    showHexCoords: restored.showHexCoords,
  };
}

export function applyMapConfigImport(
  existing: HexcrawlSceneState,
  imported: HexcrawlSceneMapConfig,
  sceneLinksById: SceneLinks,
): HexcrawlSceneState {
  return {
    ...existing,
    enabled: imported.enabled,
    travelEventMode: imported.travelEventMode,
    terrainType: imported.terrainType,
    navigationConditionId: imported.navigationConditionId,
    baseDifficulty: imported.baseDifficulty,
    currentDifficulty: imported.baseDifficulty,
    trailOverlayColor: imported.trailOverlayColor,
    sceneLinks: sceneLinksById,
    hexAnnotations: structuredClone(imported.hexAnnotations),
    hexCoverBaseline: structuredClone(imported.hexCoverBaseline),
    hiddenTrailHexKeys: [...imported.hiddenTrailHexKeys],
    showTerrainIcons: imported.showTerrainIcons,
    showHexCoords: imported.showHexCoords,
    updatedAt: Date.now(),
  };
}

function collectPoiIconIdsFromConfig(config: HexcrawlSceneMapConfig): Set<string> {
  const ids = new Set<string>();
  for (const annotation of Object.values(config.hexAnnotations)) {
    if (annotation.iconId) ids.add(annotation.iconId);
  }
  return ids;
}

export function buildHexcrawlConfigExport(rootSceneId: string): HexcrawlConfigExportBundle | null {
  const scenesApi = (game as { scenes?: { get: (id: string) => { id: string; name: string } | undefined } })
    .scenes;
  const rootScene = scenesApi?.get(rootSceneId);
  if (!rootScene) return null;

  const sceneIds = collectLinkedSceneIds(rootSceneId);
  const exportedScenes: HexcrawlConfigExportScene[] = [];
  const poiIconIds = new Set<string>();

  for (const sceneId of sceneIds) {
    const doc = scenesApi?.get(sceneId);
    if (!doc) continue;
    const state = loadHexcrawlSceneState(sceneId) ?? defaultHexcrawlState(sceneId);
    const sceneLinksByName = sceneLinksToNames(
      state.sceneLinks,
      sceneId,
      (id) => scenesApi?.get(id)?.name,
    );
    const config = buildSceneMapConfig(state, sceneLinksByName);
    for (const iconId of collectPoiIconIdsFromConfig(config)) {
      poiIconIds.add(iconId);
    }
    exportedScenes.push({
      name: doc.name,
      foundrySceneId: sceneId,
      config,
    });
  }

  const poiIcons = getWorldPoiIcons().filter((icon) => poiIconIds.has(icon.id));

  return {
    formatVersion: HEXCRAWL_CONFIG_EXPORT_VERSION,
    moduleId: MODULE_ID,
    exportedAt: Date.now(),
    rootSceneName: rootScene.name,
    poiIcons,
    scenes: exportedScenes,
  };
}

export async function mergePoiIconsFromExport(icons: HexPoiIcon[]): Promise<void> {
  if (!icons.length) return;
  const existing = getWorldPoiIcons();
  const existingIds = new Set(existing.map((icon) => icon.id));
  const toAdd = icons.filter((icon) => !existingIds.has(icon.id));
  if (!toAdd.length) return;
  await saveWorldPoiIcons([...toAdd, ...existing]);
}

export async function importHexcrawlConfigForScene(
  sceneId: string,
  bundleRaw: unknown,
): Promise<ImportHexcrawlConfigResult> {
  const row = bundleRaw as Record<string, unknown> | null;
  if (row && typeof row === "object" && row.formatVersion !== HEXCRAWL_CONFIG_EXPORT_VERSION) {
    return { ok: false, reason: "invalid_version" };
  }

  const bundle = parseHexcrawlConfigBundle(bundleRaw);
  if (!bundle) return { ok: false, reason: "invalid_bundle" };

  const scenesApi = (game as {
    scenes?: {
      get: (id: string) => { id: string; name: string } | undefined;
      find?: (predicate: (scene: { id: string; name: string }) => boolean) => { id: string } | undefined;
    };
  }).scenes;
  const scene = scenesApi?.get(sceneId);
  if (!scene) return { ok: false, reason: "scene_not_found" };

  const entry = bundle.scenes.find((row) => row.name === scene.name);
  if (!entry) return { ok: false, reason: "no_match" };

  await mergePoiIconsFromExport(bundle.poiIcons);

  const allowedPoiIconIds = new Set([
    ...bundle.poiIcons.map((icon) => icon.id),
    ...getWorldPoiIcons().map((icon) => icon.id),
  ]);
  const rawScenes = Array.isArray(row?.scenes) ? row.scenes : [];
  const rawEntry = rawScenes.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as { name?: unknown }).name === scene.name,
  );
  const config =
    rawEntry && typeof rawEntry === "object"
      ? normalizeSceneMapConfig((rawEntry as { config?: unknown }).config, {
          allowedPoiIconIds,
        })
      : null;
  if (!config) return { ok: false, reason: "invalid_bundle" };

  const idMismatch = Boolean(entry.foundrySceneId && entry.foundrySceneId !== sceneId);
  const existing = loadHexcrawlSceneState(sceneId) ?? defaultHexcrawlState(sceneId);
  const sceneLinksById = sceneLinksFromNames(
    config.sceneLinks,
    sceneId,
    (name) => scenesApi?.find?.((doc) => doc.name === name)?.id,
  );
  const next = restoreHexCoversFromBaseline(
    applyMapConfigImport(existing, config, sceneLinksById),
  );

  const mapWritten = await persistHexMapFlag(sceneId, {
    hexAnnotations: next.hexAnnotations,
    hexCoverBaseline: next.hexCoverBaseline,
    hiddenTrailHexKeys: next.hiddenTrailHexKeys,
    showTerrainIcons: next.showTerrainIcons,
    showHexCoords: next.showHexCoords,
    mapDestination: existing.mapDestination,
  });
  if (!mapWritten) return { ok: false, reason: "save_failed" };

  const saved = await saveHexcrawlSceneState(next, { writeHexMap: false });
  if (!saved) return { ok: false, reason: "save_failed" };

  stageHexcrawlMapOverlayState(saved);

  return { ok: true, idMismatch, state: saved };
}

export function slugifySceneFilename(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scene";
  return slug;
}

export function hexcrawlConfigExportFilename(sceneName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `hexcrawl-${slugifySceneFilename(sceneName)}-${date}.json`;
}

export function downloadHexcrawlConfigExport(
  bundle: HexcrawlConfigExportBundle,
  filename: string,
): void {
  const json = JSON.stringify(bundle, null, 2);
  const saveDataToFile = (
    globalThis as { foundry?: { utils?: { saveDataToFile?: (data: string, type: string, name: string) => void } } }
  ).foundry?.utils?.saveDataToFile;
  if (typeof saveDataToFile === "function") {
    saveDataToFile(json, "application/json", filename);
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function pickLocalJsonFile(): Promise<unknown | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";

    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }

      const readTextFromFile = (
        globalThis as { foundry?: { utils?: { readTextFromFile?: (file: File) => Promise<string> } } }
      ).foundry?.utils?.readTextFromFile;

      if (typeof readTextFromFile === "function") {
        void readTextFromFile(file)
          .then((text) => finish(JSON.parse(text) as unknown))
          .catch(() => finish(null));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          finish(JSON.parse(String(reader.result)) as unknown);
        } catch {
          finish(null);
        }
      };
      reader.onerror = () => finish(null);
      reader.readAsText(file);
    });

    document.body.appendChild(input);
    input.click();
  });
}

export function pickJsonFile(): Promise<unknown | null> {
  return pickLocalJsonFile();
}
