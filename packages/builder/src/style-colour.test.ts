/**
 * What a colour affordance may do with a stored value, and — mostly — what it
 * may not.
 *
 * The leaves come from `STYLE_CATALOG` rather than being written here, for the
 * reason `style-numeric.test.ts` gives: a hand-made leaf asserting
 * `tokenKinds: ["color"]` would pass against a hardcoded rule in the module
 * just as happily as against the catalog being asked, and those are the two
 * implementations that have to be told apart.
 */
import {
  STYLE_CATALOG,
  emitTokenBlocks,
  type NodeStyles,
  type ContrastResult,
  type SiteTokenSet,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  activeTokenMode,
  colourHexOf,
  colourShowable,
  colourTokenFor,
  colourTokensFor,
  contrastObscuredBy,
  contrastObscuredIn,
  contrastOf,
  contrastPartnerOf,
  contrastRatioText,
  contrastRoleOf,
  emitsContrastPartner,
} from "./style-colour";

/** One catalog entry, as the array actually stores them. */
interface CatalogEntry {
  readonly property: string;
  readonly shape: Record<string, unknown>;
}

const entry = (property: string): CatalogEntry => {
  const found = (STYLE_CATALOG as unknown as readonly CatalogEntry[]).find(
    candidate => candidate.property === property
  );
  if (found === undefined) throw new Error(`no catalog entry for ${property}`);
  return found;
};

const leaf = (property: string): StyleLeaf =>
  entry(property).shape as unknown as StyleLeaf;

/** The leaf at one field of an object-shaped property. */
const field = (property: string, name: string): StyleLeaf => {
  const fields = entry(property).shape.fields as Record<string, StyleLeaf>;
  const found = fields[name];
  if (found === undefined) throw new Error(`${property} has no ${name} field`);
  return found;
};

const COLOR = leaf("color");
const LINK_COLOR = leaf("linkColor");
const LINK_COLOR_HOVER = leaf("linkColorHover");
const BACKGROUND_COLOR = leaf("backgroundColor");
const BORDER_COLOR = field("border", "color");
/** A leaf that is not a colour at all, and admits no colour token. */
const OPACITY = leaf("opacity");

/**
 * A site whose second token has been RENAMED, so its identity and its name
 * differ.
 *
 * That divergence is the only state in which storing the wrong one of the two
 * has a symptom, so a fixture where every id equals its name would let the
 * defect this module exists to prevent pass every assertion below.
 */
const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "color.ink", kind: "color", values: { light: "#111111" } },
    // A token whose value resolves somewhere else. Valid, storable, and not
    // paintable by this package.
    { name: "color.themed", kind: "color", values: { light: "var(--brand)" } },
    {
      id: "color.primary",
      name: "brand.main",
      kind: "color",
      values: { light: "#ffffff", dark: "#000000" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

describe("which tokens a colour control offers", () => {
  it("offers the site's colour tokens and withholds the others", () => {
    const offered = colourTokensFor(COLOR, TOKENS).map(token => token.name);
    expect(offered).toContain("color.ink");
    expect(offered).toContain("color.themed");
    expect(offered).toContain("brand.main");
    // The positive control for the KIND filter: the site defines a dimension
    // token, and the engine's defaults carry two more, so an empty exclusion
    // list would show every one of them here.
    expect(TOKENS.tokens.some(token => token.kind === "dimension")).toBe(true);
    expect(offered).not.toContain("space.4");
    expect(offered).not.toContain("content.width");
    expect(offered).not.toContain("font.body");
  });

  it("offers the ENGINE's default colour tokens, which every page emits", () => {
    // `PageRenderer` compiles with `resolveSiteTokens`, which layers these
    // underneath whatever the site defines — so a page emits them whether or
    // not the site has any tokens of its own. A picker reading the raw override
    // set offered none of them, and could not resolve a document referencing
    // one.
    const bare = colourTokensFor(COLOR, { tokens: [] }).map(t => t.name);
    expect(bare).toContain("color.text");
    expect(bare).toContain("color.background");
    expect(bare).toContain("color.primary");
    // Still only colours.
    expect(bare).not.toContain("space.4");
  });

  it("still offers nothing when the question was never asked", () => {
    // `undefined` is not "the site has the defaults" — it is "no host has said
    // what this site holds", and answering with the defaults would be a claim.
    expect(colourTokensFor(COLOR, undefined)).toEqual([]);
  });

  it("resolves a stored reference to a DEFAULT token", () => {
    expect(colourTokenFor("color.primary", { tokens: [] })?.name).toBe(
      "color.primary"
    );
  });

  it("offers nothing at a leaf whose catalog entry admits no colour token", () => {
    // Asked of the leaf rather than of its kind: `opacity` is a number leaf and
    // the reason it offers no colour token is that the CATALOG gives it no
    // colour in `tokenKinds`, which is the fact a control must read.
    expect(OPACITY.tokenKinds).not.toContain("color");
    expect(colourTokensFor(OPACITY, TOKENS)).toEqual([]);
  });

  it("offers nothing when the host supplied no table", () => {
    expect(colourTokensFor(COLOR, undefined)).toEqual([]);
  });

  it("carries the IDENTITY to store and the NAME to read, which differ", () => {
    // The load-bearing assertion of this file. A stored `{ $token }` holds the
    // identity, because `emitTokenBlocks` writes each custom property from
    // `tokenIdentity` while the compiler composes `var(...)` from the stored
    // string verbatim. Offering the NAME would store a reference to a property
    // nothing declares — the style vanishes and the page still renders.
    const renamed = colourTokensFor(COLOR, TOKENS).find(
      token => token.name === "brand.main"
    );
    expect(renamed).toBeDefined();
    expect(renamed?.identity).toBe("color.primary");
    expect(renamed?.identity).not.toBe(renamed?.name);
  });

  it("falls back to the name as identity for a token that has no id", () => {
    // The continuity half of the same rule, and what every token stored before
    // `id` existed relies on.
    const original = colourTokensFor(COLOR, TOKENS).find(
      token => token.name === "color.ink"
    );
    expect(original?.identity).toBe("color.ink");
  });
});

describe("resolving a stored reference back to its token", () => {
  it("finds a renamed token by the identity a document stores", () => {
    const found = colourTokenFor("color.primary", TOKENS);
    expect(found?.name).toBe("brand.main");
    expect(found?.colour).toBe("#ffffff");
  });

  it("does NOT find it by the name an author now reads", () => {
    // The separating case. A lookup keyed on the name would answer here, and
    // would answer nothing for the identity above — reversing which references
    // resolve.
    expect(colourTokenFor("brand.main", TOKENS)).toBeUndefined();
  });

  it("answers undefined for a token this site does not define", () => {
    expect(colourTokenFor("color.nothing", TOKENS)).toBeUndefined();
  });
});

describe("the hex a stored colour denotes", () => {
  it("reads the notations the engine's contrast parser reads", () => {
    expect(colourHexOf("#3b82f6", TOKENS)).toBe("#3b82f6");
    expect(colourHexOf("rgb(59 130 246)", TOKENS)).toBe("#3b82f6");
    expect(colourHexOf("rgba(59, 130, 246, 0.5)", TOKENS)).toBe("#3b82f680");
  });

  it("expands a short hex the way CSS does", () => {
    expect(colourHexOf("#fff", TOKENS)).toBe("#ffffff");
  });

  it("keeps channels on the ENGINE's scale rather than the picker's", () => {
    // The separating test for the one place two `Rgb` types meet. The engine's
    // channels are 0-255 and `@nextlyhq/ui`'s are [0, 1], and `toHex` CLAMPS —
    // so handing it the engine's shape does not throw or warn, it silently
    // answers `#ffffff` for every colour but black. These three channels are
    // each above 1 and below 4, which is the range where the two scales are
    // furthest apart in effect.
    expect(colourHexOf("rgb(1 2 3)", TOKENS)).toBe("#010203");
    expect(colourHexOf("rgb(1 2 3)", TOKENS)).not.toBe("#ffffff");
  });

  it("resolves a token reference through the site's table", () => {
    expect(colourHexOf({ $token: "color.ink" }, TOKENS)).toBe("#111111");
    // By identity, so a renamed token still paints.
    expect(colourHexOf({ $token: "color.primary" }, TOKENS)).toBe("#ffffff");
  });

  it("answers undefined for a reference the site does not define", () => {
    expect(colourHexOf({ $token: "color.nothing" }, TOKENS)).toBeUndefined();
    expect(colourHexOf({ $token: "color.ink" }, undefined)).toBeUndefined();
  });

  it("REFUSES every value that means resolve-this-somewhere-else", () => {
    // These are the values a swatch must not be painted with: each is a valid
    // colour the engine accepts, and each resolves against the surface it is
    // drawn on — so painted in the inspector they would show the author a
    // colour their page does not have.
    expect(colourHexOf("var(--site-color-primary)", TOKENS)).toBeUndefined();
    expect(colourHexOf("currentcolor", TOKENS)).toBeUndefined();
    expect(colourHexOf("inherit", TOKENS)).toBeUndefined();
    expect(colourHexOf("initial", TOKENS)).toBeUndefined();
    expect(colourHexOf("unset", TOKENS)).toBeUndefined();
  });

  it("refuses the notations the engine's parser declines, rather than guessing", () => {
    // Valid CSS colours that `parseColor` deliberately does not read. The
    // control keeps its text field for them and rewrites nothing.
    expect(colourHexOf("red", TOKENS)).toBeUndefined();
    expect(colourHexOf("oklch(0.7 0.1 200)", TOKENS)).toBeUndefined();
    expect(
      colourHexOf("color-mix(in srgb, red, blue)", TOKENS)
    ).toBeUndefined();
    expect(colourHexOf("hsl(210 90% 60%)", TOKENS)).toBeUndefined();
  });

  it("refuses a value that is not a colour at all", () => {
    expect(colourHexOf(undefined, TOKENS)).toBeUndefined();
    expect(colourHexOf(16, TOKENS)).toBeUndefined();
    expect(colourHexOf("16px", TOKENS)).toBeUndefined();
    // An object at a scalar position, from an import or the API. Refused rather
    // than coerced: offering to edit it would offer to replace it.
    expect(colourHexOf({ value: "#fff" } as never, TOKENS)).toBeUndefined();
    // A token key holding something that is not a name.
    expect(colourHexOf({ $token: 4 } as never, TOKENS)).toBeUndefined();
  });
});

describe("which side of a contrast pair a leaf sits on", () => {
  it("reads the CSS property, so the link colours are covered unnamed", () => {
    // The property under test is that the role is DERIVED. `linkColor` and
    // `linkColorHover` are separate catalog keys that both write `color`, and a
    // rule listing catalog keys would have to name them; this covers them
    // because it reads what they emit.
    expect(LINK_COLOR.cssProperty).toBe("color");
    expect(LINK_COLOR_HOVER.cssProperty).toBe("color");
    expect(contrastRoleOf(COLOR)).toBe("foreground");
    expect(contrastRoleOf(LINK_COLOR)).toBe("foreground");
    expect(contrastRoleOf(LINK_COLOR_HOVER)).toBe("foreground");
  });

  it("names the background", () => {
    expect(contrastRoleOf(BACKGROUND_COLOR)).toBe("background");
  });

  it("puts a border on neither side", () => {
    // A border is a colour leaf and still has no place in a text-contrast pair:
    // reporting it against the block's background would answer a question
    // nobody asked, against a threshold that does not apply.
    expect(BORDER_COLOR.kind).toBe("color");
    expect(contrastRoleOf(BORDER_COLOR)).toBeUndefined();
  });

  it("puts a leaf that is not a colour on neither side", () => {
    expect(contrastRoleOf(OPACITY)).toBeUndefined();
  });
});

describe("which property holds the other half of the pair", () => {
  it("finds the partner in the catalog rather than naming it", () => {
    expect(contrastPartnerOf(COLOR)).toBe("backgroundColor");
    expect(contrastPartnerOf(BACKGROUND_COLOR)).toBe("color");
  });

  it("pairs a link colour against the block's own background", () => {
    expect(contrastPartnerOf(LINK_COLOR)).toBe("backgroundColor");
    expect(contrastPartnerOf(LINK_COLOR_HOVER)).toBe("backgroundColor");
  });

  it("refuses a leaf that styles a DESCENDANT as a partner", () => {
    // Asserted on the PREDICATE rather than through `contrastPartnerOf`, and
    // the reason is worth recording: `color` precedes `linkColor` in
    // `STYLE_CATALOG`, so the search returns "color" by array order whether or
    // not the selector is read. Measured — deleting the descendant rule and
    // re-running this file changed nothing at all. Through the search, this
    // property has NO coverage; here it has some.
    expect(LINK_COLOR.descendant).toBeDefined();
    expect(LINK_COLOR_HOVER.descendant).toBeDefined();
    expect(emitsContrastPartner(LINK_COLOR, "color")).toBe(false);
    expect(emitsContrastPartner(LINK_COLOR_HOVER, "color")).toBe(false);
    // The positive control: the same call on the block's own colour accepts,
    // so the `false` above is the selector being read rather than the predicate
    // refusing everything.
    expect(emitsContrastPartner(COLOR, "color")).toBe(true);
    expect(emitsContrastPartner(BACKGROUND_COLOR, "background-color")).toBe(
      true
    );
  });

  it("refuses a leaf that emits a different property, or is not a colour", () => {
    expect(emitsContrastPartner(COLOR, "background-color")).toBe(false);
    expect(emitsContrastPartner(OPACITY, "color")).toBe(false);
  });

  it("gives a leaf outside the pairing no partner", () => {
    expect(contrastPartnerOf(BORDER_COLOR)).toBeUndefined();
    expect(contrastPartnerOf(OPACITY)).toBeUndefined();
  });
});

describe("the contrast a pair reports", () => {
  it("reports the specification's own extreme", () => {
    // Black on white is 21:1 exactly, which is a value WCAG states rather than
    // one this repository chose — so it separates a correct implementation from
    // a plausible one.
    const result = contrastOf("#000000", "#ffffff", TOKENS);
    expect(result?.ratio).toBeCloseTo(21, 5);
    expect(result?.level).toBe("AAA");
    expect(result?.passesBodyText).toBe(true);
  });

  it("measures a pair written as tokens, by resolving both sides first", () => {
    // The improvement over checking literals only, and the reason resolution
    // happens before the engine is asked: in a design system the ordinary pair
    // is two token references, and declining those would leave the readout
    // silent exactly where it is most wanted.
    const result = contrastOf(
      { $token: "color.ink" },
      { $token: "color.primary" },
      TOKENS
    );
    // `#111111` on `#ffffff`.
    expect(result?.ratio).toBeGreaterThan(18);
    expect(result?.passesBodyText).toBe(true);
  });

  it("reports a failing pair as failing", () => {
    const result = contrastOf("#777777", "#888888", TOKENS);
    expect(result?.level).toBe("fail");
    expect(result?.passesBodyText).toBe(false);
  });

  it("answers undefined when EITHER side cannot be read", () => {
    // Not a default, and not an approximation. A ratio computed from a colour
    // that was misread is a number an author will act on.
    expect(contrastOf("var(--brand)", "#ffffff", TOKENS)).toBeUndefined();
    expect(contrastOf("#000000", "var(--brand)", TOKENS)).toBeUndefined();
    expect(contrastOf("#000000", undefined, TOKENS)).toBeUndefined();
    expect(contrastOf(undefined, "#ffffff", TOKENS)).toBeUndefined();
    // A named colour is a colour the engine accepts and this cannot measure.
    expect(contrastOf("red", "#ffffff", TOKENS)).toBeUndefined();
  });

  it("agrees with the swatch about which values are readable", () => {
    // The two must not disagree: a value the panel painted a swatch for and
    // then reported no figure about — or the reverse — reads as a broken
    // control. They share `colourHexOf`, and this is what would fail if a
    // second resolution were introduced.
    for (const value of [
      "#3b82f6",
      "rgb(1 2 3)",
      "red",
      "var(--x)",
      "currentcolor",
      { $token: "color.primary" },
      { $token: "color.nothing" },
    ]) {
      const readable = colourHexOf(value, TOKENS) !== undefined;
      const measured = contrastOf(value, "#ffffff", TOKENS) !== undefined;
      expect(measured).toBe(readable);
    }
  });
});

describe("how a ratio reads", () => {
  it("reports one decimal place, as the thresholds are written", () => {
    const result = contrastOf("#000000", "#ffffff", TOKENS);
    expect(result).toBeDefined();
    if (result !== undefined) expect(contrastRatioText(result)).toBe("21.0:1");
  });

  it("rounds the DISPLAY without moving the verdict", () => {
    // A ratio just under the body-text threshold displays as the threshold and
    // still reports as failing. That pair looks contradictory and is the honest
    // reading: the rule is on the ratio, not on its rendering. Constructed
    // rather than searched for, so the case is stated rather than hoped for.
    const near: ContrastResult = {
      ratio: 4.49,
      level: "AA-large",
      passesBodyText: false,
    };
    expect(contrastRatioText(near)).toBe("4.5:1");
    expect(near.passesBodyText).toBe(false);
  });
});

describe("what a preset swatch may be painted with", () => {
  it("carries a RESOLVED colour, not the token's raw value", () => {
    // A preset button paints what it is handed, so the resolution has to happen
    // before the value reaches it.
    const offered = colourTokensFor(COLOR, TOKENS);
    const ink = offered.find(token => token.name === "color.ink");
    expect(ink?.colour).toBe("#111111");
    expect(ink?.swatch).toBe("#111111");
  });

  it("paints NOTHING for a token that resolves somewhere else", () => {
    // The separating case, and the one that made this a defect: `var(--brand)`
    // is a valid colour a site may store in a token, and painted raw into the
    // inspector it resolves against the PANEL rather than the canvas.
    const themed = colourTokensFor(COLOR, TOKENS).find(
      token => token.name === "color.themed"
    );
    // Still offered, so the reference stays choosable.
    expect(themed).toBeDefined();
    // And still truthful about what the site stores.
    expect(themed?.colour).toBe("var(--brand)");
    // But not paintable.
    expect(themed?.swatch).toBeUndefined();
  });

  it("paints only hex, or nothing", () => {
    // Stated as a property the RESOLVER does not decide, rather than by calling
    // the same function that produced the field: comparing `swatch` against
    // `colourHexOf(colour)` is the expression that built it, so it holds for
    // any implementation including a wrong one.
    for (const token of colourTokensFor(COLOR, TOKENS)) {
      if (token.swatch === undefined) continue;
      expect(token.swatch).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });
});

describe("which stored values a colour control can show", () => {
  it("shows a literal, a reference, and nothing set", () => {
    expect(colourShowable(undefined)).toBe(true);
    expect(colourShowable("#3b82f6")).toBe(true);
    expect(colourShowable("oklch(0.7 0.1 200)")).toBe(true);
    expect(colourShowable({ $token: "color.ink" })).toBe(true);
  });

  it("REFUSES a value no colour surface can represent", () => {
    // An object at a scalar position, from an import or the API. Routed to a
    // colour control it would project to an empty field and read as unset while
    // the value goes on compiling — so it has to keep the read-only surface.
    expect(colourShowable({ value: "#fff" } as never)).toBe(false);
    expect(colourShowable(16)).toBe(false);
  });
});

describe("a translucent background withholds the verdict", () => {
  it("reports nothing when the background carries alpha", () => {
    // `checkContrast` composites a background over WHITE, which is wrong for a
    // block sitting on a dark backdrop — and wrong in the direction that
    // matters: this pair reports as passing after white compositing while
    // rendering nearly invisible over black.
    const overWhite = contrastOf("#ffffff", "rgba(0, 0, 0, 0.5)", TOKENS);
    expect(overWhite).toBeUndefined();
    // The positive control: the SAME pair opaque is measured, so the refusal
    // above is the alpha and not the parser declining the notation.
    const opaque = contrastOf("#ffffff", "rgba(0, 0, 0, 1)", TOKENS);
    expect(opaque?.ratio).toBeCloseTo(21, 5);
  });

  it("still measures a translucent FOREGROUND, which composites over a known colour", () => {
    // Not refused: what sits behind the foreground is the background, and that
    // is a colour this does know.
    const result = contrastOf("rgba(0, 0, 0, 0.5)", "#ffffff", TOKENS);
    expect(result).toBeDefined();
    expect(result?.ratio).toBeGreaterThan(1);
  });

  it("refuses an alpha hex background as readily as an rgba() one", () => {
    expect(contrastOf("#ffffff", "#00000080", TOKENS)).toBeUndefined();
  });
});

describe("which mode a token resolves in", () => {
  const media: SiteTokenSet = { ...TOKENS, darkMode: "media" };
  const attribute: SiteTokenSet = { ...TOKENS, darkMode: "attribute" };

  it("follows the system only where the site said to", () => {
    // `emitTokenBlocks` wraps the dark block in
    // `@media (prefers-color-scheme:dark)` for the media strategy, so the
    // canvas switches with the system and nothing tells the panel.
    expect(activeTokenMode(media, true)).toBe("dark");
    expect(activeTokenMode(media, false)).toBe("light");
  });

  it("stays light on the attribute strategy, which the panel cannot observe", () => {
    // The dark block is written under `[data-nx-theme="dark"]`, set by the HOST
    // on an ancestor of its choosing. A stated limit, not a claim.
    expect(activeTokenMode(attribute, true)).toBe("light");
    // And the default, when a site names no strategy at all.
    expect(activeTokenMode(TOKENS, true)).toBe("light");
    expect(activeTokenMode(undefined, true)).toBe("light");
  });

  it("resolves a reference to the value the canvas is actually showing", () => {
    // The separating case: this token differs between modes, so a resolution
    // pinned to light would paint a swatch the canvas contradicts.
    const ref = { $token: "color.primary" };
    expect(colourHexOf(ref, media, "light")).toBe("#ffffff");
    expect(colourHexOf(ref, media, "dark")).toBe("#000000");
  });

  it("falls back to light for a token defined only for light", () => {
    // Which is what the canvas does too: no dark declaration is emitted for it,
    // so the light one goes on applying.
    const ink = TOKENS.tokens.find(token => token.name === "color.ink");
    expect(ink?.values.dark).toBeUndefined();
    expect(colourHexOf({ $token: "color.ink" }, media, "dark")).toBe("#111111");
  });

  it("paints preset swatches in the same mode", () => {
    const dark = colourTokensFor(COLOR, media, "dark").find(
      token => token.name === "brand.main"
    );
    expect(dark?.colour).toBe("#000000");
    expect(dark?.swatch).toBe("#000000");
  });

  it("measures contrast in that mode too", () => {
    // Light: #111111 on #ffffff, high. Dark: #111111 on #000000, low. A readout
    // pinned to light would report a passing pair while the canvas shows a
    // failing one.
    const fg = { $token: "color.ink" };
    const bg = { $token: "color.primary" };
    expect(contrastOf(fg, bg, media, "light")?.passesBodyText).toBe(true);
    expect(contrastOf(fg, bg, media, "dark")?.passesBodyText).toBe(false);
  });
});

describe("only tokens the canvas will declare are offered", () => {
  it("withholds a token whose NAME cannot become a custom property", () => {
    // `emitTokenBlocks` drops it and names the issue, so a reference stored
    // from the picker would point at a property nothing declares — the style
    // vanishes and the page still renders.
    const set: SiteTokenSet = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#111111" } },
        { name: "color primary!", kind: "color", values: { light: "#222222" } },
      ],
    };
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).toContain("color.ok");
    expect(names).not.toContain("color primary!");
  });

  it("withholds the SECOND of two identities that collide on one property", () => {
    // `color.primary-dark` and `color-primary.dark` both become
    // `--site-color-primary-dark`. The engine emits the first and refuses the
    // second rather than letting one resolve to the other's value.
    const set: SiteTokenSet = {
      tokens: [
        {
          name: "color.primary-dark",
          kind: "color",
          values: { light: "#111111" },
        },
        {
          name: "color-primary.dark",
          kind: "color",
          values: { light: "#222222" },
        },
      ],
    };
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).toContain("color.primary-dark");
    expect(names).not.toContain("color-primary.dark");
  });

  it("offers a set with no collisions untouched", () => {
    // The positive control: the filter must remove those two shapes and
    // nothing else, or every picker would come back empty.
    const names = colourTokensFor(COLOR, TOKENS).map(t => t.name);
    expect(names).toContain("color.ink");
    expect(names).toContain("brand.main");
    expect(names).toContain("color.themed");
  });
});

describe("what stands between a contrast pair", () => {
  const none = () => undefined;

  it("names a property that puts something over the colours", () => {
    // Black text on `#ffffff` with an opaque black gradient over it reports
    // 21:1 and renders black on black.
    expect(
      contrastObscuredBy(p => (p === "backgroundGradient" ? "x" : undefined))
    ).toBe("backgroundGradient");
    expect(contrastObscuredBy(p => (p === "opacity" ? 0.5 : undefined))).toBe(
      "opacity"
    );
    expect(
      contrastObscuredBy(p => (p === "filter" ? "blur(2px)" : undefined))
    ).toBe("filter");
    expect(
      contrastObscuredBy(p => (p === "mixBlendMode" ? "multiply" : undefined))
    ).toBe("mixBlendMode");
    expect(contrastObscuredBy(p => (p === "background" ? {} : undefined))).toBe(
      "background"
    );
  });

  it("names an inset shadow, which paints over the background", () => {
    // Black text on white under an opaque black inset shadow renders black on
    // black and reported 21:1. Counted whether or not the value says `inset`:
    // a `cssValue` leaf is validated for syntax only, so nothing here decides
    // what a shadow means.
    expect(
      contrastObscuredBy(prop =>
        prop === "boxShadow" ? "inset 0 0 0 99px #000" : undefined
      )
    ).toBe("boxShadow");
    expect(
      contrastObscuredBy(prop =>
        prop === "boxShadow" ? "0 1px 2px #0003" : undefined
      )
    ).toBe("boxShadow");
  });

  it("names nothing when the pair is drawn plainly", () => {
    expect(contrastObscuredBy(none)).toBeUndefined();
    // And is not fooled by an unrelated property being set.
    expect(
      contrastObscuredBy(p => (p === "padding" ? "4px" : undefined))
    ).toBeUndefined();
  });
});

describe("the emitter decides which tokens are offered", () => {
  it("withholds a token whose VALUE the canvas will not write", () => {
    // The reason a partial copy of the emitter's rules is worse than none: the
    // name here is fine and the identity collides with nothing, so a check that
    // knew only those two rules would offer this token — and the canvas emits
    // no property for it, so a stored reference loses the style silently.
    const set: SiteTokenSet = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#111111" } },
        {
          name: "color.bad",
          kind: "color",
          values: { light: "url(https://example.com/a.png)" },
        },
      ],
    };
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).toContain("color.ok");
    expect(names).not.toContain("color.bad");
  });

  it("withholds a token whose value CONTRADICTS its declared kind", () => {
    // The engine emits this one deliberately, with a warning, because refusing
    // it would cost the author the token on a verdict it is not certain enough
    // to act on. The browser then drops `color: var(...)` where the token is
    // used — so a picker offering it hands over a reference that does nothing.
    // A filter reading only the declared kind cannot see this.
    const set: SiteTokenSet = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#111111" } },
        { name: "color.wrong", kind: "color", values: { light: "16px" } },
      ],
    };
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).toContain("color.ok");
    expect(names).not.toContain("color.wrong");
  });

  it("KEEPS a token whose other mode is broken but whose active one is not", () => {
    // A token that renders perfectly well in light, and badly in dark. Judged
    // across both modes at once it looks unusable; judged in the mode the
    // canvas is showing it is fine. Removing it from a light-mode picker takes
    // away a token that works from an author who cannot see the problem.
    const set: SiteTokenSet = {
      tokens: [
        {
          name: "color.half",
          kind: "color",
          values: { light: "#ffffff", dark: "16px" },
        },
      ],
    };
    expect(colourTokensFor(COLOR, set, "light").map(t => t.name)).toContain(
      "color.half"
    );
    // And withheld in the mode where it really is broken.
    expect(colourTokensFor(COLOR, set, "dark").map(t => t.name)).not.toContain(
      "color.half"
    );
  });

  it("WITHHOLDS one whose other mode is refused, which costs both modes", () => {
    // The other half of the rule above, and the one that reverses it. A kind
    // mismatch is mode-local: the emitter reports it and writes the value
    // anyway, so a bad dark value leaves a good light one resolving. A refusal
    // is not: the emitter scans BOTH values for anything unsafe or fetching and
    // skips the whole token, so a dark `url(...)` leaves the light value with
    // no custom property either. Scoping the whole question to the active mode
    // therefore offers a preset whose reference resolves to nothing, in the
    // very mode that looked fine.
    const set: SiteTokenSet = {
      tokens: [
        {
          name: "color.fetches",
          kind: "color",
          values: { light: "#ffffff", dark: "url(https://example.com/a.png)" },
        },
      ],
    };

    // Ground truth from the emitter itself, so this asserts the engine's real
    // behaviour rather than a belief about it: nothing is written for the token
    // at all, in either mode.
    expect(emitTokenBlocks(set, ":root").css).toBe("");

    expect(colourTokensFor(COLOR, set, "light").map(t => t.name)).not.toContain(
      "color.fetches"
    );
    expect(colourTokensFor(COLOR, set, "dark").map(t => t.name)).not.toContain(
      "color.fetches"
    );
  });

  it("does not hand a claimed property to the token the engine REFUSED", () => {
    // The two verdicts have different scopes, and the ORDER they are asked in
    // decides who owns a contested property. The engine skips a refused token
    // before the collision check and writes an accepted one even when its kind
    // is wrong — so a kind-mismatched token still takes the property, and the
    // token colliding with it is refused.
    //
    // Asking the kind first inverts that: the mismatched token is dropped here,
    // the refused one inherits the property, and the picker offers it painted
    // with its OWN colour while the page resolves the other's value.
    const set: SiteTokenSet = {
      // Both compose "--site-color-primary-dark"; only the spelling differs.
      tokens: [
        {
          name: "color.primary-dark",
          kind: "color",
          values: { light: "16px" },
        },
        {
          name: "color-primary.dark",
          kind: "color",
          values: { light: "#123456" },
        },
      ],
    };

    // Ground truth from the emitter: the FIRST token takes the property, with
    // the value that does nothing, and the second is refused outright.
    const emitted = emitTokenBlocks(set, ":root");
    expect(emitted.css).toContain("--site-color-primary-dark:16px");
    expect(emitted.css).not.toContain("#123456");

    // So neither is choosable: one resolves to nothing, and the other is not
    // declared at all.
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).not.toContain("color-primary.dark");
    expect(names).not.toContain("color.primary-dark");
  });

  it("withholds a token with no usable light value", () => {
    const set = {
      tokens: [
        { name: "color.ok", kind: "color", values: { light: "#111111" } },
        { name: "color.empty", kind: "color", values: { light: 4 } },
      ],
    } as unknown as SiteTokenSet;
    const names = colourTokensFor(COLOR, set).map(t => t.name);
    expect(names).toContain("color.ok");
    expect(names).not.toContain("color.empty");
  });
});

describe("what obscures a pair anywhere on the node", () => {
  it("sees a base-state gradient while a hover rule is being edited", () => {
    // The cascade is why this cannot be address-scoped: a base gradient goes on
    // covering the background when a hover rule sets only the two colours, so
    // an address-scoped look reports a ratio for pixels the gradient hides.
    const styles = {
      base: { base: { backgroundGradient: "linear-gradient(#000, #000)" } },
      hover: { base: { color: "#000000", backgroundColor: "#ffffff" } },
    } as unknown as NodeStyles;
    expect(contrastObscuredIn(styles)).toBe("backgroundGradient");
  });

  it("sees one set at another breakpoint", () => {
    const styles = {
      base: {
        base: { color: "#000000", backgroundColor: "#ffffff" },
        mobile: { opacity: 0.5 },
      },
    } as unknown as NodeStyles;
    expect(contrastObscuredIn(styles)).toBe("opacity");
  });

  it("names nothing for a node carrying only the pair", () => {
    // The positive control: it must find those and nothing else, or every
    // verdict would be withheld.
    const styles = {
      base: { base: { color: "#000000", backgroundColor: "#ffffff" } },
    } as unknown as NodeStyles;
    expect(contrastObscuredIn(styles)).toBeUndefined();
    expect(contrastObscuredIn(undefined)).toBeUndefined();
  });
});
