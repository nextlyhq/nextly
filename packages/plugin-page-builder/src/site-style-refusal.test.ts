import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { checkStoredTokens, tokensKeptAfterRefusal } from "./site-style-record";

const STORED: SiteTokenSet = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

describe("a refused save takes back only the variable refused", () => {
  it("keeps every other change in the burst, a new variable included", () => {
    const refused: SiteTokenSet = {
      tokens: [
        // Changed and fine.
        { name: "color.brand", kind: "color", values: { light: "#2563eb" } },
        // Changed and refused.
        { name: "space.4", kind: "dimension", values: { light: "big" } },
        // Added and fine.
        { name: "color.accent", kind: "color", values: { light: "#f97316" } },
      ],
    };
    const kept = tokensKeptAfterRefusal(refused, STORED);
    expect(kept?.tokens).toEqual([
      { name: "color.brand", kind: "color", values: { light: "#2563eb" } },
      { name: "space.4", kind: "dimension", values: { light: "1rem" } },
      { name: "color.accent", kind: "color", values: { light: "#f97316" } },
    ]);
    // What is kept is a set the save takes.
    expect(checkStoredTokens(kept).issues).toEqual([]);
  });

  it("drops a new variable whose own value is refused, and nothing else", () => {
    const refused: SiteTokenSet = {
      tokens: [
        ...STORED.tokens,
        { name: "space.new", kind: "dimension", values: { light: "12pxred" } },
      ],
    };
    expect(tokensKeptAfterRefusal(refused, STORED)?.tokens).toEqual(
      STORED.tokens
    );
  });

  it("takes the whole edit back when no one change is refused on its own", () => {
    // A removal the save refuses for a use it counted: nothing here can say
    // which change it was, so the set stored before stands, as it always did.
    const refused: SiteTokenSet = { tokens: STORED.tokens.slice(0, 1) };
    expect(tokensKeptAfterRefusal(refused, STORED)).toBe(STORED);
  });

  it("falls back to nothing stored when nothing was", () => {
    const refused: SiteTokenSet = {
      tokens: [
        { name: "space.4", kind: "dimension", values: { light: "big" } },
      ],
    };
    expect(tokensKeptAfterRefusal(refused, null)?.tokens).toEqual([]);
  });
});
