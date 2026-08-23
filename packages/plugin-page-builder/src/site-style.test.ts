import type {
  BreakpointSet,
  FontFaceDef,
  NamedClass,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  resolveSiteStyle,
  siteBreakpoints,
  siteSheet,
  type SiteStyleData,
} from "./site-style";

/** A token set holding the given tokens and nothing site-wide. */
function tokens(
  entries: Array<{ name: string; light: string; dark?: string }>
): SiteTokenSet {
  return {
    tokens: entries.map(entry => ({
      name: entry.name,
      kind: "color" as const,
      values: {
        light: entry.light,
        ...(entry.dark === undefined ? {} : { dark: entry.dark }),
      },
    })),
  };
}

/** A named class carrying just enough styles to be distinguishable. */
function cls(id: string, slug: string, orderIndex: number): NamedClass {
  return { id, slug, orderIndex, styles: { base: { base: { color: id } } } };
}

/** A face whose identity is its family/weight/style triple. */
function face(family: string, weight?: string, style?: string): FontFaceDef {
  return {
    family,
    src: [{ url: `/fonts/${family}.woff2`, format: "woff2" }],
    ...(weight === undefined ? {} : { weight }),
    ...(style === undefined ? {} : { style }),
  };
}

const VIEWPORT_ONLY: BreakpointSet = {
  viewport: [{ id: "base", label: "Base" }],
  container: [],
};

describe("resolveSiteStyle", () => {
  it("answers the empty style when nothing is stated on either tier", () => {
    expect(resolveSiteStyle()).toStrictEqual({});
    expect(resolveSiteStyle({}, {})).toStrictEqual({});
  });

  it("passes a lone tier through, whichever side states it", () => {
    const style: SiteStyleData = {
      tokens: tokens([{ name: "color.primary", light: "#111111" }]),
    };
    expect(resolveSiteStyle(style, undefined).tokens).toEqual(style.tokens);
    expect(resolveSiteStyle(undefined, style).tokens).toEqual(style.tokens);
  });

  it("merges tokens by NAME, stored winning, defaults surviving", () => {
    const merged = resolveSiteStyle(
      {
        tokens: tokens([
          { name: "color.primary", light: "#111111" },
          { name: "content.width", light: "60rem" },
        ]),
      },
      { tokens: tokens([{ name: "color.primary", light: "#222222" }]) }
    );
    const byName = new Map(
      (merged.tokens?.tokens ?? []).map(t => [t.name, t.values.light])
    );
    // The stored value took the name it stated; the default it did not name
    // survived — losing it would silently invalidate every declaration that
    // reads it, which is the failure per-name merging exists to prevent.
    expect(byName.get("color.primary")).toBe("#222222");
    expect(byName.get("content.width")).toBe("60rem");
  });

  it("keys the tier merge on IDENTITY, so a rename replaces its default", () => {
    // The property the whole stable-identity field rests on. An author renames
    // a config-stated token in the studio; the stored entry keeps the id and
    // takes a new name. Keyed on the name, the two tiers stop matching and the
    // default survives BESIDE the override — two entries for one token, with
    // the stale one earlier in the list.
    //
    // That is not a collision. `resolveSiteTokens` is a Map keyed on identity,
    // so it deduplicates and the stored token wins; what leaks is the list
    // itself, which is what a tokens studio and `useSiteStyle` both read.
    const merged = resolveSiteStyle(
      {
        tokens: {
          tokens: [
            {
              name: "color.primary",
              kind: "color" as const,
              values: { light: "#111111" },
            },
          ],
        },
      },
      {
        tokens: {
          tokens: [
            {
              id: "color.primary",
              name: "color.brand",
              kind: "color" as const,
              values: { light: "#222222" },
            },
          ],
        },
      }
    );

    expect(merged.tokens?.tokens).toHaveLength(1);
    expect(merged.tokens?.tokens[0]?.name).toBe("color.brand");
    expect(merged.tokens?.tokens[0]?.values.light).toBe("#222222");
  });

  it("still merges by name when no token states an id", () => {
    // The continuity case. `tokenIdentity` falls back to the name, so every
    // token stored before the field existed keys exactly as it did — a change
    // to the merge key must not move data that has no id to move.
    const merged = resolveSiteStyle(
      { tokens: tokens([{ name: "color.primary", light: "#111111" }]) },
      { tokens: tokens([{ name: "color.primary", light: "#222222" }]) }
    );

    expect(merged.tokens?.tokens).toHaveLength(1);
    expect(merged.tokens?.tokens[0]?.values.light).toBe("#222222");
  });

  it("takes prefix and darkMode from the stored tier when stated", () => {
    const merged = resolveSiteStyle(
      { tokens: { tokens: [], prefix: "--acme-", darkMode: "media" } },
      { tokens: { tokens: [], prefix: "--brand-" } }
    );
    expect(merged.tokens?.prefix).toBe("--brand-");
    // Unstated on the stored tier, so the default's site-wide choice holds.
    expect(merged.tokens?.darkMode).toBe("media");
  });

  it("merges classes by ID, stored winning, defaults surviving", () => {
    const merged = resolveSiteStyle(
      { classes: [cls("a", "card", 0), cls("b", "hero", 1)] },
      { classes: [cls("a", "card-tight", 5)] }
    );
    const byId = new Map((merged.classes ?? []).map(c => [c.id, c]));
    expect(byId.get("a")?.slug).toBe("card-tight");
    expect(byId.get("a")?.orderIndex).toBe(5);
    expect(byId.get("b")?.slug).toBe("hero");
  });

  it("merges fonts by face identity: same family, different style, both kept", () => {
    const merged = resolveSiteStyle(
      { fonts: [face("Geist"), face("Geist", undefined, "italic")] },
      { fonts: [face("Geist")] }
    );
    // The stored regular replaced the default regular; the italic — a
    // different face of the same family — survived.
    expect(merged.fonts).toHaveLength(2);
    expect(merged.fonts?.[0]).toEqual(face("Geist"));
    expect(merged.fonts?.[1]).toEqual(face("Geist", undefined, "italic"));
  });

  it("replaces breakpoints as a WHOLE set when the stored one defines any", () => {
    const stored: BreakpointSet = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "narrow", label: "Narrow", maxWidth: 480 },
      ],
      container: [],
    };
    const merged = resolveSiteStyle(
      { breakpoints: VIEWPORT_ONLY },
      { breakpoints: stored }
    );
    // No splicing: the stored cascade wins outright.
    expect(merged.breakpoints).toEqual(stored);
  });

  it("treats an EMPTY stored breakpoint set as not configured", () => {
    const merged = resolveSiteStyle(
      { breakpoints: VIEWPORT_ONLY },
      { breakpoints: { viewport: [], container: [] } }
    );
    expect(merged.breakpoints).toEqual(VIEWPORT_ONLY);
  });
});

describe("siteBreakpoints", () => {
  it("answers the empty set with no style, so unwired callers stay permissive", () => {
    expect(siteBreakpoints()).toEqual({ viewport: [], container: [] });
  });

  it("answers the merged style's set when one is defined", () => {
    expect(siteBreakpoints({ breakpoints: VIEWPORT_ONLY })).toBe(VIEWPORT_ONLY);
  });
});

describe("siteSheet", () => {
  it("omits undefined sections rather than defaulting them", () => {
    // An invented section would preview a design no published page has; the
    // sheet compiler treats an absent key as "the site defines none".
    expect(siteSheet()).toStrictEqual({
      breakpoints: { viewport: [], container: [] },
    });
  });

  it("carries every defined section through to the sheet input", () => {
    const style: SiteStyleData = {
      tokens: tokens([{ name: "color.primary", light: "#123456" }]),
      classes: [cls("a", "card", 0)],
      fonts: [face("Geist")],
      breakpoints: VIEWPORT_ONLY,
    };
    expect(siteSheet(style)).toStrictEqual({
      tokens: style.tokens,
      classes: style.classes,
      fonts: style.fonts,
      breakpoints: VIEWPORT_ONLY,
    });
  });
});
