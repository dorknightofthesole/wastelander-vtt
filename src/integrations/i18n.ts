import en from "../../lang/en.json";
import { wrapTagSkillGlossary } from "./tagSkillGlossary.js";

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

/** Replace `{key}` placeholders (Foundry-style) in bundled / merged strings. */
function formatString(
  template: string,
  data: Record<string, string | number | boolean>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    const value = data[placeholder];
    return value !== undefined && value !== null ? String(value) : `{${placeholder}}`;
  });
}

export interface LocalizeOptions {
  /** When false, do not wrap "tag" / "tags" with glossary tooltips. */
  glossary?: boolean;
}

/**
 * Localize a WASTELANDER key. If missing, show only the final segment (humanized).
 * Interpolation uses `{name}`-style placeholders (not `game.i18n.format`, which fails on flat merges).
 */
export function t(
  key: string,
  data?: Record<string, string | number | boolean>,
  options: LocalizeOptions = {},
): string {
  const fullKey = key.startsWith("WASTELANDER.") ? key : `WASTELANDER.${key}`;
  // Prefer bundled strings so Foundry localize/format does not strip unfilled `{placeholders}`.
  let template = FLAT_EN[fullKey];
  if (!template) {
    template = game.i18n.localize(fullKey);
    if (isMissingTranslation(template, fullKey)) {
      template = fallbackLabel(fullKey);
    }
  }
  const resolved = data ? formatString(template, data) : template;
  if (options.glossary === false) return resolved;
  return wrapTagSkillGlossary(resolved);
}
