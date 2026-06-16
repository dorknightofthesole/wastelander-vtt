export type GridBorderStyle = {
  color: number;
  alpha: number;
  width: number;
};

const DEFAULT_GRID_BORDER: GridBorderStyle = {
  color: 0x000000,
  alpha: 1,
  width: 1,
};

type GridStyleSource = {
  color?: unknown;
  alpha?: unknown;
  thickness?: unknown;
};

function normalizeAlpha(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(1, raw));
}

function normalizeThickness(raw: unknown): number | null {
  if (typeof raw !== "number" || !(raw > 0)) return null;
  return raw;
}

/** Parse Foundry ColorSource (#rrggbb, 0xRRGGBB, or Color) to a PIXI color number. */
export function parseColorSource(source: unknown): number | null {
  if (source === null || source === undefined) return null;
  if (typeof source === "number" && Number.isFinite(source)) {
    return source & 0xffffff;
  }
  if (typeof source === "string") {
    const trimmed = source.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
      return Number.parseInt(trimmed, 16);
    }
    return null;
  }
  if (typeof source === "object") {
    const css = (source as { css?: unknown }).css;
    if (typeof css === "string" && css.length > 0) {
      const fromCss = parseColorSource(css);
      if (fromCss !== null) return fromCss;
    }
    const numeric = Number(source);
    if (Number.isFinite(numeric)) {
      return numeric & 0xffffff;
    }
  }
  return null;
}

function mergeGridBorderStyles(sources: GridStyleSource[]): GridBorderStyle {
  let color: number | null = null;
  let alpha = DEFAULT_GRID_BORDER.alpha;
  let width = DEFAULT_GRID_BORDER.width;

  for (const source of sources) {
    const parsedColor = parseColorSource(source.color);
    if (parsedColor !== null) {
      color = parsedColor;
    }
    const parsedAlpha = normalizeAlpha(source.alpha);
    if (parsedAlpha !== null) {
      alpha = parsedAlpha;
    }
    const parsedWidth = normalizeThickness(source.thickness);
    if (parsedWidth !== null) {
      width = parsedWidth;
    }
  }

  return {
    color: color ?? DEFAULT_GRID_BORDER.color,
    alpha,
    width,
  };
}

function gridSourcesFromCanvas(): GridStyleSource[] {
  const canvas = (
    globalThis as {
      canvas?: {
        grid?: GridStyleSource;
        scene?: { id?: string; grid?: GridStyleSource };
      };
    }
  ).canvas;
  if (!canvas) return [];

  const sceneId = canvas.scene?.id;
  const sceneDoc = sceneId
    ? (
        game as {
          scenes?: { get: (id: string) => { grid?: GridStyleSource } | undefined };
        }
      ).scenes?.get(sceneId)
    : undefined;

  return [canvas.grid, canvas.scene?.grid, sceneDoc?.grid].filter(
    (source): source is GridStyleSource => Boolean(source),
  );
}

/** Match the active scene grid line color, alpha, and thickness; fall back to black. */
export function resolveGridBorderStyle(): GridBorderStyle {
  const sources = gridSourcesFromCanvas();
  if (!sources.length) return DEFAULT_GRID_BORDER;
  return mergeGridBorderStyles(sources);
}
