// @vitest-environment jsdom

/**
 * Whether the rendered tag survives a canvas that mounts LATE.
 *
 * The builder mounts its canvas only once styles have loaded, while the
 * inspector beside it stays mounted throughout. So the first run of this hook
 * genuinely has no canvas to read, and the question is whether it ever looks
 * again — a ref would not tell it to, because assigning `.current` changes no
 * dependency and a ref is not reactive. Answered wrongly, a heading reports its
 * size as unset for the rest of the session, which is the state this whole tier
 * exists to fix.
 *
 * @module use-canvas-reading.test
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { useCanvasReading } from "./use-canvas-reading";

afterEach(cleanup);

/** A document object, which this hook only ever uses as a change signal. */
const DOCUMENT = {} as EditorState["document"];

function Reader({ root }: { root: HTMLElement | null }) {
  const { tag, orientation } = useCanvasReading(root, "n1", DOCUMENT);
  return (
    <>
      <span data-testid="tag">{tag ?? "unknown"}</span>
      <span data-testid="axes">
        {orientation === undefined
          ? "unknown"
          : `${orientation.writingMode}/${orientation.direction}`}
      </span>
    </>
  );
}

describe("reading the tag from a canvas", () => {
  it("answers once a canvas that mounted LATE appears", () => {
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';

    // The state the inspector really starts in: mounted, with no canvas yet.
    const view = render(<Reader root={null} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");

    // The canvas arrives. Passed as a VALUE, this is a dependency change; held
    // as a ref it would not be, and the hook would never look again.
    view.rerender(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");
  });

  it("answers when an ASYNC block resolves inside a canvas already mounted", async () => {
    /*
     * A block whose `render` returns a promise commits its Suspense fallback
     * first and its resolved root later. Nothing in this hook's arguments
     * changes across that: the canvas element is the same, the selection is the
     * same, the document is the same. So a dependency-driven read runs only
     * BEFORE the marked element exists, and an async block resolving to a
     * heading reports its size as unset for as long as it stays selected.
     */
    const canvas = document.createElement("div");
    // The state during suspense: the canvas is mounted and the node is not
    // drawn yet.
    canvas.innerHTML = "<div>loading</div>";

    render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");

    // The block resolves. No prop changes — only the DOM.
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';
    await waitFor(() =>
      expect(screen.getByTestId("tag").textContent).toBe("h1")
    );
  });

  it("follows a node id that MOVES to a different element", async () => {
    // Structure alone is not the whole question: a re-render can put the same
    // id on a different element without adding or removing one, and the answer
    // changes. That is why the observer watches the attribute too.
    const canvas = document.createElement("div");
    canvas.innerHTML =
      '<h1 data-nx-node="n1">A title</h1><p id="other">text</p>';

    render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");

    const heading = canvas.querySelector("h1");
    heading?.removeAttribute("data-nx-node");
    canvas.querySelector("#other")?.setAttribute("data-nx-node", "n1");
    await waitFor(() =>
      expect(screen.getByTestId("tag").textContent).toBe("p")
    );
  });

  it("goes back to unknown when the canvas goes away", () => {
    // The control on the case above: a hook that simply latched its first
    // non-empty answer would satisfy it while reporting a heading's baseline
    // for a canvas that is no longer on screen.
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';

    const view = render(<Reader root={canvas} />);
    expect(screen.getByTestId("tag").textContent).toBe("h1");

    view.rerender(<Reader root={null} />);
    expect(screen.getByTestId("tag").textContent).toBe("unknown");
  });
});

describe("reading the axes from the same element", () => {
  /**
   * jsdom's own implementation, captured ONCE at module load — re-reading it
   * inside the stub would capture the stub itself and recurse.
   */
  const REAL = window.getComputedStyle.bind(window);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers with the axes once the canvas arrives, in the same pass as the tag", () => {
    /*
     * The reason both live in one hook: they are two properties of ONE element,
     * and asked separately they would be two observers, two walks to find it,
     * and two answers that can be a render apart.
     *
     * jsdom computes neither property, so they are stubbed the way
     * `spacing-overlay.test` stubs them — which is also why the panel treats an
     * unreadable orientation as a reason to draw rows instead of a box.
     */
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';
    const drawn = canvas.firstElementChild as HTMLElement;
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) =>
      element === drawn
        ? ({
            writingMode: "vertical-rl",
            direction: "rtl",
          } as unknown as CSSStyleDeclaration)
        : REAL(element, pseudo)) as typeof window.getComputedStyle);

    const view = render(<Reader root={null} />);
    expect(screen.getByTestId("axes").textContent).toBe("unknown");

    view.rerender(<Reader root={canvas} />);

    expect(screen.getByTestId("axes").textContent).toBe("vertical-rl/rtl");
    // The tag came from the same read, so the two cannot disagree about which
    // element they describe.
    expect(screen.getByTestId("tag").textContent).toBe("h1");
  });

  it("says the axes are UNKNOWN when the element computes none", () => {
    /*
     * jsdom's real behaviour, and a detached element's in a browser. Empty
     * strings arrive from a call that succeeded, which is what makes them the
     * shape most likely to be mistaken for "horizontal, left to right".
     */
    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';

    render(<Reader root={canvas} />);

    expect(screen.getByTestId("tag").textContent).toBe("h1");
    expect(screen.getByTestId("axes").textContent).toBe("unknown");
  });
});

describe("keeping the axes current when nothing in the tree moves", () => {
  const REAL = window.getComputedStyle.bind(window);

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("re-reads when the canvas RESIZES, which no tree mutation reports", () => {
    /*
     * Writing mode and direction are inherited and can be set by a media or
     * container query, so dragging the canvas across one of its own breakpoints
     * changes the answer while adding, removing and re-marking no element. The
     * tree observer has nothing to report, and without this the box goes on
     * pointing at the edges the previous width implied.
     *
     * `ResizeObserver` is not implemented by jsdom, so it is supplied here and
     * its callback driven by hand — which is also why the hook checks for it
     * rather than assuming it.
     */
    let fire: (() => void) | undefined;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        fire = callback;
      }
      observe() {}
      disconnect() {}
    }
    Reflect.set(globalThis, "ResizeObserver", FakeResizeObserver);

    const canvas = document.createElement("div");
    canvas.innerHTML = '<h1 data-nx-node="n1">A title</h1>';
    const drawn = canvas.firstElementChild as HTMLElement;
    let axes = { writingMode: "horizontal-tb", direction: "ltr" };
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) =>
      element === drawn
        ? (axes as unknown as CSSStyleDeclaration)
        : REAL(element, pseudo)) as typeof window.getComputedStyle);

    render(<Reader root={canvas} />);
    expect(screen.getByTestId("axes").textContent).toBe("horizontal-tb/ltr");

    // The width crosses a breakpoint: the SAME element now computes differently.
    axes = { writingMode: "horizontal-tb", direction: "rtl" };
    act(() => fire?.());

    expect(screen.getByTestId("axes").textContent).toBe("horizontal-tb/rtl");
  });
});
