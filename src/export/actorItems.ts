export function getActorItems(actor: Actor): Item[] {
  const collection = actor.items as {
    contents?: Item[];
    map?: (fn: (item: Item) => Item) => Item[];
  };
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.map === "function") return collection.map((i) => i);
  return [];
}
