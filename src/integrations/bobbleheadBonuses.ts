import { MODULE_ID } from "../constants.js";
import {
  isBobbleheadEligibleActor,
  resolveBobbleheadBonus,
  specialAttributeLabel,
  type BobbleheadBonus,
} from "./bobbleheadCatalog.js";
import {
  registerBobbleheadSettings,
  shouldShowBobbleheadImage,
} from "./bobbleheadSettings.js";
import { getWorldActor, refreshActorSheet, resolveActorId } from "./falloutActor.js";

const SILENT = { render: false } as const;
const BOBBLEHEAD_EFFECT_ITEM_FLAG = "bobbleheadEffectForItemId";
const DEFAULT_BOBBLEHEAD_ICON = "systems/fallout/assets/icons/items/miscellany.svg";

/** Prevents renderActorSheet from re-entering reconcile during our own sheet refresh. */
let suppressSheetBobbleheadReconcile = false;

/** Prevents overlapping reconcile passes on the same actor (e.g. createItem + renderActorSheet). */
const reconcilingActorIds = new Set<string>();

type ActiveEffectChange = {
  key?: string;
  mode?: number;
  value?: string | number;
};

function activeEffectAddMode(): number {
  return CONST.ACTIVE_EFFECT_MODES.ADD;
}

function readBobbleheadEffectItemId(effect: ActiveEffect): string | undefined {
  const itemId = effect.getFlag(MODULE_ID, BOBBLEHEAD_EFFECT_ITEM_FLAG);
  return typeof itemId === "string" && itemId.length > 0 ? itemId : undefined;
}

function listBobbleheadEffects(actor: Actor): ActiveEffect[] {
  return actor.effects.filter((effect) => Boolean(readBobbleheadEffectItemId(effect)));
}

function resolveBobbleheadWorldActor(actor: Actor): Actor | null {
  if (!actor?.id) return null;
  try {
    return getWorldActor(resolveActorId(actor));
  } catch {
    const fromSidebar = game.actors.get(actor.id);
    if (fromSidebar && !fromSidebar.isToken) return fromSidebar;
    return null;
  }
}

function buildBobbleheadEffectData(
  item: Item,
  bonus: BobbleheadBonus,
  actor: Actor,
): Record<string, unknown> {
  const label = specialAttributeLabel(bonus.attribute);
  return {
    name: `${item.name} (+1 ${label})`,
    icon: item.img?.trim() || DEFAULT_BOBBLEHEAD_ICON,
    origin: actor.uuid,
    disabled: false,
    duration: {},
    changes: [
      {
        key: `system.attributes.${bonus.attribute}.value`,
        mode: activeEffectAddMode(),
        value: String(bonus.bonus),
      },
    ],
    flags: {
      [MODULE_ID]: {
        [BOBBLEHEAD_EFFECT_ITEM_FLAG]: item.id,
      },
    },
  };
}

function effectMatchesDesired(effect: ActiveEffect, desired: Record<string, unknown>): boolean {
  if (effect.name !== desired.name) return false;
  if (effect.disabled) return false;

  const desiredChanges = (desired.changes ?? []) as ActiveEffectChange[];
  const actualChanges = (effect.changes ?? []) as ActiveEffectChange[];
  if (desiredChanges.length !== actualChanges.length) return false;

  for (let i = 0; i < desiredChanges.length; i += 1) {
    const want = desiredChanges[i];
    const have = actualChanges[i];
    if (want.key !== have.key) return false;
    if (want.mode !== have.mode) return false;
    if (String(want.value ?? "") !== String(have.value ?? "")) return false;
  }

  return readBobbleheadEffectItemId(effect) ===
    ((desired.flags as Record<string, Record<string, unknown>> | undefined)?.[MODULE_ID]?.[
      BOBBLEHEAD_EFFECT_ITEM_FLAG
    ] as string | undefined);
}

function collectExpectedBobbleheads(
  actor: Actor,
): Map<string, { item: Item; bonus: BobbleheadBonus }> {
  const expected = new Map<string, { item: Item; bonus: BobbleheadBonus }>();
  for (const item of actor.items) {
    const bonus = resolveBobbleheadBonus(item);
    if (!bonus) continue;
    expected.set(item.id, { item, bonus });
  }
  return expected;
}

/** Keep one wastelander bobblehead effect per inventory item id. */
async function dedupeBobbleheadEffects(worldActor: Actor): Promise<void> {
  const byItemId = new Map<string, ActiveEffect[]>();
  for (const effect of listBobbleheadEffects(worldActor)) {
    const itemId = readBobbleheadEffectItemId(effect);
    if (!itemId) continue;
    const bucket = byItemId.get(itemId) ?? [];
    bucket.push(effect);
    byItemId.set(itemId, bucket);
  }

  for (const effects of byItemId.values()) {
    for (const duplicate of effects.slice(1)) {
      await duplicate.delete(SILENT);
    }
  }
}

function refreshActorSheetAfterReconcile(actor: Actor): void {
  const worldActor = resolveBobbleheadWorldActor(actor);
  if (!worldActor) return;

  suppressSheetBobbleheadReconcile = true;
  try {
    refreshActorSheet(worldActor);
  } finally {
    suppressSheetBobbleheadReconcile = false;
  }
}

export async function reconcileBobbleheadBonuses(actor: Actor): Promise<void> {
  if (!isBobbleheadEligibleActor(actor)) return;

  const worldActor = resolveBobbleheadWorldActor(actor);
  if (!worldActor) return;

  if (reconcilingActorIds.has(worldActor.id)) return;
  reconcilingActorIds.add(worldActor.id);

  try {
    await dedupeBobbleheadEffects(worldActor);

    // Scan inventory on the hook/sheet actor — its embedded collection is current in createItem.
    const expected = collectExpectedBobbleheads(actor);
    const bobbleheadEffects = listBobbleheadEffects(worldActor);
    const expectedItemIds = new Set(expected.keys());

    for (const effect of bobbleheadEffects) {
      const itemId = readBobbleheadEffectItemId(effect);
      if (!itemId || !expectedItemIds.has(itemId)) {
        await effect.delete(SILENT);
      }
    }

    let refreshedEffects = listBobbleheadEffects(worldActor);

    for (const [itemId, { item, bonus }] of expected) {
      const desired = buildBobbleheadEffectData(item, bonus, worldActor);
      const existing = refreshedEffects.find(
        (effect) => readBobbleheadEffectItemId(effect) === itemId,
      );

      if (!existing) {
        await worldActor.createEmbeddedDocuments("ActiveEffect", [desired], SILENT);
        refreshedEffects = listBobbleheadEffects(worldActor);
        continue;
      }

      if (!effectMatchesDesired(existing, desired)) {
        await existing.update(desired, SILENT);
      }
    }

    await dedupeBobbleheadEffects(worldActor);
  } finally {
    reconcilingActorIds.delete(worldActor.id);
  }
}

function showBobbleheadAcquiredDialog(item: Item, actor: Actor): void {
  if (!shouldShowBobbleheadImage(actor)) return;

  const src = item.img?.trim();
  if (!src) return;

  const ImagePopout = (
    foundry as unknown as {
      applications?: { apps?: { ImagePopout?: new (options: Record<string, unknown>) => { render: (force?: boolean) => Promise<unknown> } } };
    }
  ).applications?.apps?.ImagePopout;

  if (!ImagePopout) return;

  void new ImagePopout({
    src,
    caption: item.name,
    window: { title: item.name },
  }).render(true);
}

function actorFromItem(item: Item): Actor | null {
  const parent = item.parent;
  return parent instanceof Actor ? parent : null;
}

async function handleBobbleheadItemCreated(item: Item, userId: string): Promise<void> {
  const actor = actorFromItem(item);
  if (!actor || !isBobbleheadEligibleActor(actor)) return;

  const bonus = resolveBobbleheadBonus(item);
  if (!bonus) return;

  if (game.user.id === userId) {
    await reconcileBobbleheadBonuses(actor);
    refreshActorSheetAfterReconcile(actor);
  }

  showBobbleheadAcquiredDialog(item, actor);
}

async function handleBobbleheadItemChanged(item: Item, userId: string): Promise<void> {
  if (game.user.id !== userId) return;

  const actor = actorFromItem(item);
  if (!actor || !isBobbleheadEligibleActor(actor)) return;

  await reconcileBobbleheadBonuses(actor);
  refreshActorSheetAfterReconcile(actor);
}

async function handleBobbleheadItemDeleted(item: Item, userId: string): Promise<void> {
  if (game.user.id !== userId) return;

  const actor = actorFromItem(item);
  if (!actor || !isBobbleheadEligibleActor(actor)) return;

  await reconcileBobbleheadBonuses(actor);
  refreshActorSheetAfterReconcile(actor);
}

async function reconcileAllEligibleActorsOnReady(): Promise<void> {
  if (!game.user.isGM) return;

  for (const actor of game.actors.contents) {
    if (!isBobbleheadEligibleActor(actor)) continue;
    await reconcileBobbleheadBonuses(actor);
  }
}

function actorFromSheet(app: unknown): Actor | null {
  const sheet = app as { actor?: Actor; document?: Actor };
  const actor = sheet.document ?? sheet.actor;
  return actor instanceof Actor ? actor : null;
}

export function registerBobbleheadBonusHooks(): void {
  registerBobbleheadSettings();

  Hooks.on("createItem", (item: Item, _options: unknown, userId: string) => {
    void handleBobbleheadItemCreated(item, userId);
  });

  Hooks.on("deleteItem", (item: Item, _options: unknown, userId: string) => {
    void handleBobbleheadItemDeleted(item, userId);
  });

  Hooks.on("updateItem", (item: Item, _changes: unknown, _options: unknown, userId: string) => {
    void handleBobbleheadItemChanged(item, userId);
  });

  Hooks.on("renderActorSheet", (app: unknown) => {
    if (suppressSheetBobbleheadReconcile) return;

    const actor = actorFromSheet(app);
    if (!actor || !isBobbleheadEligibleActor(actor)) return;
    if (!game.user.isGM && !actor.isOwner) return;
    void reconcileBobbleheadBonuses(actor);
  });

  Hooks.once("ready", () => {
    void reconcileAllEligibleActorsOnReady();
  });
}

/** @internal Test hooks */
export const __testing = {
  buildBobbleheadEffectData,
  effectMatchesDesired,
  collectExpectedBobbleheads,
  dedupeBobbleheadEffects,
  readBobbleheadEffectItemId,
  resetBobbleheadReconcileStateForTests: () => {
    suppressSheetBobbleheadReconcile = false;
    reconcilingActorIds.clear();
  },
};
