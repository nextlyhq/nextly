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
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RichText } from "@nextlyhq/blocks-react";

import type { EditorState } from "./editor-state";
import { useCanvasReading } from "./use-canvas-reading";

afterEach(cleanup);

/** A document object, which this hook only ever uses as a change signal. */
const DOCUMENT = {} as EditorState["document"];

function Reader({ root, state }: { root: HTMLElement | null; state?: string }) {
  const { tag, orientation, picture, picturePosition } = useCanvasReading(
    root,
    "n1",
    {
      document: DOCUMENT,
      state,
    }
  );
  return (
    <>
      <span data-testid="tag">{tag ?? "unknown"}</span>
      <span data-testid="axes">
        {orientation === undefined
          ? "unknown"
          : `${orientation.writingMode}/${orientation.direction}`}
      </span>
      <span data-testid="picture">{picture ?? "none"}</span>
      <span data-testid="position">{picturePosition ?? "none"}</span>
      <span data-testid="layout">
        {orientation === undefined
          ? "unknown"
          : `${orientation.display ?? ""}/${orientation.flexDirection ?? ""}`}
      </span>
    </>
  );
}

describe("reading the picture a node draws", () => {
  it("reads the picture the node is, or the one inside it, and none for others", () => {
    // What a focal point is aimed over: the picture the canvas really draws,
    // whether the node is the image itself or a link or figure around it.
    const canvas = document.createElement("div");
    canvas.innerHTML = '<img data-nx-node="n1" src="/team.png" alt="">';
    const view = render(<Reader root={canvas} />);
    expect(screen.getByTestId("picture").textContent).toBe("/team.png");

    const linked = document.createElement("div");
    linked.innerHTML =
      '<a data-nx-node="n1" href="/about"><img src="/team.png" alt=""></a>';
    view.rerender(<Reader root={linked} />);
    expect(screen.getByTestId("picture").textContent).toBe("/team.png");

    const text = document.createElement("div");
    text.innerHTML = '<p data-nx-node="n1">Words</p>';
    view.rerender(<Reader root={text} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");

    // A block holding another block's image draws no picture of its own.
    const card = document.createElement("div");
    card.innerHTML =
      '<div data-nx-node="n1"><img data-nx-node="n2" src="/child.png" alt=""></div>';
    view.rerender(<Reader root={card} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");

    // Its own picture is found past a child block's image that comes first.
    const both = document.createElement("div");
    both.innerHTML =
      '<figure data-nx-node="n1"><div data-nx-node="n2"><img src="/child.png" alt=""></div><img src="/own.png" alt=""></figure>';
    view.rerender(<Reader root={both} />);
    expect(screen.getByTestId("picture").textContent).toBe("/own.png");
  });
});

describe("which pictures are a block's own to style", () => {
  it("counts only a root that hands its media styles to the picture", () => {
    // A rich-text passage with an inline picture is not an image block: its
    // root takes the Style values, and no fit or focal point reaches the
    // picture inside it.
    const passage = document.createElement("div");
    passage.innerHTML =
      '<div data-nx-node="n1"><p>Words <img src="/inline.png" alt=""></p></div>';
    const view = render(<Reader root={passage} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");

    const captioned = document.createElement("div");
    captioned.innerHTML =
      '<figure data-nx-node="n1"><img src="/own.png" alt="" style="object-position: 100% 0%"><figcaption>A caption</figcaption></figure>';
    view.rerender(<Reader root={captioned} />);
    expect(screen.getByTestId("picture").textContent).toBe("/own.png");
    // And where the canvas places it, resolved there.
    expect(screen.getByTestId("position").textContent).toBe("100% 0%");
  });

  it("counts a custom block's own wrapper when the picture is all it draws", () => {
    // A third-party block may draw its picture inside a div or a span of its
    // own and hand the root's media styles on to it: its Fit and Focal point
    // work, so the picture is the block's own.
    const wrapped = document.createElement("div");
    wrapped.innerHTML =
      '<div data-nx-node="n1"><span><img src="/custom.png" alt="" style="object-position: 0% 100%"></span></div>';
    const view = render(<Reader root={wrapped} />);
    expect(screen.getByTestId("picture").textContent).toBe("/custom.png");
    expect(screen.getByTestId("position").textContent).toBe("0% 100%");

    // Text of its own beside the picture makes it a passage again.
    const passage = document.createElement("div");
    passage.innerHTML =
      '<span data-nx-node="n1">Words <img src="/inline.png" alt=""></span>';
    view.rerender(<Reader root={passage} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");
    expect(screen.getByTestId("position").textContent).toBe("none");

    // So do two pictures: which one would a single focal point be aimed at?
    const pair = document.createElement("div");
    pair.innerHTML =
      '<div data-nx-node="n1"><img src="/a.png" alt=""><img src="/b.png" alt=""></div>';
    view.rerender(<Reader root={pair} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");

    // A passage holding nothing but a picture is still a passage: drawn by
    // the rich-text renderer itself, whose figure the root's styles never
    // reach, so its picture is not the block's own.
    const lone = document.createElement("div");
    lone.innerHTML = `<div data-nx-node="n1">${renderToStaticMarkup(
      <RichText
        value={
          {
            root: {
              type: "root",
              children: [
                {
                  type: "image",
                  version: 1,
                  src: "https://cdn.example.com/a.jpg",
                  altText: "A",
                },
              ],
            },
          } as never
        }
      />
    )}</div>`;
    expect(lone.querySelector("img")).not.toBeNull();
    view.rerender(<Reader root={lone} />);
    expect(screen.getByTestId("picture").textContent).toBe("none");

    // A child block's words are its own, not text beside this block's picture.
    const card = document.createElement("div");
    card.innerHTML =
      '<div data-nx-node="n1"><img src="/own.png" alt=""><p data-nx-node="n2">Child words</p></div>';
    view.rerender(<Reader root={card} />);
    expect(screen.getByTestId("picture").textContent).toBe("/own.png");
  });
});

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

  it("re-reads when a RESTYLING signal changes, with nothing in the DOM moving", () => {
    /*
     * The axes are a computed property, so they move for reasons no mutation
     * reports and no size change accompanies: a forced state selects a
     * different rule set, and a breakpoint or preview width changes which
     * queries match. Nothing is added, removed or re-marked, and the canvas box
     * need not change at all — so the panel's own signal is the only thing that
     * can say the answer may have moved.
     */
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

    const view = render(<Reader root={canvas} state="base" />);
    expect(screen.getByTestId("axes").textContent).toBe("horizontal-tb/ltr");

    // A forced state now applies a rule that flips the inline axis.
    axes = { writingMode: "horizontal-tb", direction: "rtl" };
    view.rerender(<Reader root={canvas} state="hover" />);

    expect(screen.getByTestId("axes").textContent).toBe("horizontal-tb/rtl");
  });

  it("keeps a new reading when only the element's LAYOUT changed", () => {
    // Choosing Column changes neither the tag nor the axes, and a reading
    // kept as "the same" would leave the alignment icons on the old layout.
    const canvas = document.createElement("div");
    canvas.innerHTML = '<div data-nx-node="n1">A box</div>';
    const drawn = canvas.firstElementChild as HTMLElement;
    let computed = {
      writingMode: "horizontal-tb",
      direction: "ltr",
      display: "flex",
      flexDirection: "row",
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) =>
      element === drawn
        ? (computed as unknown as CSSStyleDeclaration)
        : REAL(element, pseudo)) as typeof window.getComputedStyle);

    const view = render(<Reader root={canvas} state="base" />);
    expect(screen.getByTestId("layout").textContent).toBe("flex/row");

    computed = {
      ...computed,
      flexDirection: "column",
    };
    view.rerender(<Reader root={canvas} state="hover" />);

    expect(screen.getByTestId("layout").textContent).toBe("flex/column");
  });

  it("re-reads when the canvas resize observer FIRES", () => {
    /*
     * Writing mode and direction are inherited and can be set by a media or
     * container query, so dragging the canvas across one of its own breakpoints
     * changes the answer while adding, removing and re-marking no element. The
     * tree observer has nothing to report, and without this the box goes on
     * pointing at the edges the previous width implied.
     *
     * `ResizeObserver` is not implemented by jsdom, so it is supplied here and
     * its callback driven by hand. That is the limit of what this asserts: the
     * hook re-reads WHEN THE OBSERVER FIRES. Whether a browser delivers that
     * event for any particular restyle is not something this can establish, and
     * it is why the signals above carry the cases a resize would miss.
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
