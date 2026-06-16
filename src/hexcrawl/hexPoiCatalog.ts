import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import legacyHexIconsManifest from "../data/hexcrawl/hex-icons.json";
import { HEXCRAWL_SETTINGS } from "./hexcrawlSettings.js";

export type HexPoiIcon = {
  id: string;
  label: string;
  path: string;
};

const LEGACY_POI_ICONS = legacyHexIconsManifest as HexPoiIcon[];

export function normalizeWorldPoiIcons(raw: unknown): HexPoiIcon[] {
  if (!Array.isArray(raw)) return [];
  const icons: HexPoiIcon[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const entry = row as { id?: unknown; label?: unknown; path?: unknown };
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    if (typeof entry.label !== "string" || !entry.label.trim()) continue;
    if (typeof entry.path !== "string" || !entry.path.trim()) continue;
    const id = entry.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    icons.push({ id, label: entry.label.trim(), path: entry.path.trim() });
  }
  return icons;
}

export function getWorldPoiIcons(): HexPoiIcon[] {
  const settings = (game as { settings?: { get: (scope: string, key: string) => unknown } })
    .settings;
  if (!settings?.get) return [];
  return normalizeWorldPoiIcons(settings.get(MODULE_ID, HEXCRAWL_SETTINGS.hexPoiIcons));
}

export async function saveWorldPoiIcons(icons: HexPoiIcon[]): Promise<void> {
  const settings = (game as {
    settings?: { set: (scope: string, key: string, value: unknown) => Promise<unknown> };
  }).settings;
  if (!settings?.set) return;
  await settings.set(MODULE_ID, HEXCRAWL_SETTINGS.hexPoiIcons, normalizeWorldPoiIcons(icons));
}

export function poiIconById(iconId: string | undefined): HexPoiIcon | undefined {
  if (!iconId) return undefined;
  return (
    getWorldPoiIcons().find((row) => row.id === iconId) ??
    LEGACY_POI_ICONS.find((row) => row.id === iconId)
  );
}

/** True when an icon id can be stored on a hex (world catalog or legacy shipped icons). */
export function isStoredPoiIconId(iconId: string): boolean {
  return Boolean(poiIconById(iconId));
}

export function slugifyPoiId(label: string, taken: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "poi";
  let id = base;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function resolvePoiIconImageUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  if (trimmed.startsWith(`${MODULE_PATH}/`) || trimmed.startsWith("modules/")) {
    return trimmed;
  }
  if (trimmed.startsWith("assets/hexcrawl/hex-icons/")) {
    return `${MODULE_PATH}/${trimmed}`;
  }
  const base =
    (game as { data?: { files?: { baseURL?: string } } }).data?.files?.baseURL ??
    (globalThis as { ROUTE_PREFIX?: string }).ROUTE_PREFIX ??
    "";
  return `${base}${trimmed}`;
}

export function promptForPoiName(defaultName = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const DialogClass = (globalThis as { Dialog?: typeof Dialog }).Dialog;
    if (!DialogClass) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new DialogClass(
      {
        title: t("WASTELANDER.Hexcrawl.MapPoiNameTitle"),
        content: `<div class="form-group">
          <label>${t("WASTELANDER.Hexcrawl.MapPoiNameLabel")}</label>
          <input type="text" name="poiName" value="${foundry.utils.escapeHTML(defaultName)}" autofocus />
        </div>`,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("Confirm"),
            callback: (html: JQuery) => {
              const value = String(html.find('[name="poiName"]').val() ?? "").trim();
              finish(value || null);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: () => finish(null),
          },
        },
        default: "ok",
        close: () => finish(null),
      },
      { width: 420 },
    );
    dialog.render(true);
  });
}

export function pickImageFilePath(): Promise<string | null> {
  return new Promise((resolve) => {
    const FilePickerClass = (globalThis as { FilePicker?: typeof FilePicker }).FilePicker;
    if (!FilePickerClass) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    new FilePickerClass({
      type: "image",
      callback: (path: string) => finish(path?.trim() ? path.trim() : null),
    }).render(true);
  });
}

export async function addWorldPoiIconFromPicker(): Promise<HexPoiIcon | null> {
  const path = await pickImageFilePath();
  if (!path) return null;

  const defaultName = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const label = await promptForPoiName(defaultName);
  if (!label) return null;

  const icons = getWorldPoiIcons();
  const taken = new Set(icons.map((row) => row.id));
  const icon: HexPoiIcon = {
    id: slugifyPoiId(label, taken),
    label,
    path,
  };
  await saveWorldPoiIcons([icon, ...icons]);
  return icon;
}

export async function removeWorldPoiIcon(iconId: string): Promise<boolean> {
  const icons = getWorldPoiIcons();
  const next = icons.filter((row) => row.id !== iconId);
  if (next.length === icons.length) return false;
  await saveWorldPoiIcons(next);
  return true;
}
