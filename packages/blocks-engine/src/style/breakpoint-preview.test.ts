/**
 * What an editor-only preview compile may and may not change.
 *
 * The option exists because `@media` asks the browser WINDOW. A surface that
 * shows the page inside a resizable box shares that window, so narrowing the
 * box changes nothing about which rules apply — the block gets narrower and
 * keeps its widest styling. A container query asked of the box answers about
 * the box.
 *
 * Two properties pull in opposite directions and both are asserted here,
 * because satisfying either alone is worse than not having the option:
 *
 * - OFF must be byte-identical to what it was before the option existed, or
 *   every stored artifact on the site invalidates for CSS that did not change.
 * - ON must be unmistakable, or a preview sheet and a published sheet can be
 *   confused for one another — and a visitor's page has no preview container,
 *   so its viewport rules would match nothing and every responsive style would
 *   silently vanish from the live site.
 *
 * @module breakpoint-preview.test
 */
import { describe, expect, it, vi } from "vitest";

import type { BlockDocument, BreakpointSet } from "../document";
import {
  MAX_PREVIEW_CONTAINER_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  breakpointContexts,
  compilePageCss,
  previewContainerFor,
  previewContainerName,
} from "./compile-page";
import { EMITTABLE_STRING_BOUNDS } from "./emittable-string-bounds";
import { compileSiteSheet } from "./site-sheet";

/** Both axes populated, so neither can pass by being empty. */
const set = (): BreakpointSet =>
  ({
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 991 },
      { id: "mobile", label: "Mobile", maxWidth: 575 },
    ],
    container: [
      { id: "card-wide", label: "Card wide" },
      { id: "card-narrow", label: "Card narrow", maxWidth: 400 },
    ],
  }) as unknown as BreakpointSet;

const ruleFor = (
  contexts: readonly { id: string; atRule?: string }[],
  id: string
): string | undefined => contexts.find(context => context.id === id)?.atRule;

describe("a published compile", () => {
  it("is untouched by the option existing", () => {
    /*
     * The artifact identity a caller derives from these contexts is the whole
     * of the stamp's breakpoint half, so anything that moved here would
     * invalidate every artifact on the site for CSS that did not change by a
     * byte — the exact failure the stamp's own comment says it was written to
     * prevent.
     *
     * Asserted as a DEEP EQUALITY between the defaulted call and the explicitly
     * empty one, and separately on the at-rule text, so neither an added field
     * nor a changed string can pass.
     */
    const contexts = breakpointContexts(set());

    expect(contexts).toEqual(breakpointContexts(set(), {}));
    expect(ruleFor(contexts, "tablet")).toBe("@media (max-width: 991px)");
    expect(ruleFor(contexts, "card-narrow")).toBe(
      "@container (max-width: 400px)"
    );
    expect(ruleFor(contexts, "card-wide")).toBe("@container (min-width: 0)");
  });

  it("carries no preview name anywhere, on either axis", () => {
    // The separating property for the stamp: a published context that mentioned
    // a preview container would be indistinguishable from a preview one, and the
    // cache keyed on these could then serve either for the other.
    const text = JSON.stringify(breakpointContexts(set()));

    expect(text).not.toContain(PREVIEW_VIEWPORT_CONTAINER);
    expect(text).not.toContain(UNPREVIEWABLE_CONTAINER);
  });
});

describe("a preview compile", () => {
  it("asks the previewing BOX about viewport breakpoints, not the window", () => {
    /*
     * The whole point. `@media` resolves against the window the surface shares,
     * so a box narrowed to 991px inside a 1600px window applies nothing.
     */
    const contexts = breakpointContexts(set(), {
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    });

    expect(ruleFor(contexts, "tablet")).toBe(
      `@container ${PREVIEW_VIEWPORT_CONTAINER} (max-width: 991px)`
    );
    expect(ruleFor(contexts, "mobile")).toBe(
      `@container ${PREVIEW_VIEWPORT_CONTAINER} (max-width: 575px)`
    );
    // And no viewport rule is left asking the window.
    expect(JSON.stringify(contexts)).not.toContain("@media");
  });

  it("NAMES the container axis to something nothing carries", () => {
    /*
     * The hazard that is invisible until it is looked for. An UNNAMED container
     * query resolves against the nearest ancestor with `container-type` set —
     * named or not — so once the previewing surface makes its box a query
     * container, the container-axis rules would start matching against that box
     * for every node with no authored container ancestor. The editor would then
     * show container styles the published page does not: the same lying preview,
     * pointing the other way.
     *
     * Asserted on BOTH forms, because the unbounded one is emitted through a
     * different branch and `min-width: 0` is precisely the query written to
     * match inside any container.
     */
    const contexts = breakpointContexts(set(), {
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    });

    /*
     * An UNSATISFIABLE condition, not merely an unused name. A CSS identifier
     * cannot be reserved globally — blocks render host-defined markup and
     * stylesheets, so anything may declare `container-name: nx-not-previewable`,
     * and a rule kept inert only by nobody using that name becomes live the
     * moment somebody does. A width is never negative, so `(width < 0px)` is
     * false against every container whatever names are in scope.
     */
    expect(ruleFor(contexts, "card-narrow")).toContain("(width < 0px)");
    expect(ruleFor(contexts, "card-wide")).toContain("(width < 0px)");
    // And the bound they would otherwise have matched on is gone entirely, so
    // no browser can evaluate them against a real container width.
    expect(ruleFor(contexts, "card-narrow")).not.toContain("400px");
    expect(ruleFor(contexts, "card-wide")).not.toContain("min-width: 0");
    expect(UNPREVIEWABLE_CONTAINER).not.toBe(PREVIEW_VIEWPORT_CONTAINER);
  });

  it("keeps every context id, so no stored style becomes unknown", () => {
    /*
     * Named rather than omitted. Dropping the container contexts would be the
     * simpler way to stop them matching, and it would turn every style stored
     * at a container breakpoint into an `unknown-breakpoint` warning on every
     * render — a document that was correct yesterday reporting itself broken.
     *
     * Compared against the published call rather than a literal list, so the
     * property survives any future change to what a site's contexts are.
     */
    const published = breakpointContexts(set()).map(context => context.id);
    const previewed = breakpointContexts(set(), {
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    }).map(context => context.id);

    // The POPULATION first: two empty lists are equal and would prove nothing.
    expect(published.length).toBeGreaterThan(1);
    expect(previewed).toEqual(published);
  });

  it("cannot be mistaken for a published compile", () => {
    /*
     * The consequence the stamp exists to prevent, stated as its own assertion
     * rather than left to follow from the at-rule tests. A visitor's page has no
     * preview container, so a preview sheet served to one matches nothing and
     * every responsive style vanishes from the live page.
     */
    expect(
      JSON.stringify(
        breakpointContexts(set(), {
          previewContainer: PREVIEW_VIEWPORT_CONTAINER,
        })
      )
    ).not.toBe(JSON.stringify(breakpointContexts(set())));
  });
});

/** One node styled at a breakpoint, and hidden at one while shown at another. */
function page(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/text",
        version: 1,
        props: {},
        styles: { base: { tablet: { color: "magenta" } } },
        visibility: { devices: { tablet: false, mobile: true } },
      },
    ],
  } as unknown as BlockDocument;
}

describe("the compiler entry point", () => {
  it("emits a preview sheet, not only preview CONTEXTS", () => {
    /*
     * The option is worth nothing if it stops at the normalisation helper. An
     * editor compiles through `compilePageCss`, so a sheet that still carried
     * `@media` would leave the whole feature unreachable from the only entry
     * point a caller has — the shape where a change is complete, tested, and
     * never runs.
     *
     * Asserted on the EMITTED CSS rather than on the contexts, because that is
     * the artifact the browser reads.
     */
    const previewed = compilePageCss(page(), {
      breakpoints: set(),
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    });

    // The population first: an empty sheet contains no `@media` either.
    expect(previewed.css).toContain("magenta");
    expect(previewed.css).toContain(
      `@container ${PREVIEW_VIEWPORT_CONTAINER} (max-width: 991px)`
    );
    expect(previewed.css).not.toContain("@media");
  });

  it("leaves a published compile emitting @media, which is the control", () => {
    // Without this, a compiler that emitted container queries unconditionally
    // would satisfy the case above while breaking every published page.
    const published = compilePageCss(page(), { breakpoints: set() });

    expect(published.css).toContain("@media (max-width: 991px)");
    expect(published.css).not.toContain(PREVIEW_VIEWPORT_CONTAINER);
  });

  it("keeps a VISIBILITY band under the same query as the styles", () => {
    /*
     * A band is emitted through a different path — `boundedAtRule` builds a
     * lower-bounded query rather than reusing the context's own at-rule — and
     * while that path derived its keyword from the axis alone, a previewed page
     * kept `@media` for visibility while its styles had moved to a container
     * query. A node could then be styled for a width it was simultaneously
     * hidden at, and the two would disagree only under preview.
     *
     * The fixture hides at `tablet` and shows again at `mobile`, which is what
     * makes the band bounded rather than a plain `max-width` rule.
     */
    const previewed = compilePageCss(page(), {
      breakpoints: set(),
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    });

    expect(previewed.css).toContain("width >");
    // Every bounded band is asked of the preview box, none of the window.
    for (const rule of previewed.css.split("}")) {
      if (rule.includes("width >")) {
        expect(rule).toContain(`@container ${PREVIEW_VIEWPORT_CONTAINER}`);
      }
    }
  });
});

describe("the preview container name", () => {
  it("refuses every name it could not emit safely", () => {
    /*
     * Refused rather than escaped, because a name needing transformation would
     * no longer match the `container-name` the previewing surface declared —
     * so escaping produces a sheet that parses and matches nothing, which is
     * strictly worse than a sheet that is merely not previewable.
     *
     * Each rejection is a different failure, so each is named:
     *
     * - empty or blank emits `@container (max-width: N)` with NO name, which
     *   binds to the nearest ancestor query container — an author's own
     *   included. That is the capture the container axis is named to avoid.
     * - the reserved unpreviewable name aims the viewport axis at the same
     *   container as the container axis, making the deliberately inert rules
     *   live against the preview box.
     * - punctuation can close the at-rule and open something else.
     * - over the bound, because the name is copied into every preview at-rule
     *   and a caller digesting these inputs truncates at what this package
     *   promises.
     */
    for (const refused of [
      "",
      "   ",
      UNPREVIEWABLE_CONTAINER,
      "has space",
      "1leading-digit",
      // CSS-wide keywords and `none` match the identifier shape and are
      // excluded from a `<custom-ident>` anyway. Emitted, they produce an
      // at-rule the browser drops AND a `container-name` the surface cannot
      // declare — so the preview loses its rules rather than degrading to the
      // published compile the way every other refusal here does.
      "none",
      "NONE",
      "initial",
      "inherit",
      "unset",
      "revert",
      "revert-layer",
      "default",
      "){color:red}",
      "a".repeat(MAX_PREVIEW_CONTAINER_LENGTH + 1),
      undefined,
      42,
    ]) {
      expect(previewContainerName(refused)).toBeUndefined();
    }
  });

  it("accepts an ordinary identifier, which is the control", () => {
    // Without this, a validator refusing everything would satisfy the case
    // above and no preview could ever be compiled.
    expect(previewContainerName(PREVIEW_VIEWPORT_CONTAINER)).toBe(
      PREVIEW_VIEWPORT_CONTAINER
    );
    expect(previewContainerName("  nx-box  ")).toBe("nx-box");
    expect(previewContainerName("a".repeat(MAX_PREVIEW_CONTAINER_LENGTH))).toBe(
      "a".repeat(MAX_PREVIEW_CONTAINER_LENGTH)
    );
  });

  it("degrades a refused name to a PUBLISHED compile, not a broken one", () => {
    /*
     * The consequence of refusing, asserted at the compiler rather than at the
     * validator. A refused name must leave the sheet exactly as a published one
     * — not emit an unnamed container query, which is the capture being
     * prevented.
     */
    const refused = compilePageCss(page(), {
      breakpoints: set(),
      previewContainer: UNPREVIEWABLE_CONTAINER,
    });

    expect(refused.css).toContain("@media (max-width: 991px)");
    expect(refused.css).not.toContain(
      `@container ${UNPREVIEWABLE_CONTAINER} (max-width: 991px)`
    );
    expect(refused.css).toBe(
      compilePageCss(page(), { breakpoints: set() }).css
    );
  });
});

describe("the shared site tier", () => {
  /** A named class carrying a value at a viewport breakpoint. */
  const classes = () =>
    [
      {
        id: "cls-1",
        slug: "card",
        orderIndex: 0,
        styles: { base: { tablet: { color: "teal" } } },
      },
    ] as never;

  it("answers the breakpoint question the same way the page tier does", () => {
    /*
     * A separate compile, and it was answering separately. The shared classes
     * and block defaults are emitted into the same document as the node-local
     * declarations, so a site sheet compiled for the published page beneath
     * node styles compiled for a preview surface puts two answers to one
     * breakpoint in one stylesheet — and a container-axis rule from this tier
     * could still match a real authored container while the node's own rule at
     * that breakpoint is aimed at a name nothing carries.
     */
    const previewed = compileSiteSheet({
      breakpoints: set(),
      classes: classes(),
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    } as never);

    // The population first: a sheet that emitted no class rule at all would
    // contain no `@media` either and satisfy the negative half by vacuity.
    expect(previewed.css).toContain("teal");
    expect(previewed.css).toContain(
      `@container ${PREVIEW_VIEWPORT_CONTAINER} (max-width: 991px)`
    );
    expect(previewed.css).not.toContain("@media");
  });

  it("still emits @media without the option, which is the control", () => {
    const published = compileSiteSheet({
      breakpoints: set(),
      classes: classes(),
    } as never);

    expect(published.css).toContain("@media (max-width: 991px)");
    expect(published.css).not.toContain(PREVIEW_VIEWPORT_CONTAINER);
  });
});

describe("the bound on a preview container name", () => {
  it("is registered in the catalog that promises to list every one", () => {
    /*
     * `EMITTABLE_STRING_BOUNDS` exists so a consumer choosing a digest
     * truncation can verify it against the producer's own set rather than a
     * prose description of it. A caller-controlled string the compiler writes
     * into CSS and does not register is exactly the member such a consumer
     * silently stops covering.
     *
     * The larger style-value entry happens to mask this one today, so the
     * omission costs nothing until that unrelated bound changes — which is what
     * makes it worth pinning rather than leaving to be noticed.
     *
     * Asserted by MATCHING the constant rather than a literal, so the entry
     * cannot drift from the cap it describes.
     */
    const entry = EMITTABLE_STRING_BOUNDS.find(bound =>
      bound.what.includes("preview container")
    );

    expect(entry).toBeDefined();
    expect(entry?.max).toBe(MAX_PREVIEW_CONTAINER_LENGTH);
  });
});

describe("refusing an oversized name", () => {
  it("does not scan the whole string to reach a refusal", () => {
    /*
     * The raw length is checked before `trim` or any other linear pass. This
     * name is caller-controlled and is normalised again while deriving artifact
     * identities, so the scan would recur on render paths rather than once.
     *
     * Asserted by OBSERVING the linear pass, not by the answer.
     *
     * The answer cannot separate the two implementations: check-then-trim and
     * trim-then-check both return `undefined` for an over-cap string, so a test
     * reading only the result stays green against the version this exists to
     * forbid. What distinguishes them is whether `trim` runs at all, so the spy
     * is the assertion rather than an aid to it.
     */
    const trim = vi.spyOn(String.prototype, "trim");
    try {
      const huge = " ".repeat(1_000_000) + "nx-box";

      expect(previewContainerName(huge)).toBeUndefined();
      expect(trim).not.toHaveBeenCalled();

      /*
       * The control, and it is what makes the silence above mean anything: a
       * `previewContainerName` that had stopped trimming entirely — or one the
       * spy simply never reached — would satisfy the assertion above perfectly.
       * An accepted name must still take the trimming path.
       */
      const accepted = `  nx-box  `;
      expect(previewContainerName(accepted)).toBe("nx-box");
      expect(trim).toHaveBeenCalled();
    } finally {
      // Restored in `finally` so a failed expectation above does not leave
      // every later test in this file running against a spied prototype.
      trim.mockRestore();
    }
  });

  it("refuses the container-query QUERY keywords, which the grammar excludes", () => {
    /*
     * `@container <name>? <condition>` puts the name and the condition adjacent
     * with nothing between them, so these are not merely unusual names — they
     * change what the at-rule MEANS.
     *
     * `and` and `or` produce `@container and (max-width: 991px)`, which is a
     * malformed condition rather than a container named `and`, and a browser
     * drops the rule. `not` is the worse one because it PARSES: it reads as the
     * negation of the condition that follows, so the rule applies at exactly
     * the widths the author meant to exclude.
     *
     * Case-insensitively, because CSS keywords are, and a caller passing `AND`
     * would otherwise establish a container whose rules are dropped just the
     * same.
     */
    for (const keyword of ["and", "or", "not", "AND", "Not", "OR"]) {
      expect(previewContainerName(keyword)).toBeUndefined();
    }
  });

  it("still ACCEPTS a name merely CONTAINING one, which is the control", () => {
    /*
     * Without this, refusing every name with those letters anywhere in it would
     * satisfy the case above while rejecting ordinary identifiers — `nx-android`
     * and `nx-notes` are legal container names and a surface seeded from a
     * document slug will produce them.
     */
    expect(previewContainerName("nx-android")).toBe("nx-android");
    expect(previewContainerName("nx-notes")).toBe("nx-notes");
    expect(previewContainerName("brand-or-theme")).toBe("brand-or-theme");
  });

  it("refuses a name that would only FIT after trimming", () => {
    /*
     * A consequence of the bound being on the raw input, and a deliberate one
     * rather than an accident of ordering: a name of exactly the cap's length
     * wrapped in spaces is legal once trimmed and is refused anyway.
     *
     * That is the intended reading of the published bound — it describes the
     * string a caller hands over, so a consumer digesting these inputs can
     * check the value it holds rather than a trimmed form it would have to
     * derive first.
     */
    expect(
      previewContainerName(` ${"a".repeat(MAX_PREVIEW_CONTAINER_LENGTH)} `)
    ).toBeUndefined();
    // At the cap with no padding, still accepted — so the refusal above is
    // about the padding rather than about the length being unusable.
    expect(previewContainerName("a".repeat(MAX_PREVIEW_CONTAINER_LENGTH))).toBe(
      "a".repeat(MAX_PREVIEW_CONTAINER_LENGTH)
    );
  });
});

describe("a bounded visibility band on the container axis", () => {
  it("keeps the impossible condition rather than rebuilding a named query", () => {
    /*
     * A band is emitted through a different path from the context it belongs
     * to, and rebuilding its wrapper from the prefix alone dropped the
     * impossible condition — leaving a merely NAMED query an authored ancestor
     * could satisfy. The node's styles would stay impossible while its
     * visibility band went live, so preview visibility disagreed with preview
     * styling in the one direction nobody would look.
     */
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "acme/text",
          version: 1,
          props: {},
          styles: { base: { "card-narrow": { color: "magenta" } } },
          visibility: {
            devices: { "card-wide": false, "card-narrow": true },
          },
        },
      ],
    } as unknown as BlockDocument;

    /*
     * The POPULATION comes from the PUBLISHED compile, because that is where a
     * bounded band takes its recognisable form. Under preview the band is the
     * impossible condition itself, so looking for `width >` there would find
     * nothing whether the fix worked or not — an assertion satisfied by absence.
     */
    const published = compilePageCss(page, { breakpoints: set() }).css;
    expect(published).toContain("width >");

    const previewed = compilePageCss(page, {
      breakpoints: set(),
      previewContainer: PREVIEW_VIEWPORT_CONTAINER,
    }).css;

    // No band survives with a real bound to be satisfied against.
    expect(previewed).not.toContain("width >");
    // And every container-axis rule still carries the impossibility.
    for (const rule of previewed.split("}")) {
      if (rule.includes(UNPREVIEWABLE_CONTAINER)) {
        expect(rule).toContain("(width < 0px)");
      }
    }
  });
});

describe("a per-surface preview container", () => {
  it("differs per seed, so an authored name cannot shadow every surface", () => {
    /*
     * The default is a globally predictable identifier, and a nearer ancestor
     * declaring `container: nx-preview-viewport / inline-size` satisfies the
     * named query first — so viewport tiers would follow that inner element
     * rather than the preview box. The container axis is protected by an
     * impossible condition; the viewport axis cannot be, because it has to
     * match something.
     */
    expect(previewContainerFor("a1")).not.toBe(previewContainerFor("b2"));
    // Derived from the seed rather than generated, so a server render and a
    // client hydration produce the SAME string — a random one would differ
    // across that boundary and match nothing on first paint.
    expect(previewContainerFor("a1")).toBe(previewContainerFor("a1"));
    // And whatever it produces is a name the compiler will actually emit.
    expect(previewContainerName(previewContainerFor("a1"))).toBe(
      previewContainerFor("a1")
    );
  });

  it("reduces an opaque seed rather than refusing it", () => {
    // A caller passing an id from elsewhere should not have to know this
    // function's rules; whatever it hands over yields a name the compiler
    // accepts.
    expect(previewContainerName(previewContainerFor(":r1:"))).toBeDefined();
  });

  it("DIGESTS a seed too long to carry, rather than sharing the default", () => {
    /*
     * The case the fallback got wrong, and it failed toward the hazard.
     *
     * Prefixed, a seed over about fifty characters exceeds the emitted-name
     * bound. Returning `PREVIEW_VIEWPORT_CONTAINER` there handed exactly the
     * surfaces most likely to carry long ids — document paths, composite keys,
     * opaque route ids — the one globally predictable name this function exists
     * to avoid, so third-party markup declaring that name could capture their
     * viewport queries again.
     *
     * Asserted as "accepted AND not the default", because either alone passes on
     * a broken implementation: the old fallback returned an accepted name, and
     * a function returning some other refused string is not the default either.
     */
    const long = previewContainerFor("x".repeat(500));

    expect(previewContainerName(long)).toBe(long);
    expect(long).not.toBe(PREVIEW_VIEWPORT_CONTAINER);
  });

  it("gives two long seeds DIFFERENT names, which is the whole point", () => {
    /*
     * The control. A digest that ignored its input, or a function returning one
     * constant, satisfies "accepted and not the default" above perfectly — the
     * assertion there is about one name's shape, and this is about the property
     * the name is for.
     *
     * The two seeds differ only in a character the identifier reduction
     * collapses, which is why the digest reads the ORIGINAL seed: reduced first,
     * `a/b` and `a:b` are one string and the names would legitimately collide.
     */
    const a = previewContainerFor(`${"x".repeat(500)}a/b`);
    const b = previewContainerFor(`${"x".repeat(500)}a:b`);

    expect(a).not.toBe(b);
  });

  it("gives one seed the SAME name every time, so a render can hydrate", () => {
    /*
     * Stability across the server/client boundary is why the seed is the
     * caller's rather than generated here. A name that differed between the two
     * renders would leave the preview matching nothing on exactly the first
     * paint — and React would not complain, because the container name lives in
     * a style the sheet queries rather than in the markup it compares.
     */
    const seed = "y".repeat(500);

    expect(previewContainerFor(seed)).toBe(previewContainerFor(seed));
  });
});
