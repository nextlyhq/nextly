/**
 * The stylesheet a whole site shares.
 *
 * Two properties carry it. The bytes must be identical to what a page would have inlined for the
 * same tiers — otherwise a site that shares and a page that inlines render differently — and the
 * hash must name exactly those bytes, so a change that alters nothing invalidates nothing and a
 * change that alters anything cannot be missed.
 */
import { describe, expect, it } from "vitest";

import type { NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { NamedClass } from "./named-class";
import { previewStateClass } from "./compile-page";
import { CONTENT_WIDTH_CLASS } from "./node-class";
import { compileSiteSheet } from "./site-sheet";

const styles = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { base: values } }) as unknown as NodeStyles;

const card: NamedClass = {
  id: "c1",
  slug: "card",
  orderIndex: 0,
  styles: styles({ color: "blue" }),
};

/** The token the content-width rule reads, so a sheet under test declares it. */
const WIDTH_TOKEN = {
  name: "content.width",
  kind: "dimension",
  values: { light: "72rem" },
} as never;

const sheet = (over: Record<string, unknown> = {}) =>
  compileSiteSheet({
    breakpoints: FIXTURE_BREAKPOINTS,
    classes: [card],
    blockBases: { "core/box": styles({ color: "green" }) },
    ...over,
  });

describe("what the shared sheet carries", () => {
  it("emits every block type's default, not only the ones a page uses", () => {
    // The difference from a page compile, and the reason this cannot just call it with the real
    // document: a site sheet is shared, so it carries defaults for types this page never used.
    const { css } = sheet({
      blockBases: {
        "core/box": styles({ color: "green" }),
        "core/text": styles({ color: "black" }),
      },
    });

    expect(css).toContain("color: green");
    expect(css).toContain("color: black");
  });

  it("emits the named classes", () => {
    expect(sheet().css).toContain(".nx-c-card");
  });

  it("emits tokens on the document root, not the page root", () => {
    // A custom property is read by everything that inherits it, including markup this compiler
    // never wrote. Scoped to the page root it would be unreadable outside a compiled page.
    const { css } = sheet({
      tokens: {
        tokens: [
          {
            name: "color.primary",
            kind: "color" as const,
            values: { light: "#123456" },
          },
        ],
      },
    });

    expect(css).toContain(":root");
    expect(css).toContain("#123456");
  });

  it("emits self-hosted font faces", () => {
    const { css } = sheet({
      fonts: [{ family: "Inter", src: [{ url: "/fonts/inter.woff2" }] }],
    });

    expect(css).toContain("@font-face");
    expect(css).toContain("Inter");
  });

  it("carries no node-level styling, which belongs to a page", () => {
    // The synthetic nodes exist only to make each type present. If one of them ever contributed a
    // rule, the shared sheet would carry a page's content.
    expect(sheet().css).not.toContain("site-sheet-");
  });
});

describe("the content-width rule", () => {
  it("constrains the class the container block applies, and centres it", () => {
    const css = sheet({ tokens: { tokens: [WIDTH_TOKEN] } }).css;
    expect(css).toContain(
      ".nx-pb-page :where(.nx-pb-contained){max-width:var(--site-content-width);margin-inline:auto}"
    );
  });

  it("reads the property under the prefix the tokens were declared with", () => {
    // The failure this guards is silent rather than loud: a reference under one
    // prefix and a declaration under another leaves the custom property
    // unresolved, which invalidates the declaration instead of reporting.
    const css = sheet({
      tokenPrefix: "--brand-",
      tokens: { tokens: [WIDTH_TOKEN] },
    }).css;
    expect(css).toContain("var(--brand-content-width)");
    expect(css).not.toContain("var(--site-content-width)");
  });

  it("falls back to the default prefix exactly as the token emitter does", () => {
    // A refused prefix is REPLACED there rather than rejected, so a reference
    // built from the raw value would name a property nothing declared.
    const css = sheet({
      tokenPrefix: "not a prefix",
      tokens: { tokens: [WIDTH_TOKEN] },
    }).css;
    expect(css).toContain("var(--site-content-width)");
  });

  it("cannot match outside the page root", () => {
    // The invariant `override-contract.md` states: nothing the builder emits
    // may match an element outside `.nx-pb-page`. An unanchored `:where()`
    // matches anywhere, so a host element wearing this class — or a second
    // rendered page — would be constrained by a sheet that is not its own.
    const css = sheet({ tokens: { tokens: [WIDTH_TOKEN] } }).css;
    const rule = css
      .split("\n")
      .find(line => line.includes(CONTENT_WIDTH_CLASS));
    expect(rule).toBeDefined();
    expect(rule).toMatch(/^\.nx-pb-page\s/);
  });

  it("is not written at all when there is no token set to read", () => {
    // The rule exists to reference a custom property. With no tokens the
    // property is never declared, so the rule could only ever be inert bytes on
    // every page of the site.
    expect(sheet().css).not.toContain("nx-pb-contained");
  });

  it("weighs nothing, so anything an author states beats it", () => {
    // `:where()` is the whole mechanism. Without it a site default would beat a
    // node's own max-width whenever the node's rule did not out-specify it.
    expect(sheet({ tokens: { tokens: [WIDTH_TOKEN] } }).css).toContain(
      ":where(.nx-pb-contained)"
    );
  });

  it("follows the token's IDENTITY when a site has renamed it", () => {
    // A rename keeps the identity and changes only the display name, and the
    // custom property is built from the identity — so the property is still
    // declared and containment must still apply. A check keyed on the name
    // withdraws it from every opted-in section while `--site-content-width` is
    // sitting in the sheet above.
    const renamed = {
      id: "content.width",
      name: "page.measure",
      kind: "dimension",
      values: { light: "72rem" },
    } as never;
    const css = sheet({ tokens: { tokens: [renamed] } }).css;
    expect(css).toContain("nx-pb-contained");
    expect(css).toContain("var(--site-content-width)");
  });

  it.each(["none", "inherit", "initial", "unset", "auto"])(
    "writes nothing when the width is %s, which bounds nothing",
    width => {
      // Legal for `max-width` and no maximum at all, so `margin-inline: auto`
      // would centre a node that has an authored width and nothing bounding
      // it — the failure the whole gate exists to refuse.
      const unbounded = {
        id: "content.width",
        name: "content.width",
        kind: "dimension",
        values: { light: width },
      } as never;
      const css = sheet({ tokens: { tokens: [unbounded] } }).css;
      expect(css).not.toContain("nx-pb-contained");
      expect(css).not.toContain("margin-inline");
    }
  );

  it.each(["var(--missing, none)", "var(--x)"])(
    "writes nothing when the width %s resolves in the browser",
    width => {
      // Valid CSS that compiles, and whose meaning is decided at
      // computed-value time: `var(--x, none)` becomes `none` when the property
      // is absent, which is the unbounded case arriving through a door no
      // static check can watch. Refused rather than guessed at.
      const dynamic = {
        id: "content.width",
        name: "content.width",
        kind: "dimension",
        values: { light: width },
      } as never;
      const css = sheet({ tokens: { tokens: [dynamic] } }).css;
      expect(css).not.toContain("nx-pb-contained");
      expect(css).not.toContain("margin-inline");
    }
  );

  it.each(["wide", "#fff", "12ms"])(
    "writes nothing when the width %s is not a max-width at all",
    width => {
      // A token declared `dimension` may carry a bare identifier: the
      // token-kind check passes it, because it cannot know what a dimension is
      // allowed to say, while `max-width` rejects it outright. The compiler is
      // asked instead of a second statement of the property's grammar.
      const bogus = {
        id: "content.width",
        name: "content.width",
        kind: "dimension",
        values: { light: width },
      } as never;
      const css = sheet({ tokens: { tokens: [bogus] } }).css;
      expect(css).not.toContain("nx-pb-contained");
      expect(css).not.toContain("margin-inline");
    }
  );

  it.each(["72rem", "80%", "min(100%,60rem)"])(
    "still contains when the width %s is a real bound",
    width => {
      // The control the rejections need: a gate that refused everything would
      // pass every case above while breaking the feature entirely. `min()` is
      // here deliberately — a hand-written check would have had to enumerate
      // the functions `max-width` accepts, and would have missed this one.
      const real = {
        id: "content.width",
        name: "content.width",
        kind: "dimension",
        values: { light: width },
      } as never;
      expect(sheet({ tokens: { tokens: [real] } }).css).toContain(
        "nx-pb-contained"
      );
    }
  );

  it("writes nothing when the width token's VALUE does not suit its kind", () => {
    // A token may declare itself a dimension and carry a colour. The emitter
    // writes it as given and says so in a warning — so the property is
    // declared and useless, `max-width` drops, and `margin-inline: auto`
    // beside it centres a node with nothing bounding it.
    const badValue = {
      id: "content.width",
      name: "content.width",
      kind: "dimension",
      values: { light: "#fff" },
    } as never;
    const css = sheet({ tokens: { tokens: [badValue] } }).css;
    expect(css).not.toContain("nx-pb-contained");
    expect(css).not.toContain("margin-inline");
  });

  it("writes nothing when the width token is not a dimension", () => {
    // The emitter declares whatever it is given, so a colour carrying this
    // identity still produces `--site-content-width`. `max-width: #ff0000` is
    // then invalid and drops, while `margin-inline: auto` beside it survives —
    // centring a contained node with nothing bounding it.
    const wrongKind = {
      id: "content.width",
      name: "content.width",
      kind: "color",
      values: { light: "#ff0000" },
    } as never;
    const css = sheet({ tokens: { tokens: [wrongKind] } }).css;
    expect(css).not.toContain("nx-pb-contained");
    expect(css).not.toContain("margin-inline");
  });

  it("writes nothing when the emitter REFUSED the width token", () => {
    // Derived from what the emitter wrote rather than from what the caller
    // passed. A token the emitter rejects declares no property, so the rule
    // would otherwise reference nothing — dropping `max-width` and leaving
    // `margin-inline: auto` to centre a node with no bound.
    const refused = {
      name: "content.width",
      kind: "dimension",
      values: {},
    } as never;
    const css = sheet({ tokens: { tokens: [refused] } }).css;
    expect(css).not.toContain("nx-pb-contained");
  });

  it("writes nothing at all when the token set omits the width", () => {
    // Half of this rule is worse than none: an undeclared custom property
    // invalidates only its own declaration, so `max-width` would drop while
    // `margin-inline: auto` survived — centring a contained node that carries a
    // width of its own, in the configuration documented as producing NO
    // containment.
    const css = sheet({ tokens: { tokens: [] } }).css;
    expect(css).not.toContain("nx-pb-contained");
    expect(css).not.toContain("margin-inline");
  });

  it("states no width of its own when the token set omits one", () => {
    // What the merged style does not define is omitted rather than invented: a
    // literal here would hand a site that removed the token a width from a
    // place it cannot see.
    const css = sheet({ tokens: { tokens: [WIDTH_TOKEN] } }).css;
    const rule = css.slice(css.indexOf(":where(.nx-pb-contained)"));
    expect(rule.slice(0, rule.indexOf("}"))).not.toMatch(/rem|px|%/);
  });
});

describe("the bytes agree with what a page would have inlined", () => {
  it("emits the class tier exactly as the page compiler does", () => {
    // The guarantee that lets a site share these tiers instead of every page repeating them. It
    // holds because the same emitter produces both, and this is what would catch a second one.
    const shared = compileSiteSheet({
      breakpoints: FIXTURE_BREAKPOINTS,
      classes: [card],
      blockBases: {},
    });
    const asAPageWouldEmitIt = compilePageCss(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "n1", type: "core/box", version: 1, props: {} }],
      } as never,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        namedClasses: [card],
        blockBases: {},
      } as never
    );

    expect(shared.css).toBe(asAPageWouldEmitIt.css);
  });
});

describe("the name the sheet is addressed by", () => {
  it("is the same for the same input, compiled twice", () => {
    expect(sheet().contentHash).toBe(sheet().contentHash);
  });

  it("is the same when an input is reordered but the output is not", () => {
    // Addressing the BYTES rather than the inputs: a reorder the emitter normalizes away must not
    // invalidate a cached sheet.
    const a = sheet({
      blockBases: {
        "core/box": styles({ color: "green" }),
        "core/text": styles({ color: "black" }),
      },
    });
    const b = sheet({
      blockBases: {
        "core/text": styles({ color: "black" }),
        "core/box": styles({ color: "green" }),
      },
    });

    expect(b.css).toBe(a.css);
    expect(b.contentHash).toBe(a.contentHash);
  });

  it("changes when a single declaration changes", () => {
    const before = sheet();
    const after = sheet({
      blockBases: { "core/box": styles({ color: "red" }) },
    });

    expect(after.css).not.toBe(before.css);
    expect(after.contentHash).not.toBe(before.contentHash);
  });

  it("names an empty sheet without failing", () => {
    const empty = compileSiteSheet({ breakpoints: FIXTURE_BREAKPOINTS });

    expect(empty.css).toBe("");
    expect(empty.contentHash.length).toBeGreaterThan(0);
  });
});

describe("what the sheet declines to write", () => {
  it("reports a token with no values rather than failing the whole sheet", () => {
    // Site tokens are one settings row read on every page render, and they arrive whether or not
    // anything validated them. Reading through a missing field threw, so one corrupt row took
    // down every page on the site instead of costing that one token.
    const run = () =>
      sheet({
        tokens: {
          tokens: [
            { name: "color.primary", kind: "color" as const },
            {
              name: "color.ok",
              kind: "color" as const,
              values: { light: "#00ff00" },
            },
          ],
        },
      });

    expect(run).not.toThrow();
    expect(run().css).toContain("#00ff00");
    expect(run().warnings.length).toBeGreaterThan(0);
  });

  it("declares and references a token under the same prefix", () => {
    // The two halves read the prefix from different places. Set one and not the other and the
    // sheet declares `--site-color-primary` while the page asks for `var(--brand-color-primary)`:
    // nothing errors, the reference resolves to nothing, and the colour silently does not apply.
    const { css } = compileSiteSheet({
      breakpoints: FIXTURE_BREAKPOINTS,
      tokenPrefix: "--brand-",
      tokens: {
        tokens: [
          {
            name: "color.primary",
            kind: "color" as const,
            values: { light: "#123456" },
          },
        ],
      },
      blockBases: {
        "core/box": {
          base: { base: { color: { $token: "color.primary" } } },
        } as unknown as NodeStyles,
      },
    });

    expect(css).toContain("--brand-color-primary:#123456");
    expect(css).toContain("var(--brand-color-primary)");
    expect(css).not.toContain("--site-color-primary");
  });

  it("takes the prefix from the token set when no override is given", () => {
    const { css } = compileSiteSheet({
      breakpoints: FIXTURE_BREAKPOINTS,
      tokens: {
        prefix: "--brand-",
        tokens: [
          {
            name: "color.primary",
            kind: "color" as const,
            values: { light: "#123456" },
          },
        ],
      },
      blockBases: {
        "core/box": {
          base: { base: { color: { $token: "color.primary" } } },
        } as unknown as NodeStyles,
      },
    });

    expect(css).toContain("--brand-color-primary:#123456");
    expect(css).toContain("var(--brand-color-primary)");
  });

  it("refuses a token with no light value rather than writing undefined", () => {
    // `light` is what a reader with no mode set resolves, so a token without one has no value at
    // all. Accepted, it reached the sheet as the literal text `undefined` and warned about
    // nothing.
    const { css, warnings } = sheet({
      tokens: {
        tokens: [
          { name: "color.a", kind: "color" as const, values: {} as never },
          {
            name: "color.b",
            kind: "color" as const,
            values: { dark: "#000000" } as never,
          },
        ],
      },
    });

    expect(css).not.toContain("undefined");
    expect(warnings.length).toBe(2);
  });

  it("reports a font it refused rather than emitting it", () => {
    // Remote font sources are refused for privacy; the caller has to be told, or a missing
    // typeface has no explanation anywhere.
    const { css, warnings } = sheet({
      fonts: [
        {
          family: "Remote",
          src: [{ url: "https://fonts.example.com/a.woff2" }],
        },
      ],
    });

    expect(css).not.toContain("fonts.example.com");
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("the site sheet's host-fetch policy", () => {
  // The class and block-default tiers are emitted VERBATIM into every page of
  // the site, so a stored `url()` here is a request every visitor of every page
  // makes. A page's own sheet has been compiled under a host policy since that
  // existed; this sheet had no way to be given one, and it is emitted FIRST —
  // a page sheet that merely omits a declaration cannot retract one.
  const TRACKER = "https://tracker.example/p.png";
  const tracking: NamedClass = {
    id: "c9",
    slug: "tracked",
    orderIndex: 1,
    styles: styles({ background: { url: TRACKER } }),
  };

  it("emits the url when no policy is given, which is unasked rather than allowed", () => {
    // Pinned deliberately. Absent is not an empty allowlist: an empty list
    // refuses every remote URL, and a site that configured none keeps exactly
    // what it has today.
    expect(sheet({ classes: [tracking] }).css).toContain(TRACKER);
  });

  it("emits it when the policy allows the host", () => {
    // The positive control. Without it the refusal below passes just as well on
    // a compile that dropped the declaration for some unrelated reason.
    const allowed = sheet({ classes: [tracking], mayFetchUrl: () => true });
    expect(allowed.css).toContain(TRACKER);
  });

  it("withholds it when the policy refuses the host", () => {
    const refused = sheet({ classes: [tracking], mayFetchUrl: () => false });
    expect(refused.css).not.toContain(TRACKER);
    expect(refused.warnings).not.toHaveLength(0);
  });

  it("still emits the tiers around the withheld declaration", () => {
    // A policy narrows one declaration; it does not cost the site its sheet.
    const refused = sheet({
      classes: [card, tracking],
      mayFetchUrl: () => false,
    });
    expect(refused.css).toContain("blue");
    expect(refused.css).toContain("green");
  });

  it("changes the content hash, so a cached sheet cannot be mistaken for it", () => {
    // Why this input needs no `fetchPolicyId` counterpart. A stored PAGE sheet
    // carries a stamp because a predicate is opaque and a reader has to decide
    // whether the artifact predates the current rules. This artifact is
    // compiled per render and addressed by the hash of its own bytes, so a
    // policy that changes what is emitted changes the name.
    const open = sheet({ classes: [tracking] });
    const closed = sheet({ classes: [tracking], mayFetchUrl: () => false });
    expect(closed.contentHash).not.toBe(open.contentHash);
  });
});

describe("forceable interaction states", () => {
  /** A class and a block default that each style a hover appearance. */
  const hovering = {
    classes: [
      {
        id: "c1",
        slug: "card",
        orderIndex: 0,
        styles: { hover: { base: { color: "#000001" } } },
      },
    ],
    blockBases: { "core/box": { hover: { base: { color: "#000002" } } } },
  };

  it("carries the marker into the SITE tiers when the caller asks", () => {
    /*
     * The tiers split across two sheets and the option must not. A named class
     * and a block-type default are compiled HERE, not with the page — so an
     * editor that asked only the page compile for forceable states gets a
     * selected block whose hover appearance comes from a class showing nothing
     * at all, which is the half of the feature nobody would notice missing
     * until an author styled a block through a class.
     */
    const out = sheet({ ...hovering, previewStates: true }).css;

    const forced = out
      .split("\n")
      .filter(line => line.includes(previewStateClass("hover")));
    // Both tiers, asserted by their values: a filter that found one would
    // satisfy "contains the marker" while half the sheet stayed pseudo-only.
    expect(forced.some(rule => rule.includes("#000001"))).toBe(true);
    expect(forced.some(rule => rule.includes("#000002"))).toBe(true);
  });

  it("carries none of it into a published sheet", () => {
    // The default, which is what every route compiles: a visitor's browser
    // decides its own `:hover`, and a class nothing will ever set is bytes on
    // every page for nobody.
    const out = sheet(hovering).css;

    expect(out).toContain(":where(:hover)");
    expect(out).not.toContain(previewStateClass("hover"));
  });
});
