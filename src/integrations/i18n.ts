import en from "../../lang/en.json";

function flattenTranslations(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[path] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        result,
        flattenTranslations(value as Record<string, unknown>, path),
      );
    }
  }
  return result;
}

const FLAT_EN = flattenTranslations(en as Record<string, unknown>);

/** Register bundled strings so labels work even if lang/en.json is not on disk. */
export function registerTranslations(): void {
  const lang = game.i18n.lang ?? "en";
  if (!game.i18n.translations[lang]) {
    game.i18n.translations[lang] = {};
  }
  foundry.utils.mergeObject(game.i18n.translations[lang], FLAT_EN, {
    insertKeys: true,
    overwrite: true,
  });
}

function isMissingTranslation(value: string, key: string): boolean {
  if (!value || value === key) return true;
  return value.toUpperCase() === key.toUpperCase();
}

/** Last path segment, title-cased (e.g. SurvivorTwoTraits → Survivor Two Traits). */
export function fallbackLabel(key: string): string {
  const last = key.split(".").pop() ?? key;
  return last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Localize a WASTELANDER key. If missing, show only the final segment (humanized).
 */
export function t(
  key: string,
  data?: Record<string, string | number | boolean>,
): string {
  const fullKey = key.startsWith("WASTELANDER.") ? key : `WASTELANDER.${key}`;
  const value = data
    ? String(game.i18n.format(fullKey, data))
    : game.i18n.localize(fullKey);
  if (isMissingTranslation(value, fullKey)) {
    return fallbackLabel(fullKey);
  }
  return value;
}
