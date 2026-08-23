/**
 * What a studio may store, as against what it was handed.
 *
 * `useSiteStyle` answers with the config defaults and the stored tier already
 * merged, because that is what the canvas compiles. Nothing in that value says
 * which half it came from — so an editor that saved its working set whole would
 * copy every config-supplied token into the database, and from then on the
 * site's own code could not change those values. The failure is silent, it only
 * happens on sites that supply defaults, and it is permanent once written.
 *
 * @module site-style-override.test
 */
import type { SiteToken, SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  resolveSiteStyle,
  tokenOverrideOf,
  tokensAfterRefusal,
} from "./site-style";

const ink: SiteToken = {
  name: "color.ink",
  kind: "color",
  values: { light: "#111111" },
};
const brand: SiteToken = {
  id: "color.primary",
  name: "brand.main",
  kind: "color",
  values: { light: "#3b82f6" },
};

/** What a site's own code supplies. */
const DEFAULTS: SiteTokenSet = { tokens: [ink, brand], prefix: "--site-" };

/** The merged set a studio is actually handed. */
function merged(stored?: SiteTokenSet): SiteTokenSet {
  return resolveSiteStyle(
    { tokens: DEFAULTS },
    stored === undefined ? undefined : { tokens: stored }
  ).tokens as SiteTokenSet;
}

describe("only what differs from the site's own defaults is stored", () => {
  it("stores NOTHING when the author has changed nothing", () => {
    // The case that matters most, and the one a naive save gets wrong: opening
    // the studio and editing one unrelated thing must not persist the config.
    expect(tokenOverrideOf(DEFAULTS, merged()).tokens).toEqual([]);
  });

  it("stores only the token the author actually changed", () => {
    const edited = merged().tokens.map(token =>
      token.name === "color.ink"
        ? { ...token, values: { light: "#ff0000" } }
        : token
    );
    const override = tokenOverrideOf(DEFAULTS, { tokens: edited });
    expect(override.tokens.map(t => t.name)).toEqual(["color.ink"]);
    expect(override.tokens[0]?.values.light).toBe("#ff0000");
  });

  it("stores a token the config never supplied", () => {
    const edited = [
      ...merged().tokens,
      {
        name: "color.new",
        kind: "color",
        values: { light: "#00ff00" },
      } as SiteToken,
    ];
    expect(
      tokenOverrideOf(DEFAULTS, { tokens: edited }).tokens.map(t => t.name)
    ).toEqual(["color.new"]);
  });

  it("matches by IDENTITY, so a renamed default is an override and not a new token", () => {
    // `brand.main` carries id `color.primary`. Renaming it must be recognised
    // as an override of that default rather than stored beside it, which would
    // leave the default in the merged list forever.
    const edited = merged().tokens.map(token =>
      token.name === "brand.main" ? { ...token, name: "brand.hero" } : token
    );
    const override = tokenOverrideOf(DEFAULTS, { tokens: edited });
    expect(override.tokens.length).toBe(1);
    expect(override.tokens[0]?.id).toBe("color.primary");
    expect(override.tokens[0]?.name).toBe("brand.hero");
  });

  it("survives a round trip through the merge", () => {
    // The property that makes the whole scheme sound: storing the override and
    // merging it back must reproduce what the author was looking at.
    const edited = merged().tokens.map(token =>
      token.name === "color.ink"
        ? { ...token, values: { light: "#ff0000" } }
        : token
    );
    const stored = tokenOverrideOf(DEFAULTS, { tokens: edited });
    expect(merged(stored).tokens).toEqual(edited);
  });

  it("does not store a prefix or dark mode the config already states", () => {
    const override = tokenOverrideOf(DEFAULTS, {
      tokens: merged().tokens,
      prefix: "--site-",
    });
    expect(override.prefix).toBeUndefined();
  });

  it("DOES store a prefix the author changed", () => {
    const override = tokenOverrideOf(DEFAULTS, {
      tokens: merged().tokens,
      prefix: "--brand-",
    });
    expect(override.prefix).toBe("--brand-");
  });

  it("compares field by field, not by serialising", () => {
    // A token that round-tripped through storage can carry its keys in another
    // order. Comparing serialised forms would call it changed, and every edit
    // anywhere would then store every config token — the exact failure this
    // exists to prevent.
    const reordered = merged().tokens.map(token => ({
      values: token.values,
      kind: token.kind,
      name: token.name,
      ...(token.id === undefined ? {} : { id: token.id }),
    })) as SiteToken[];
    expect(tokenOverrideOf(DEFAULTS, { tokens: reordered }).tokens).toEqual([]);
  });

  it("stores everything when the site supplies no defaults at all", () => {
    // The control: without it, a function that always returned an empty list
    // would satisfy the first test perfectly.
    const edited = { tokens: [ink, brand] };
    expect(tokenOverrideOf(undefined, edited).tokens.length).toBe(2);
  });
});

describe("what a refused save leaves on screen", () => {
  const a: SiteTokenSet = { tokens: [ink] };
  const b: SiteTokenSet = { tokens: [brand] };
  const stored: SiteTokenSet = { tokens: [] };

  it("rolls back when the refused edit is still what is on screen", () => {
    expect(tokensAfterRefusal(a, a, stored)).toBe(stored);
  });

  it("does NOT roll back over a newer edit", () => {
    // Saves serialise but their answers need not arrive in order. Rolling back
    // unconditionally discards the newer edit — and if the newer save then
    // succeeds, the panel shows the older set while storage holds the newer,
    // with nothing left to reconcile them.
    expect(tokensAfterRefusal(b, a, stored)).toBe(b);
  });

  it("falls back to what was STORED, not to what was on screen before", () => {
    // After an earlier refusal, the previous on-screen value is itself one the
    // site never accepted, so restoring it would show the author something no
    // storage anywhere agrees with.
    expect(tokensAfterRefusal(a, a, stored)).toBe(stored);
    expect(tokensAfterRefusal(a, a, null)).toBeNull();
  });

  it("defers to the read when this session has stored nothing", () => {
    // `null` means no local shadow, so the query's own answer is the truth.
    expect(tokensAfterRefusal(a, a, null)).toBeNull();
  });
});

describe("vendor extensions are not lost by a save about something else", () => {
  it("treats a token differing ONLY in extensions as changed", () => {
    // DTCG requires a tool to preserve extension data it does not understand.
    // Left out of the comparison, a stored override differing only in
    // extensions reads as identical to the config default — so the next edit
    // anywhere in the table filters it out of the payload and the vendor data
    // is gone, from a save the author made about a different token.
    const base: SiteToken = {
      name: "color.ink",
      kind: "color",
      values: { light: "#111111" },
    };
    const withExtensions: SiteToken = {
      ...base,
      extensions: { "com.figma": { variableId: "VariableID:1:2" } },
    };
    const override = tokenOverrideOf(
      { tokens: [base] },
      { tokens: [withExtensions] }
    );
    expect(override.tokens).toEqual([withExtensions]);
  });

  it("still treats identical extensions as unchanged, whatever the key order", () => {
    // The control, and the reason the comparison is structural rather than
    // serialised: a token that round-tripped through storage can carry its
    // extension keys in another order, and calling that changed would store
    // every config token on every edit.
    const extensions = { a: { x: 1, y: [1, 2] }, b: "s" };
    const reordered = { b: "s", a: { y: [1, 2], x: 1 } };
    const one: SiteToken = {
      name: "color.ink",
      kind: "color",
      values: { light: "#111111" },
      extensions,
    };
    const two: SiteToken = { ...one, extensions: reordered };
    expect(
      tokenOverrideOf({ tokens: [one] }, { tokens: [two] }).tokens
    ).toEqual([]);
  });

  it("tells an array from a record, and a length from a length", () => {
    // Order matters in an array and not in a record, which is the whole reason
    // they are decided apart — an equality applying one rule to both would be
    // wrong in one direction or the other.
    const of = (extensions: Record<string, unknown>): SiteToken => ({
      name: "color.ink",
      kind: "color",
      values: { light: "#111111" },
      extensions,
    });
    const differ = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      tokenOverrideOf({ tokens: [of(a)] }, { tokens: [of(b)] }).tokens.length;

    expect(differ({ v: [1, 2] }, { v: [2, 1] })).toBe(1);
    expect(differ({ v: [1, 2] }, { v: [1, 2, 3] })).toBe(1);
    expect(differ({ v: [1, 2] }, { v: { 0: 1, 1: 2 } })).toBe(1);
    expect(differ({ v: 1 }, { v: "1" })).toBe(1);
    expect(differ({ v: null }, { v: {} })).toBe(1);
    expect(differ({ v: { a: 1 } }, { v: { a: 1, b: 2 } })).toBe(1);
    // And the same content, however it is spelled, is still the same.
    expect(differ({ v: [1, { a: 2 }] }, { v: [1, { a: 2 }] })).toBe(0);
  });

  it("sees a difference nested inside the extension data", () => {
    const one: SiteToken = {
      name: "color.ink",
      kind: "color",
      values: { light: "#111111" },
      extensions: { a: { deep: [1, 2, 3] } },
    };
    const two: SiteToken = { ...one, extensions: { a: { deep: [1, 2, 4] } } };
    expect(
      tokenOverrideOf({ tokens: [one] }, { tokens: [two] }).tokens
    ).toEqual([two]);
  });
});
