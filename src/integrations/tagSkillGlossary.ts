import en from "../../lang/en.json";

/** Whole-word "tag" / "tags" only (does not match tagline, tagged, holotags, etc.). */
const TAG_WORD_RE = /\b(tags?)\b/gi;

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

function tagSkillTooltipText(): string {
  const glossary = (en as { WASTELANDER?: { Wizard?: { Glossary?: { TagSkill?: string } } } })
    .WASTELANDER?.Wizard?.Glossary?.TagSkill;
  return (
    glossary ??
    "A few of your skills are Tag skills, marking them as your areas of expertise. Tag skills increase your chances of a critical success."
  );
}

/** Two paragraphs with first-line indent; rendered via Foundry `data-tooltip-html`. */
function tagSkillTooltipHtml(): string {
  const raw = tagSkillTooltipText();
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) {
    return `<p class="wastelander-tag-glossary-tip">${escapeHtml(raw)}</p>`;
  }
  return paragraphs
    .map((p) => `<p class="wastelander-tag-glossary-tip">${escapeHtml(p)}</p>`)
    .join("");
}

let cachedTooltipHtml = "";

function tooltipHtmlAttr(): string {
  if (!cachedTooltipHtml) {
    cachedTooltipHtml = escapeAttr(tagSkillTooltipHtml());
  }
  return cachedTooltipHtml;
}

/**
 * Wrap standalone "tag" / "tags" with a dotted underline and Foundry `data-tooltip`.
 */
export function wrapTagSkillGlossary(text: string): string {
  if (!text || !TAG_WORD_RE.test(text)) {
    TAG_WORD_RE.lastIndex = 0;
    return text;
  }
  TAG_WORD_RE.lastIndex = 0;
  const tip = tooltipHtmlAttr();
  return text.replace(
    TAG_WORD_RE,
    (match) =>
      `<span class="wastelander-tag-glossary" data-tooltip-html="${tip}" data-tooltip-class="wastelander-tag-glossary-tooltip">${match}</span>`,
  );
}

/** Plain text for HTML `title` attributes (no markup). */
export function stripTagSkillGlossaryMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}
