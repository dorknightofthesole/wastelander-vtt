/**
 * Resolve Fallout compendium items by display name (exact match).
 */
export async function findCompendiumUuidByName(
  packId: string,
  name: string,
  itemType?: string,
): Promise<string | null> {
  const pack = game.packs.get(packId);
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ["uuid", "name", "type"] });
  const lower = name.toLowerCase();
  const match = index.find((e) => {
    if (String(e.name).toLowerCase() !== lower) return false;
    if (!itemType) return true;
    return String((e as { type?: string }).type ?? "") === itemType;
  });
  return match ? String((match as { uuid?: string }).uuid ?? "") : null;
}
