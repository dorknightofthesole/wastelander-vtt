/** Match Fallout's `name.slugify()` used for perk identifiers. */
export function slugifyName(name: string): string {
  const str = String(name) as string & { slugify?: () => string };
  if (typeof str.slugify === "function") {
    return str.slugify();
  }
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
