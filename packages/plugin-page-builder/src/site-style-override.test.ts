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

import { resolveSiteStyle, tokenOverrideOf } from "./site-style";

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
