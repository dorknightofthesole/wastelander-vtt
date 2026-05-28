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
