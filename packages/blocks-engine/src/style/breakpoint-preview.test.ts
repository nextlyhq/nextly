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

import type { BreakpointSet } from "../document";
import {
  PREVIEW_VIEWPORT_CONTAINER,
  UNPREVIEWABLE_CONTAINER,
  breakpointContexts,
} from "./compile-page";

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

    expect(ruleFor(contexts, "card-narrow")).toBe(
      `@container ${UNPREVIEWABLE_CONTAINER} (max-width: 400px)`
    );
    expect(ruleFor(contexts, "card-wide")).toBe(
      `@container ${UNPREVIEWABLE_CONTAINER} (min-width: 0)`
    );
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
