import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../constants.js";
import { __testing, reconcileBobbleheadBonuses } from "./bobbleheadBonuses.js";

const BOBBLEHEAD_ITEM = {
  id: "item-bobble",
  name: "1. Strength Bobblehead",
  type: "miscellany",
  img: "path/bobble.webp",
  uuid: "Item.item-bobble",
  system: { stashed: false },
} as Item;

function mockEffect(
  id: string,
  itemId: string,
  overrides: Partial<ActiveEffect> = {},
): ActiveEffect {
  return {
    id,
    name: `${itemId} effect`,
    disabled: false,
    changes: [],
    getFlag: (scope: string, key: string) =>
      scope === MODULE_ID && key === "bobbleheadEffectForItemId" ? itemId : undefined,
    delete: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ActiveEffect;
}

function mockActor(options: {
  effects?: ActiveEffect[];
  createEmbeddedDocuments?: ReturnType<typeof vi.fn>;
} = {}): Actor {
  const effects = options.effects ?? [];
  const actor = {
    id: "actor-1",
    type: "character",
    uuid: "Actor.actor-1",
    isToken: false,
    items: [BOBBLEHEAD_ITEM],
    effects: {
      filter: (predicate: (effect: ActiveEffect) => boolean) => effects.filter(predicate),
    },
    createEmbeddedDocuments: options.createEmbeddedDocuments ?? vi.fn().mockResolvedValue([]),
  } as unknown as Actor;

  (globalThis as { game?: { actors: { get: (id: string) => Actor | undefined } } }).game = {
    actors: {
      get: (id: string) => (id === actor.id ? actor : undefined),
    },
  };

  return actor;
}

describe("bobbleheadBonuses reconcile", () => {
  afterEach(() => {
    __testing.resetBobbleheadReconcileStateForTests();
    vi.restoreAllMocks();
  });

  it("creates exactly one active effect for a bobblehead item", async () => {
    (globalThis as { CONST?: { ACTIVE_EFFECT_MODES: { ADD: number } } }).CONST = {
      ACTIVE_EFFECT_MODES: { ADD: 2 },
    };

    const createEmbeddedDocuments = vi.fn().mockResolvedValue([]);
    const actor = mockActor({ createEmbeddedDocuments });

    await reconcileBobbleheadBonuses(actor);

    expect(createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(createEmbeddedDocuments).toHaveBeenCalledWith(
      "ActiveEffect",
      [
        expect.objectContaining({
          changes: [
            { key: "system.attributes.str.value", mode: 2, value: "1" },
          ],
          flags: {
            wastelander: { bobbleheadEffectForItemId: "item-bobble" },
          },
        }),
      ],
      { render: false },
    );
  });

  it("does not create a second effect when reconcile runs twice", async () => {
    (globalThis as { CONST?: { ACTIVE_EFFECT_MODES: { ADD: number } } }).CONST = {
      ACTIVE_EFFECT_MODES: { ADD: 2 },
    };

    const createEmbeddedDocuments = vi.fn().mockImplementation(async (_type, data) => {
      const payload = data[0] as { flags?: Record<string, Record<string, string>> };
      const itemId = payload.flags?.[MODULE_ID]?.bobbleheadEffectForItemId ?? "item-bobble";
      effects.push(mockEffect(`effect-${effects.length + 1}`, itemId));
      return [effects.at(-1)];
    });

    const effects: ActiveEffect[] = [];
    const actor = mockActor({ effects, createEmbeddedDocuments });

    await reconcileBobbleheadBonuses(actor);
    await reconcileBobbleheadBonuses(actor);

    expect(createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(effects).toHaveLength(1);
  });

  it("dedupes duplicate wastelander bobblehead effects for the same item", async () => {
    const duplicateA = mockEffect("effect-a", "item-bobble");
    const duplicateB = mockEffect("effect-b", "item-bobble");
    const actor = mockActor({ effects: [duplicateA, duplicateB] });

    await __testing.dedupeBobbleheadEffects(actor);

    expect(duplicateA.delete).not.toHaveBeenCalled();
    expect(duplicateB.delete).toHaveBeenCalledTimes(1);
  });

  it("does not create an effect for a stashed bobblehead", async () => {
    (globalThis as { CONST?: { ACTIVE_EFFECT_MODES: { ADD: number } } }).CONST = {
      ACTIVE_EFFECT_MODES: { ADD: 2 },
    };

    const createEmbeddedDocuments = vi.fn().mockResolvedValue([]);
    const stashedBobblehead = {
      ...BOBBLEHEAD_ITEM,
      system: { stashed: true },
    } as Item;
    const actor = mockActor({ createEmbeddedDocuments });
    (actor as { items: Item[] }).items = [stashedBobblehead];

    await reconcileBobbleheadBonuses(actor);

    expect(createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("removes an existing effect when the bobblehead is stashed", async () => {
    const existingEffect = mockEffect("effect-a", "item-bobble");
    const createEmbeddedDocuments = vi.fn().mockResolvedValue([]);
    const stashedBobblehead = {
      ...BOBBLEHEAD_ITEM,
      system: { stashed: true },
    } as Item;
    const actor = mockActor({
      effects: [existingEffect],
      createEmbeddedDocuments,
    });
    (actor as { items: Item[] }).items = [stashedBobblehead];

    await reconcileBobbleheadBonuses(actor);

    expect(existingEffect.delete).toHaveBeenCalledTimes(1);
    expect(createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
