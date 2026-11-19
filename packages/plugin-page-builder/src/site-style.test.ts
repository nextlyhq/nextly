import {
  DEFAULT_FLUID_RANGE,
  fluidValue,
  type BreakpointSet,
  type FontFaceDef,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  configuredClassesAt,
  removedSiteStyleOption,
  resolveSiteStyle,
  siteBreakpoints,
  siteSheet,
  tokenOverrideOf,
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

  it("keeps one cut stored for two scripts as two faces", () => {
    const latin = { ...face("Lora"), unicodeRange: "U+0000-00FF" };
    const cyrillic = { ...face("Lora"), unicodeRange: "U+0400-045F" };
    const merged = resolveSiteStyle(undefined, { fonts: [latin, cyrillic] });
    // Each covers its own characters; dropping one leaves a script unloaded.
    expect(merged.fonts).toEqual([latin, cyrillic]);
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

  it("answers the same sheet for the same style, so a draw from it can be kept", () => {
    // The canvas, its regions and the entry page's miniature each keep their
    // drawn page while its inputs keep their identity; a new sheet object per
    // render made every one of them draw again for a selection or a keystroke.
    const style: SiteStyleData = {
      tokens: tokens([{ name: "color.primary", light: "#123456" }]),
      breakpoints: VIEWPORT_ONLY,
    };
    expect(siteSheet(style)).toBe(siteSheet(style));
    expect(siteSheet()).toBe(siteSheet());
    expect(siteSheet(undefined)).toBe(siteSheet());
  });

  it("answers a new sheet for a new style", () => {
    const style: SiteStyleData = { breakpoints: VIEWPORT_ONLY };
    const changed: SiteStyleData = {
      ...style,
      classes: [cls("a", "card", 0)],
    };
    expect(siteSheet(changed)).not.toBe(siteSheet(style));
    expect(siteSheet(changed)).toHaveProperty("classes", changed.classes);
  });
});

describe("a spacing model left in a host's options or a stored document", () => {
  it("reaches neither the resolved site style nor the sheet a page compiles from", () => {
    // An untyped host, and a document an older release could have written:
    // the engine then compiles every page with its default, container gaps.
    const left = { spacingMode: "classic" } as never;
    const resolved = resolveSiteStyle(left, left);
    expect(resolved).not.toHaveProperty("spacingMode");
    expect(siteSheet(resolved)).not.toHaveProperty("spacingMode");
    // The control: a section that is stated does come through.
    const stated = resolveSiteStyle(undefined, {
      breakpoints: {
        viewport: [{ id: "md", label: "Tablet", maxWidth: 1023 }],
      },
    } as never);
    expect(stated).toHaveProperty("breakpoints");
  });
});

describe("removedSiteStyleOption", () => {
  it("names the removed option, and says it was removed, when it is passed", () => {
    expect(removedSiteStyleOption({ spacingMode: "gaps" })).toMatch(
      /siteStyle\.spacingMode.*removed/
    );
  });

  it("says nothing for options without it", () => {
    expect(removedSiteStyleOption(undefined)).toBeUndefined();
    expect(removedSiteStyleOption({ tokens: { tokens: [] } })).toBeUndefined();
  });
});

describe("the site's fluid range across the tiers", () => {
  it("is stored only where it differs from the code's, and the stored one wins", () => {
    const defaults = { tokens: [], fluidRange: { min: 360, max: 1280 } };
    expect(
      tokenOverrideOf(defaults, {
        tokens: [],
        fluidRange: { min: 360, max: 1280 },
      }).fluidRange
    ).toBeUndefined();
    expect(
      tokenOverrideOf(defaults, {
        tokens: [],
        fluidRange: { min: 320, max: 1440 },
      }).fluidRange
    ).toEqual({ min: 320, max: 1440 });
    expect(
      resolveSiteStyle(
        { tokens: defaults },
        { tokens: { tokens: [], fluidRange: { min: 320, max: 1440 } } }
      ).tokens?.fluidRange
    ).toEqual({ min: 320, max: 1440 });
  });

  it("is stored with a size made with Fluid…, whatever the code's is, so the stored sizes say what they were made across", () => {
    // A merge of two authors' saves writes a fluid size again from its sizes
    // and the range. It reads the stored tier alone, so that tier holds the
    // range its fluid sizes were made across rather than leave it implied.
    const lead = {
      name: "font-size.lead",
      kind: "dimension" as const,
      values: { light: "clamp(1rem, 0.9167rem + 0.3704vw, 1.25rem)" },
      fluid: { small: 16, large: 20 },
    };
    const coded = { tokens: [], fluidRange: { min: 320, max: 1440 } };
    expect(
      tokenOverrideOf(coded, {
        tokens: [lead],
        fluidRange: { min: 320, max: 1440 },
      }).fluidRange
    ).toEqual({ min: 320, max: 1440 });
    // Neither tier sets one: the range it was made across is the default.
    expect(
      tokenOverrideOf({ tokens: [] }, { tokens: [lead] }).fluidRange
    ).toEqual({ min: 360, max: 1280 });
  });
});

describe("a text style the site's code makes fluid, across the site's range", () => {
  const SIZES = { small: 16, large: 32 };
  const NEW = { min: 400, max: 800 };
  /** A code text style whose Desktop size "Fluid…" made across `range`. */
  const codeLead = (
    range: { min: number; max: number } = DEFAULT_FLUID_RANGE
  ): NamedClass =>
    ({
      id: "t-code-lead",
      slug: "code-lead",
      label: "Code lead",
      orderIndex: 0,
      role: "text",
      styles: { base: { base: { fontSize: fluidValue(SIZES, range) } } },
      fluidSizes: { base: SIZES },
    }) as NamedClass;
  /** A stored tier holding a range and nothing else. */
  const storedRange = (range: { min: number; max: number }) => ({
    tokens: { tokens: [], fluidRange: range },
  });
  const sizeOf = (style: { classes?: readonly NamedClass[] }, id: string) =>
    (
      style.classes?.find(entry => entry.id === id)?.styles as
        | { base?: { base?: { fontSize?: unknown } } }
        | undefined
    )?.base?.base?.fontSize;

  it("follows a range the site stores, keeping its sizes", () => {
    const merged = resolveSiteStyle(
      { classes: [codeLead()] },
      storedRange(NEW)
    );
    expect(sizeOf(merged, "t-code-lead")).toBe(fluidValue(SIZES, NEW));
    expect(merged.classes?.[0]?.fluidSizes).toEqual({ base: SIZES });
  });

  it("is made again from the range the code made it across, not the default", () => {
    const coded = { min: 320, max: 1440 };
    const defaults = {
      tokens: { tokens: [], fluidRange: coded },
      classes: [codeLead(coded)],
    };
    expect(
      sizeOf(resolveSiteStyle(defaults, storedRange(NEW)), "t-code-lead")
    ).toBe(fluidValue(SIZES, NEW));
    // Nothing stored: the code's range is the site's, and the size is the code's.
    expect(resolveSiteStyle(defaults).classes?.[0]).toBe(defaults.classes[0]);
  });

  it("leaves a code size typed by hand beside its sizes as the code wrote it", () => {
    // Not the clamp its sizes make across the code's range: the developer's.
    const typed = {
      ...codeLead(),
      styles: { base: { base: { fontSize: "20px" } } },
    } as NamedClass;
    const merged = resolveSiteStyle({ classes: [typed] }, storedRange(NEW));
    expect(merged.classes?.[0]).toBe(typed);
  });

  it("gives way to a stored override of it, as stored", () => {
    const override = {
      ...codeLead(),
      styles: { base: { base: { fontSize: "30px" } } },
    } as NamedClass;
    const merged = resolveSiteStyle(
      { classes: [codeLead()] },
      { ...storedRange(NEW), classes: [override] }
    );
    expect(merged.classes).toHaveLength(1);
    expect(merged.classes?.[0]).toBe(override);
  });

  it("answers the code's own objects while the site's range is the code's", () => {
    const classes = [codeLead()];
    expect(resolveSiteStyle({ classes }).classes?.[0]).toBe(classes[0]);
    expect(
      resolveSiteStyle({ classes }, storedRange(DEFAULT_FLUID_RANGE))
        .classes?.[0]
    ).toBe(classes[0]);
    expect(configuredClassesAt({ classes }, storedRange(NEW).tokens)).not.toBe(
      classes
    );
    expect(
      configuredClassesAt({ classes }, storedRange(DEFAULT_FLUID_RANGE).tokens)
    ).toBe(classes);
  });

  it("follows the range when locked: a lock guards the site's edits, and nothing stored moves", () => {
    const locked = { ...codeLead(), locked: true } as NamedClass;
    const merged = resolveSiteStyle({ classes: [locked] }, storedRange(NEW));
    expect(sizeOf(merged, "t-code-lead")).toBe(fluidValue(SIZES, NEW));
    expect(merged.classes?.[0]?.locked).toBe(true);
  });

  it("is the code tier configuredClassesAt answers for the merged tokens", () => {
    const defaults = { classes: [codeLead()] };
    const merged = resolveSiteStyle(defaults, storedRange(NEW));
    expect(configuredClassesAt(defaults, merged.tokens)).toEqual(
      merged.classes
    );
  });
});

describe("the site's text across the two tiers", () => {
  const defaults = {
    tokens: {
      tokens: [],
      siteText: {
        h1: { fontSize: "50px" },
        body: { fontSize: "17px" },
      },
    },
  };

  it("lays a stored row over the code's, row by row", () => {
    const merged = resolveSiteStyle(defaults, {
      tokens: { tokens: [], siteText: { h1: { fontSize: "60px" } } },
    });
    expect(merged.tokens?.siteText).toEqual({
      h1: { fontSize: "60px" },
      body: { fontSize: "17px" },
    });
  });

  it("stores only the rows that differ from the code's", () => {
    const stored = tokenOverrideOf(defaults.tokens, {
      tokens: [],
      siteText: { h1: { fontSize: "60px" }, body: { fontSize: "17px" } },
    });
    expect(stored.siteText).toEqual({ h1: { fontSize: "60px" } });
  });

  it("stores no site text where every row is the code's", () => {
    const stored = tokenOverrideOf(defaults.tokens, {
      tokens: [],
      siteText: { h1: { fontSize: "50px" }, body: { fontSize: "17px" } },
    });
    expect(stored).not.toHaveProperty("siteText");
  });

  it("stores the range a fluid row was made across, though no variable is fluid", () => {
    const range = { min: 360, max: 1280 };
    const stored = tokenOverrideOf(
      { tokens: [], fluidRange: range },
      {
        tokens: [],
        fluidRange: range,
        siteText: {
          h2: {
            fontSize: "clamp(1.5rem, 1.2rem + 1.4vw, 2.5rem)",
            fluid: { small: 24, large: 40 },
          },
        },
      }
    );
    expect(stored.fluidRange).toEqual(range);
  });

  it("keeps an empty row, which leaves that text to the site's own CSS", () => {
    const stored = tokenOverrideOf(undefined, {
      tokens: [],
      siteText: { h3: {} },
    });
    expect(stored.siteText).toEqual({ h3: {} });
  });
});

describe("the site's colour order across the tiers", () => {
  it("is stored where the site set one, and read back over the code's", () => {
    const order = ["color.text", "color.primary"];
    expect(
      tokenOverrideOf({ tokens: [] }, { tokens: [], order }).order
    ).toEqual(order);
    expect(tokenOverrideOf({ tokens: [] }, { tokens: [] })).not.toHaveProperty(
      "order"
    );
    expect(
      resolveSiteStyle(
        { tokens: { tokens: [] } },
        { tokens: { tokens: [], order } }
      ).tokens?.order
    ).toEqual(order);
  });
});

describe("whether the built-in colours are shown, across the tiers", () => {
  it("is stored where the site hides them, and read back over the code's", () => {
    const hidden = tokenOverrideOf(
      { tokens: [] },
      { tokens: [], builtInColoursShown: false }
    );
    expect(hidden.builtInColoursShown).toBe(false);
    expect(
      resolveSiteStyle(
        { tokens: { tokens: [] } },
        { tokens: { tokens: [], builtInColoursShown: false } }
      ).tokens?.builtInColoursShown
    ).toBe(false);
  });

  it("stores nothing while they are shown as the code shows them", () => {
    for (const builtInColoursShown of [true, undefined]) {
      expect(
        tokenOverrideOf(
          { tokens: [] },
          {
            tokens: [],
            ...(builtInColoursShown === undefined
              ? {}
              : { builtInColoursShown }),
          }
        )
      ).not.toHaveProperty("builtInColoursShown");
    }
  });

  it("stores them shown over a site's code that hides them", () => {
    const code = { tokens: [], builtInColoursShown: false };
    expect(
      tokenOverrideOf(code, { tokens: [], builtInColoursShown: true })
        .builtInColoursShown
    ).toBe(true);
    expect(
      tokenOverrideOf(code, { tokens: [], builtInColoursShown: false })
    ).not.toHaveProperty("builtInColoursShown");
    expect(
      resolveSiteStyle({ tokens: code }, { tokens: { tokens: [] } }).tokens
        ?.builtInColoursShown
    ).toBe(false);
  });
});
