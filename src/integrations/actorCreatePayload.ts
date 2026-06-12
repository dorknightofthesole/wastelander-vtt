/** Allowed top-level keys when creating owned Items (v13 rejects unknown embedded keys). */
const ITEM_CREATE_ALLOW_KEYS = new Set([
  "name",
  "type",
  "img",
  "system",
  "flags",
  "_stats",
]);

/**
 * Strip compendium/export noise so only schema-safe keys reach createDocuments.
 * Foundry v13 treats other top-level keys (e.g. `actors`) as embedded collections.
 */
export function whitelistItemCreatePayload(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of ITEM_CREATE_ALLOW_KEYS) {
    if (raw[key] === undefined) continue;
    payload[key] = foundry.utils.deepClone(raw[key]);
  }
  return payload;
}

/** Minimal Actor.create payload — never pass folder/items/flags on initial create. */
export function buildMinimalActorCreatePayload(params: {
  name: string;
  type: string;
  system?: Record<string, unknown>;
  img?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: params.name.trim(),
    type: params.type,
    system: foundry.utils.deepClone(params.system ?? {}),
  };
  if (params.img) payload.img = params.img;
  return payload;
}
