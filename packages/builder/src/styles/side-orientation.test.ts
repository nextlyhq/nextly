// @vitest-environment jsdom

/**
 * Reading the edited element's axes, and refusing to guess when it cannot.
 *
 * The refusal is the part worth testing hardest. Every failure here — the
 * canvas not mounted, the block still showing a Suspense fallback, the element
 * simply not drawn — produces the same absence, and the tempting reading of
 * that absence is "horizontal, left to right", which is right for most sites
 * and silently wrong for the ones this exists to serve.
 *
 * jsdom computes neither `writing-mode` nor `direction`, so the values are
 * stubbed the way `spacing-overlay.test` stubs them. That is not a workaround
 * for the test's benefit: it is why the panel treats an unreadable orientation
 * as a reason to draw rows, since a browserless render genuinely cannot know.
 *
 * @module side-orientation.test
 */
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { orientationOf, orientationOfElement } from "./side-orientation";

/**
 * jsdom's own implementation, captured ONCE at module load.
 *
 * Re-reading `window.getComputedStyle` inside the stub would capture whichever
 * stub is installed at that moment, so the delegate would call the spy that
 * owns it and the stack would overflow.
 */
const REAL_COMPUTED_STYLE = window.getComputedStyle.bind(window);

/** Answer with these axes for the named node, and normally for everything else. */
function stubAxes(
  byNodeId: Record<string, { writingMode: string; direction: string }>
) {
  const real = REAL_COMPUTED_STYLE;
  vi.spyOn(window, "getComputedStyle").mockImplementation(((
    element: Element,
    pseudo?: string | null
  ) => {
    const id = element.getAttribute?.(NODE_ID_ATTRIBUTE);
    const axes = id === null || id === undefined ? undefined : byNodeId[id];
    return axes === undefined
      ? real(element, pseudo)
      : (axes as unknown as CSSStyleDeclaration);
  }) as typeof window.getComputedStyle);
}

/** A canvas root holding one marked element per id. */
function canvasWith(...nodeIds: string[]): HTMLElement {
  const root = document.createElement("div");
  for (const id of nodeIds) {
    const node = document.createElement("div");
    node.setAttribute(NODE_ID_ATTRIBUTE, id);
    root.append(node);
  }
  document.body.append(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("reading the edited element's axes", () => {
  it("answers with the axes of the element the node id names", () => {
    stubAxes({ a: { writingMode: "vertical-rl", direction: "rtl" } });

    expect(orientationOf(canvasWith("a"), "a")).toEqual({
      writingMode: "vertical-rl",
      direction: "rtl",
    });
  });

  it("answers for the NAMED node, not merely for some marked element", () => {
    /*
     * The control that separates "it found the right element" from "it found
     * the first one". A walk that ignored the id would answer with `a`'s axes
     * for both, and every assertion above would still pass.
     */
    stubAxes({
      a: { writingMode: "horizontal-tb", direction: "ltr" },
      b: { writingMode: "vertical-lr", direction: "rtl" },
    });
    const root = canvasWith("a", "b");

    expect(orientationOf(root, "b")?.writingMode).toBe("vertical-lr");
    expect(orientationOf(root, "a")?.writingMode).toBe("horizontal-tb");
  });
});

describe("refusing to guess", () => {
  it("says nothing when the node is not drawn", () => {
    /*
     * The canvas mounts after styles load, and a block whose render returns a
     * promise shows a fallback first — so "not there yet" is an ordinary state
     * rather than an error, and it must not read as a left-to-right answer.
     */
    stubAxes({ a: { writingMode: "horizontal-tb", direction: "ltr" } });

    expect(orientationOf(canvasWith("a"), "b")).toBeUndefined();
  });

  it("says nothing when there is no canvas to ask", () => {
    expect(orientationOf(null, "a")).toBeUndefined();
    expect(orientationOf(undefined, "a")).toBeUndefined();
  });

  it("says nothing when no node is selected", () => {
    expect(orientationOf(canvasWith("a"), null)).toBeUndefined();
  });

  it("says nothing when the style answers with neither property", () => {
    /*
     * jsdom's real behaviour, and a detached element's in a browser. Empty
     * strings are the shape most likely to be mistaken for an answer, because
     * they arrive from a call that succeeded.
     */
    const element = document.createElement("div");
    document.body.append(element);

    expect(orientationOfElement(element)).toBeUndefined();
  });

  it("says nothing for no element at all", () => {
    expect(orientationOfElement(null)).toBeUndefined();
    expect(orientationOfElement(undefined)).toBeUndefined();
  });

  it("never passes the node id to a selector", () => {
    /*
     * A node id is author data: a document imported or written through the API
     * can carry any string, and `querySelector` THROWS on invalid syntax rather
     * than answering with nothing. Measured on this exact id —
     * `document.querySelector('[data-nx-node="a"]\n:not(*)"]')` raises a
     * `SyntaxError` — so a lookup built from a selector takes the panel down
     * from inside an effect, while comparing strings has no such class of
     * input. `style-subject` argues the stronger point that escaping does not
     * rescue it either; this asserts only the part the walk makes true.
     */
    const hostile = 'a"]\n:not(*)';
    stubAxes({ [hostile]: { writingMode: "horizontal-tb", direction: "rtl" } });

    expect(orientationOf(canvasWith(hostile), hostile)?.direction).toBe("rtl");
  });
});
