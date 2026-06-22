import { describe, expect, it } from "vitest";
import {
  isBobbleheadEligibleActor,
  resolveBobbleheadBonus,
  specialAttributeLabel,
} from "./bobbleheadCatalog.js";
import { __testing } from "./bobbleheadBonuses.js";

describe("bobbleheadCatalog", () => {
  it("matches SPECIAL bobbleheads by exact miscellany name", () => {
    expect(
      resolveBobbleheadBonus({ name: "1. Strength Bobblehead", type: "miscellany" }),
    ).toEqual({ category: "special", attribute: "str", bonus: 1 });
    expect(
      resolveBobbleheadBonus({ name: "7. Luck Bobblehead", type: "miscellany" }),
    ).toEqual({ category: "special", attribute: "luc", bonus: 1 });
  });

  it("ignores wrong type or unknown names", () => {
    expect(resolveBobbleheadBonus({ name: "1. Strength Bobblehead", type: "weapon" })).toBeNull();
    expect(resolveBobbleheadBonus({ name: "Barter Bobblehead", type: "miscellany" })).toBeNull();
  });

  it("ignores stashed bobbleheads", () => {
    expect(
      resolveBobbleheadBonus({
        name: "1. Strength Bobblehead",
        type: "miscellany",
        system: { stashed: true },
      }),
    ).toBeNull();
    expect(
      resolveBobbleheadBonus({
        name: "1. Strength Bobblehead",
        type: "miscellany",
        system: { stashed: false },
      }),
    ).toEqual({ category: "special", attribute: "str", bonus: 1 });
  });

  it("limits eligible actors to character and robot", () => {
    expect(isBobbleheadEligibleActor({ type: "character" } as Actor)).toBe(true);
    expect(isBobbleheadEligibleActor({ type: "robot" } as Actor)).toBe(true);
    expect(isBobbleheadEligibleActor({ type: "npc" } as Actor)).toBe(false);
  });
});

describe("bobbleheadBonuses effect payload", () => {
  it("builds a +1 SPECIAL active effect linked to the inventory item", () => {
    (globalThis as { CONST?: { ACTIVE_EFFECT_MODES: { ADD: number } } }).CONST = {
      ACTIVE_EFFECT_MODES: { ADD: 2 },
    };

    const item = {
      id: "item123",
      name: "1. Strength Bobblehead",
      img: "path/to/bobblehead.webp",
      uuid: "Item.item123",
    } as Item;

    const actor = {
      uuid: "Actor.actor456",
    } as Actor;

    const payload = __testing.buildBobbleheadEffectData(
      item,
      {
        category: "special",
        attribute: "str",
        bonus: 1,
      },
      actor,
    );

    expect(payload.name).toBe("1. Strength Bobblehead (+1 STR)");
    expect(payload.origin).toBe("Actor.actor456");
    expect(payload.changes).toEqual([
      { key: "system.attributes.str.value", mode: 2, value: "1" },
    ]);
    expect(payload.flags).toEqual({
      wastelander: { bobbleheadEffectForItemId: "item123" },
    });
    expect(specialAttributeLabel("str")).toBe("STR");
  });
});
