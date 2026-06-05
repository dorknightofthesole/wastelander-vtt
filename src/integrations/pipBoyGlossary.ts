import en from "../../lang/en.json";

/** Whole-word "Pip-Boy" only (does not match partial words). */
const PIP_BOY_RE = /\bPip-Boy\b/gi;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\r/g, "");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

function pipBoyTooltipText(): string {
  const glossary = (en as { WASTELANDER?: { Wizard?: { Glossary?: { PipBoy?: string } } } })
    .WASTELANDER?.Wizard?.Glossary?.PipBoy;
  return glossary ?? "";
}

/** Intro, bullet list, and closing paragraph for Foundry `data-tooltip-html`. */
function pipBoyTooltipHtml(): string {
  const raw = pipBoyTooltipText();
  if (!raw.trim()) return "";

  const blocks = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const allBullets = lines.length > 0 && lines.every((line) => line.startsWith("- "));
      if (allBullets) {
        const items = lines
          .map((line) => {
            const text = line.slice(2).trim();
            return `<li class="wastelander-pip-boy-glossary-tip">${escapeHtml(text)}</li>`;
          })
          .join("");
        return `<ul class="wastelander-pip-boy-glossary-list">${items}</ul>`;
      }
      return `<p class="wastelander-pip-boy-glossary-tip">${escapeHtml(block)}</p>`;
    })
    .join("");
}

let cachedTooltipHtml = "";

function tooltipHtmlAttr(): string {
  if (!cachedTooltipHtml) {
    cachedTooltipHtml = escapeAttr(pipBoyTooltipHtml());
  }
  return cachedTooltipHtml;
}

/**
 * Wrap "Pip-Boy" with a dotted underline and Foundry `data-tooltip-html` (item description).
 */
export function wrapPipBoyGlossary(text: string): string {
  if (!text || !pipBoyTooltipText().trim() || !PIP_BOY_RE.test(text)) {
    PIP_BOY_RE.lastIndex = 0;
    return text;
  }
  PIP_BOY_RE.lastIndex = 0;
  const tip = tooltipHtmlAttr();
  if (!tip) return text;
  return text.replace(
    PIP_BOY_RE,
    (match) =>
      `<span class="wastelander-pip-boy-glossary" data-tooltip-html="${tip}" data-tooltip-class="wastelander-pip-boy-glossary-tooltip">${match}</span>`,
  );
}
