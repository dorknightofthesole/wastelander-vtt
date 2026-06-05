/** Foundry v13+ TextEditor (avoids deprecated global). */
export function getTextEditor(): {
  enrichHTML: (content: string, options?: { async?: boolean }) => Promise<string>;
} {
  return foundry.applications.ux.TextEditor.implementation;
}

export async function enrichHtml(
  content: string,
): Promise<string> {
  if (!content) return "";
  return getTextEditor().enrichHTML(content, { async: true });
}

/**
 * Run Fallout system text enrichers (e.g. `1 CD` → combat die icon, `@fos[CD]`).
 * Wrap in `.fallout` so system icon font rules apply outside actor sheets.
 */
export async function enrichFalloutHtml(content: string): Promise<string> {
  if (!content) return "";
  const enriched = await enrichHtml(content);
  return `<span class="fallout wastelander-fallout-enrich">${enriched}</span>`;
}
