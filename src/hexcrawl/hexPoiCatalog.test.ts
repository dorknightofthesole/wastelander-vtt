import { describe, expect, it } from "vitest";
import { MODULE_PATH } from "../constants.js";
import {
  normalizeWorldPoiIcons,
  resolvePoiIconImageUrl,
  slugifyPoiId,
} from "./hexPoiCatalog.js";

describe("hexPoiCatalog", () => {
  it("normalizes world poi icons and dedupes ids", () => {
    expect(
      normalizeWorldPoiIcons([
        { id: "city", label: "City", path: "worlds/test/city.png" },
        { id: "city", label: "Duplicate", path: "other.png" },
        { id: "", label: "Bad", path: "x.png" },
        null,
      ]),
    ).toEqual([{ id: "city", label: "City", path: "worlds/test/city.png" }]);
  });

  it("slugifies poi ids and avoids collisions", () => {
    const taken = new Set(["settlement", "settlement-2"]);
    expect(slugifyPoiId("Settlement!", taken)).toBe("settlement-3");
    expect(slugifyPoiId("!!!", taken)).toBe("poi");
  });

  it("resolves module legacy and absolute poi image paths", () => {
    expect(resolvePoiIconImageUrl("assets/hexcrawl/hex-icons/ruins.png")).toBe(
      `${MODULE_PATH}/assets/hexcrawl/hex-icons/ruins.png`,
    );
    expect(resolvePoiIconImageUrl("/icons/poi.png")).toBe("/icons/poi.png");
    expect(resolvePoiIconImageUrl("https://example.com/poi.png")).toBe(
      "https://example.com/poi.png",
    );
  });
});
