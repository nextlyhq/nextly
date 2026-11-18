/**
 * Which other sets use a component, and how that is said.
 */
import { describe, expect, it } from "vitest";

import { alsoUsedByWords, otherSetsUsing } from "./set-separate-copy";

const set = (id: string, title: string, header?: string) =>
  ({
    id,
    title,
    published: true,
    draftChangesNotLive: false,
    regions:
      header === undefined ? [] : [{ area: "header", componentId: header }],
    areasFilled: [],
  }) as const;

describe("the other sets using a component", () => {
  it("are every set but this one whose published regions name it", () => {
    const sets = [
      set("main", "Main", "h"),
      set("landing", "Landing", "h"),
      set("promo", "Promo", "other"),
      set("draft", "Draft"),
    ];
    expect(otherSetsUsing(sets, "main", "h")).toEqual(["Landing"]);
    expect(otherSetsUsing(sets, "main", undefined)).toEqual([]);
  });

  it("are said by name, then by count past two", () => {
    expect(alsoUsedByWords(["Landing"])).toBe("Also used by Landing");
    expect(alsoUsedByWords(["Landing", "Promo"])).toBe(
      "Also used by Landing and Promo"
    );
    expect(alsoUsedByWords(["Landing", "Promo", "Shop"])).toBe(
      "Also used by Landing and 2 other sets"
    );
  });
});
