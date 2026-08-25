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
import { describe, expect, it } from "vitest";

import type { BlockDocument, BreakpointSet } from "../document";
import {
  MAX_PREVIEW_CONTAINER_LENGTH,
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  breakpointContexts,
  compilePageCss,
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
     * Asserted on the ANSWER as well as on the size, since a correct refusal is
     * the property and the early exit is how it is reached: a megabyte of
     * whitespace still refuses, and refuses for the length rather than for
     * being blank after trimming.
     */
    const huge = " ".repeat(1_000_000) + "nx-box";

    expect(previewContainerName(huge)).toBeUndefined();
    // And a value that only fits AFTER trimming is refused too, because
    // trimming cannot make an over-cap string legal.
    expect(
      previewContainerName(` ${"a".repeat(MAX_PREVIEW_CONTAINER_LENGTH)} `)
    ).toBeUndefined();
    // The control: at the cap with no padding, still accepted.
    expect(previewContainerName("a".repeat(MAX_PREVIEW_CONTAINER_LENGTH))).toBe(
      "a".repeat(MAX_PREVIEW_CONTAINER_LENGTH)
    );
  });
});
