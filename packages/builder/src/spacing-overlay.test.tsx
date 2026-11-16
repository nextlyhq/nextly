// @vitest-environment jsdom

/**
 * The overlay's wiring, which is the half `spacing-bands.test.ts` cannot see.
 *
 * That file decides where a band lands given numbers. What is only true HERE is
 * WHICH numbers it is given: that they come from the rendered element's computed
 * style rather than from the stored document, that the PHYSICAL longhands are
 * the ones read, and that one block's values are never shown for another.
 *
 * The GEOMETRY is deliberately not asserted here. jsdom reports every element as
 * zero-sized, so a rectangle in this file would be a statement about jsdom and
 * would pass against a canvas drawn wrongly for a real author. That property is
 * certified in a browser instead.
 */

import {
  clearBlocks,
  getBlock,
  hasBlock,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { CHILD_GAP_CLASS, previewStateClass } from "@nextlyhq/blocks-engine";
import { createBlockResolver, NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS, Canvas } from "./canvas";
import type { EditorState } from "./editor-state";
import { probeScale, SpacingOverlay } from "./spacing-overlay";

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function register() {
  if (hasBlock("acme/leaf")) return;
  registerBlocks(
    [
      {
        name: "acme/leaf",
        version: 1,
        description: "A leaf.",
        example: { props: {} },
        /*
         * Declared, because the drag handles derive their availability from
         * `supports` exactly as the Style panel does. Without it this block
         * offers no writable spacing and every handle assertion below would
         * pass by drawing nothing.
         */
        supports: { spacing: { margin: true, padding: true } },
        render: () => React.createElement("p", null, "leaf"),
      },
      {
        /*
         * A block whose ROOT is a replaced element, which `core/image` is
         * whenever it has no caption. It renders an `<img>` rather than
         * wrapping one, because what is being tested is the root's own
         * replaced-ness — a wrapper would make the question about the wrapper.
         */
        name: "acme/replaced",
        version: 1,
        description: "A replaced leaf.",
        example: { props: {} },
        render: () => React.createElement("img", { alt: "" }),
      },
    ] as never,
    { source: "spacing-overlay-test" }
  );
}

const DOCUMENT = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "a", type: "acme/leaf", version: 1, props: {} },
    { id: "b", type: "acme/leaf", version: 1, props: {} },
    { id: "c", type: "acme/replaced", version: 1, props: {} },
  ],
} as unknown as BlockDocument;

function editorOf(selectedId: string | null, ids?: string[]): EditorState {
  return {
    document: DOCUMENT,
    selectedId,
    selection: {
      ids: ids ?? (selectedId === null ? [] : [selectedId]),
      primary: selectedId,
    },
    composed: () => undefined,
  } as unknown as EditorState;
}

/** The properties the overlay reads, with everything else reported as zero. */
function styleOf(values: Record<string, string>): CSSStyleDeclaration {
  const zeroed: Record<string, string> = {
    // Neither is read as a length; both are read by the describability guard,
    // and jsdom supplies no default for a fake style object.
    position: "static",
    /*
     * The axes the handles resolve a logical side against. `orientationOfElement`
     * reports ABSENCE for an element computing neither — deliberately, so an
     * unread element never passes as left-to-right — and absence draws no
     * handles at all. A fake style omitting them would therefore make every
     * handle assertion here pass by drawing nothing.
     */
    writingMode: "horizontal-tb",
    direction: "ltr",
    marginTop: "0px",
    marginRight: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    // Square unless a case says otherwise. A real `CSSStyleDeclaration` always
    // carries these, so leaving them out here is a property of the fake and not
    // of anything the overlay could meet.
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomLeftRadius: "0px",
  };
  return { ...zeroed, ...values } as unknown as CSSStyleDeclaration;
}

/**
 * Report a style PER NODE, so a test can tell one block's values from another's.
 *
 * Anything that is not a rendered block keeps jsdom's own answer: the overlay's
 * own layer is measured by nothing here, and replacing every style in the
 * document would change what the canvas itself renders.
 */
/**
 * jsdom's own implementation, captured ONCE at module load.
 *
 * Re-reading `window.getComputedStyle` inside the stub captures whatever is
 * installed at that moment — which, on a second call, is the FIRST stub. The
 * delegate then calls the spy that owns it and the stack overflows. That stayed
 * invisible while the overlay only asked about the selected block, because a
 * node id always hits the fake and never reaches the delegate; the ancestor
 * walks added for the clip and gutter guards ask about elements that do.
 */
const REAL_COMPUTED_STYLE = window.getComputedStyle.bind(window);

function stubComputedStyle(byNodeId: Record<string, Record<string, string>>) {
  const real = REAL_COMPUTED_STYLE;
  vi.spyOn(window, "getComputedStyle").mockImplementation(((
    element: Element,
    pseudo?: string | null
  ) => {
    const id = element.getAttribute?.(NODE_ID_ATTRIBUTE);
    const values = id === null || id === undefined ? undefined : byNodeId[id];
    return values === undefined ? real(element, pseudo) : styleOf(values);
  }) as typeof window.getComputedStyle);
}

/**
 * Give every element a layout box, which jsdom does not.
 *
 * The overlay refuses to draw for an element that generates none — `display:
 * none` and `display: contents` both reach it — and jsdom reports NO client
 * rectangles for anything, so without this every test here would assert against
 * the refusal rather than against the overlay. Assigning layout in a test is the
 * same allowance `geometry-ownership.test.ts` documents for itself.
 */
function stubLayoutBoxes(present: boolean) {
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(() => {
    const rects = present ? [new DOMRect(0, 0, 100, 50)] : [];
    return Object.assign(rects, {
      item: (index: number) => rects[index] ?? null,
    }) as unknown as DOMRectList;
  });
}

function mount(editor: EditorState, hidden = false, laidOut = true) {
  stubLayoutBoxes(laidOut);
  register();
  return render(
    <Canvas
      document={editor.document}
      siteStyles={{ css: "", classes: {} } as never}
      selectedId={editor.selectedId}
      selectedIds={editor.selection.ids}
      overlay={<SpacingOverlay editor={editor} hidden={hidden} />}
    />
  );
}

/**
 * A stand-in for `ResizeObserver`, which jsdom does not implement.
 *
 * These tests assert the SUBSCRIPTION rather than the redraw: what goes wrong is
 * that the overlay stops being told, and whether it is told is the observable
 * half. jsdom never reflows, so no fixture here can produce the resize the real
 * observer would report.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  /** Kept so a test can make the overlay re-measure on demand. */
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

/**
 * The canvas watch's observer: the newest one watching a rendered block. Found
 * by what it watches, not by being the last made, since the canvas makes
 * others of its own (one watching its root's size).
 */
function watchObserver(): FakeResizeObserver | undefined {
  return FakeResizeObserver.instances.findLast(observer =>
    observer.observed.some(element => element.hasAttribute("data-nx-node"))
  );
}

function withFakeResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

/** Make the overlay measure again, the way a real resize would. */
function remeasure(): void {
  const observer = watchObserver();
  act(() => {
    observer?.callback([], observer as unknown as ResizeObserver);
  });
}

function labels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".nx-spacing-overlay__value")
  ).map(node => node.textContent ?? "");
}

function bandSides(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".nx-spacing-overlay__band")
  ).map(
    node => `${node.getAttribute("data-box")}-${node.getAttribute("data-side")}`
  );
}

describe("when the overlay draws at all", () => {
  it("draws no band when nothing is selected", () => {
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf(null));
    expect(bandSides(container)).toEqual([]);
  });

  it("draws no band while hidden", () => {
    // The suppression a drag uses. Asserting the same fixture unhidden below is
    // what separates this from a fixture that never produced a band at all.
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"), true);
    expect(bandSides(container)).toEqual([]);
  });

  it("draws a band for the same fixture when not hidden", () => {
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    expect(bandSides(container)).toEqual(["margin-top"]);
  });

  it.each(["fixed", "sticky"])(
    "draws no band for a block positioned %s",
    position => {
      /*
       * A block pinned to the viewport or to a scrollport has left the canvas
       * content the bands are drawn in, so a band beside it slides away from it
       * on the first scroll — and the canvas root is not what scrolls, so
       * nothing re-measures.
       *
       * Here rather than only over the predicate in `geometry-dom.test.ts`,
       * because what this asserts is the WIRING: the refusal is now decided by
       * a shared function taking the element, and an overlay that passed the
       * wrong element — or dropped the argument to a boolean parameter that
       * accepts any of them — would keep drawing while the predicate itself
       * stayed correct and covered. The fixture is the same one asserted to
       * produce a band directly above, so the emptiness is this block being
       * refused rather than a fixture with no spacing in it.
       */
      stubComputedStyle({ a: { marginTop: "16px", position } });
      const { container } = mount(editorOf("a"));
      expect(bandSides(container)).toEqual([]);
    }
  );
});

describe("which values it reports", () => {
  it("labels each band with the element's computed value", () => {
    stubComputedStyle({
      a: { marginTop: "16px", paddingBottom: "24px" },
    });
    const { container } = mount(editorOf("a"));
    expect(bandSides(container)).toEqual(["margin-top", "padding-bottom"]);
    expect(labels(container)).toEqual(["16", "24"]);
  });

  it("reads the PHYSICAL longhand rather than the logical one", () => {
    /*
     * The separating property for the whole design. The catalog stores spacing
     * per logical side, and an implementation that reached for the logical
     * computed property would report the same number in a left-to-right
     * document and the wrong EDGE in a right-to-left one. Both spellings are
     * present here and only the physical one is correct.
     */
    stubComputedStyle({
      a: { marginTop: "16px", marginBlockStart: "99px" },
    });
    const { container } = mount(editorOf("a"));
    expect(labels(container)).toEqual(["16"]);
  });

  it("draws nothing for a block that generates no layout box", () => {
    /*
     * `display: none` and `display: contents` are catalog values and stay
     * selectable through the Layers panel. Their computed margin survives while
     * every rectangle reads zero, so the bands would otherwise appear at the
     * canvas origin naming space that is nowhere on screen. The identical
     * fixture WITH a layout box is asserted above, which is what makes this
     * emptiness mean the guard fired rather than the fixture being inert.
     */
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"), false, false);
    expect(bandSides(container)).toEqual([]);
  });

  it("reports nothing for a block whose computed spacing is all zero", () => {
    stubComputedStyle({ a: {} });
    const { container } = mount(editorOf("a"));
    expect(bandSides(container)).toEqual([]);
  });

  it("drops a NON-REPLACED inline root's block-axis margin", () => {
    /*
     * `spacing-bands.test.ts` decides what `spacingApplies` answers; what is
     * only true here is that the overlay asks it about the ELEMENT it measured.
     * A `<p>` at `display: inline` creates no block-axis margin, so reporting
     * one would name space the author cannot see.
     */
    stubComputedStyle({
      a: { display: "inline", writingMode: "horizontal-tb", marginTop: "16px" },
    });
    const { container } = mount(editorOf("a"));
    expect(bandSides(container)).toEqual([]);
  });

  it("keeps a REPLACED inline root's block-axis margin", () => {
    /*
     * The captionless `core/image` case, and the pair that separates it from the
     * test above: same display, same declared margin, different element. An
     * overlay that read only the computed style cannot tell them apart, and it
     * is the ordinary image on a page that loses its bands.
     */
    stubComputedStyle({
      c: { display: "inline", writingMode: "horizontal-tb", marginTop: "16px" },
    });
    const { container } = mount(editorOf("c"));
    // The fixture is only meaningful while the block's ROOT is the replaced
    // element. A renderer that wrapped it would leave this test asserting the
    // wrapper's applicability and quietly stop testing anything.
    expect(
      container
        .querySelector(`.${CANVAS_ROOT_CLASS} [${NODE_ID_ATTRIBUTE}="c"]`)
        ?.tagName.toLowerCase()
    ).toBe("img");
    expect(bandSides(container)).toEqual(["margin-top"]);
  });
});

describe("which block it answers for", () => {
  it("measures the PRIMARY selection and not another selected block", () => {
    /*
     * Spacing belongs to a node, so a multi-block selection has no margin of its
     * own. Both blocks carry a distinct value here: an implementation drawing
     * bands per member would report both, and one anchored to the wrong member
     * would report `40`.
     */
    stubComputedStyle({
      a: { marginTop: "16px" },
      b: { marginTop: "40px" },
    });
    const { container } = mount(editorOf("a", ["a", "b"]));
    expect(labels(container)).toEqual(["16"]);
  });
});

describe("accessibility", () => {
  it("hides every BAND from assistive technology", () => {
    // The values are in the inspector's Spacing section with real labels and
    // controls. Announcing up to eight numbers on every selection change would
    // bury that surface in the readers it exists for.
    stubComputedStyle({ a: { marginTop: "16px", paddingLeft: "8px" } });
    const { container } = mount(editorOf("a"));
    const bands = Array.from(
      container.querySelectorAll(".nx-spacing-overlay__band")
    );
    expect(bands.length).toBe(2);
    for (const band of bands) {
      expect(band.getAttribute("aria-hidden")).toBe("true");
    }
  });

  /*
   * The attribute sits on each band rather than on the layer, and that is the
   * property rather than a detail of where it is written. The layer also holds
   * the drag handles, which are focusable; inside an `aria-hidden` subtree they
   * would be reachable by keyboard while a screen reader is told they are not
   * there, which is a defect in every audit tool there is. One attribute on the
   * layer would have made every handle that, silently.
   */
  it("does not hide the LAYER, which is where the focusable handles live", () => {
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    const layer = container.querySelector(".nx-spacing-overlay");
    expect(layer).not.toBeNull();
    expect(layer?.closest("[aria-hidden='true']")).toBeNull();
  });
});

describe("who may write from the canvas", () => {
  /*
   * `selectedId` is the PRIMARY of a selection, and a handle commits to that
   * node alone — so with two blocks outlined a drag would restyle one and say
   * nothing about the other. `StyleInspectorPanel` refuses its writable
   * controls on exactly that reasoning, and a control on the canvas doing what
   * the panel beside it declines is the same partial edit by another route.
   *
   * The BANDS stay either way: they report, and the primary's spacing is a true
   * thing to report about a selection containing it.
   */
  it("draws no handles while several blocks are selected", () => {
    stubComputedStyle({ a: { marginTop: "16px" }, b: { marginTop: "40px" } });
    const { container } = mount(editorOf("a", ["a", "b"]));
    expect(labels(container)).toEqual(["16"]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle")
    ).toHaveLength(0);
  });

  it("draws them again once the selection is a single block", () => {
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    expect(labels(container)).toEqual(["16"]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle").length
    ).toBeGreaterThan(0);
  });

  /*
   * A handle writes the block's spacing, which an area locked to its content
   * fixes, so the inspector holds its Style tab read-only there and the canvas
   * must not offer the same write. The bands still report.
   */
  function heldIn(
    lock: "contentOnly" | undefined,
    layers = false
  ): EditorState {
    registerBlocks(
      [
        {
          name: "acme/holder",
          version: 1,
          description: "A holder.",
          example: { props: {} },
          slots: { body: { lock } },
          // Draws its slot, so the block inside is on the canvas to measure.
          render: ({
            renderSlot,
          }: {
            renderSlot: (slot: string) => React.ReactNode;
          }) => React.createElement("div", null, renderSlot("body")),
        },
      ] as never,
      { source: "spacing-overlay-lock-test" }
    );
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "acme/holder",
          version: 1,
          props: {},
          slots: {
            body: [
              {
                id: "a",
                type: "acme/leaf",
                version: 1,
                props: {},
                ...(layers ? { locked: true } : {}),
              },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;
    return {
      document,
      selectedId: "a",
      selection: { ids: ["a"], primary: "a" },
      composed: () => undefined,
    } as unknown as EditorState;
  }

  it("draws no handles for a block inside an area locked to its content", () => {
    stubComputedStyle({ a: { marginTop: "16px" } });
    register();
    const { container } = mount(heldIn("contentOnly"));
    expect(labels(container)).toEqual(["16"]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle")
    ).toHaveLength(0);
  });

  it("draws no handles for a block its own Layers lock holds", () => {
    // Locked from Layers or the inspector's card: every control is read-only,
    // so the canvas must not offer the spacing write either.
    stubComputedStyle({ a: { marginTop: "16px" } });
    register();
    const { container } = mount(heldIn(undefined, true));
    expect(labels(container)).toEqual(["16"]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle")
    ).toHaveLength(0);
  });

  it("draws them for the same block where its slot is not locked", () => {
    // The control: nested the same way, so the case above is not passing on a
    // nested block the overlay never reached.
    stubComputedStyle({ a: { marginTop: "16px" } });
    register();
    const { container } = mount(heldIn(undefined));
    expect(labels(container)).toEqual(["16"]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle").length
    ).toBeGreaterThan(0);
  });
});

describe("a gesture the measurement must not end", () => {
  /*
   * A preview can make its own block undescribable — a margin can push it
   * partly behind an `overflow: hidden` ancestor, a padding can bring on a
   * classic scrollbar — and the measurement that follows then legitimately has
   * nothing to draw. Clearing the subject there unmounts the handles mid-drag:
   * the listeners detach, the preview goes, and the drag ends without
   * committing and without a word.
   */
  it("keeps the handles while a gesture is held, even with no bands to draw", () => {
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    const grabbed = container.querySelector<HTMLElement>(
      ".nx-spacing-handles__handle"
    );
    expect(grabbed).not.toBeNull();

    act(() => {
      grabbed?.dispatchEvent(
        new window.PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY: 0,
        })
      );
    });

    /*
     * The preview has made the block undescribable — it lays out no box at all
     * now, which is the path that measures NOTHING rather than measuring zeros.
     * Reaching that path is the whole point: measuring zeros still produces a
     * subject, so a test that only zeroed the values would pass whether or not
     * the subject is protected.
     */
    stubLayoutBoxes(false);
    remeasure();

    // The report goes, honestly. The control the pointer is holding does not.
    expect(labels(container)).toEqual([]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle").length
    ).toBeGreaterThan(0);
  });

  /*
   * The control: with no gesture held, an unmeasurable block loses its handles
   * as it always did. Without this, keeping the subject for ever would satisfy
   * the assertion above.
   */
  it("drops the handles when nothing is held", () => {
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle").length
    ).toBeGreaterThan(0);

    stubLayoutBoxes(false);
    remeasure();

    expect(labels(container)).toEqual([]);
    expect(
      container.querySelectorAll(".nx-spacing-handles__handle")
    ).toHaveLength(0);
  });
});

describe("what it stays subscribed to", () => {
  it("watches EVERY rendered node, not only the selected one", () => {
    /*
     * A `ResizeObserver` reports a size change and never a position one, so the
     * selected block's own entry stays silent while a sibling above it grows and
     * pushes it down. The unselected sibling is the element that changed, so it
     * is the one that has to be watched — block `b` here is never selected and
     * must still be observed.
     */
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));

    const observer = watchObserver();
    expect(observer?.observed).toContain(
      container.querySelector('[data-nx-node="a"]')
    );
    expect(observer?.observed).toContain(
      container.querySelector('[data-nx-node="b"]')
    );
  });

  it("watches the canvas root, which no node reports for", () => {
    // The panels resizing around the canvas changes the frame without changing
    // any node, so the root is not redundant with the node list above.
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));

    expect(watchObserver()?.observed).toContain(
      container.querySelector(`.${CANVAS_ROOT_CLASS}`)
    );
  });

  it("re-subscribes when the document changes under an unchanged selection", () => {
    /*
     * An edit replaces the rendered tree while the selection survives, so the id
     * resolves to a NEW element. An effect keyed on the selection alone keeps
     * watching the detached old one, and every later resize of the real block
     * reports to nobody.
     */
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const first = editorOf("a");
    const { rerender } = mount(first);
    const before = watchObserver();

    const edited = {
      ...DOCUMENT,
      nodes: [...(DOCUMENT.nodes as unknown[])],
    } as unknown as BlockDocument;
    const next = { ...first, document: edited } as unknown as EditorState;
    rerender(
      <Canvas
        document={edited}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="a"
        selectedIds={["a"]}
        overlay={<SpacingOverlay editor={next} />}
      />
    );

    expect(before?.disconnected).toBe(true);
    expect(FakeResizeObserver.instances.length).toBeGreaterThan(1);
  });
});

/**
 * Let the mutations React made while mounting reach the observer.
 *
 * Building the tree IS a mutation of the observed subtree, and the records are
 * delivered on a microtask AFTER mount returns. Without draining them first, the
 * next flush in a test re-measures because of the MOUNT rather than because of
 * whatever the test just did — measured, by a probe that changed nothing at all
 * and still saw the value move.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("a computed style that changes with nothing else", () => {
  it("re-measures when only the SHEET changed", async () => {
    /*
     * A site-style save changes a class-driven margin while the document, the
     * selection and every element's SIZE stay as they were, so a resize observer
     * has nothing to report and an effect keyed on document-and-selection never
     * runs. What does change is the DOM: `PageRenderer` emits the compiled sheet
     * as a `<style>` inside the page root, so the new bytes are a mutation in the
     * canvas subtree.
     */
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    await settle();
    expect(labels(container)).toEqual(["16"]);

    stubComputedStyle({ a: { marginTop: "48px" } });
    const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    root?.appendChild(window.document.createElement("style"));
    await settle();

    expect(labels(container)).toEqual(["48"]);
  });

  it("ignores a mutation the overlay itself made", async () => {
    /*
     * The bands are drawn INSIDE the observed subtree, so reacting to every
     * mutation would let one measurement trigger the next. A mutation confined to
     * the overlay's own layer has to be ignored — and the test above is the
     * positive control that says this fixture CAN move when something outside
     * changes.
     */
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    await settle();

    stubComputedStyle({ a: { marginTop: "48px" } });
    container
      .querySelector(".nx-spacing-overlay")
      ?.appendChild(window.document.createElement("span"));
    await settle();

    expect(labels(container)).toEqual(["16"]);
  });
});

describe("the scale a probe's movement is seen at", () => {
  /*
   * Measured in Chromium. Under `scale(0.5)` on the BLOCK itself, a ten-pixel
   * margin probe still moves the edge ten pixels while a ten-pixel padding
   * probe moves it five — because a padding renders inside the element's own
   * transform and scales with it, while a margin displaces the box in the
   * PARENT's coordinates, which that transform never touches.
   *
   * `renderedScale` separates the two and `spacingDelta` already divides by the
   * matching one. Reading the composed scale for both asked the margin for
   * twice the movement there was, read a moving edge as pinned, and inverted
   * the handle on any transformed block.
   */
  const halfItself = {
    // The COMPOSED scale: the block's own half, with no ancestor transform.
    x: 0.5,
    y: 0.5,
    describable: true,
    selfMoved: { top: false, right: false, bottom: false, left: false },
    ancestor: { x: 1, y: 1 },
  };
  const unpainted = { x: 1, y: 1 };

  it("ignores the block's own transform for a margin", () => {
    expect(probeScale("margin", "left", halfItself, unpainted)).toBe(1);
    expect(probeScale("margin", "top", halfItself, unpainted)).toBe(1);
  });

  it("applies it for a padding", () => {
    expect(probeScale("padding", "left", halfItself, unpainted)).toBe(0.5);
    expect(probeScale("padding", "top", halfItself, unpainted)).toBe(0.5);
  });

  /*
   * An ANCESTOR's transform scales the whole subtree it lays out, gaps
   * included, so it applies to both boxes.
   */
  it("applies an ancestor's transform to both boxes", () => {
    const halfAbove = {
      ...halfItself,
      x: 0.5,
      y: 0.5,
      ancestor: { x: 0.5, y: 0.5 },
    };
    expect(probeScale("margin", "left", halfAbove, unpainted)).toBe(0.5);
    expect(probeScale("padding", "left", halfAbove, unpainted)).toBe(0.5);
  });

  /*
   * And the canvas's own painted scale composes either way, because it is above
   * the element and the probe is read off the viewport through it.
   */
  it("composes the canvas's painted scale for both", () => {
    expect(probeScale("margin", "top", halfItself, { x: 0.5, y: 0.5 })).toBe(
      0.5
    );
    expect(probeScale("padding", "top", halfItself, { x: 0.5, y: 0.5 })).toBe(
      0.25
    );
  });
});

describe("the probe is asked again on every measurement", () => {
  /*
   * The answer describes how a block responds under the CSS applying to it, and
   * what changes that CSS is open-ended: an edit, a breakpoint re-resolving at a
   * new canvas width, a container query answering to a sibling, a forced state,
   * a pointer matching `:hover`. Remembering it means dropping it for each of
   * those in turn, which is a list that stays complete until the next one.
   *
   * Counted by the WRITES the probe makes, since that is what asking costs and
   * what a remembered answer would have avoided.
   */
  function countProbeWrites(block: HTMLElement): () => number {
    let probes = 0;
    const real = block.style.setProperty.bind(block.style);
    block.style.setProperty = (...args: Parameters<typeof real>): void => {
      /*
       * The MEASURED property, named by what it IS rather than by excluding
       * what it is not. A probe writes more than the value it is measuring — it
       * also says which transitions to keep — and a count that listed those by
       * name would move whenever the probe's mechanics changed, describing how
       * it is written rather than how often it runs.
       */
      const measured = /^(?:margin|padding)-/.test(String(args[0]));
      if (measured) probes += 1;
      real(...args);
    };
    return () => probes;
  }

  function selectedBlock(container: HTMLElement): HTMLElement {
    const block = container.querySelector(`[${NODE_ID_ATTRIBUTE}="a"]`);
    if (!(block instanceof HTMLElement)) throw new Error("no block to probe");
    return block;
  }

  /*
   * Mounting marks the selection on the block, which is a real attribute change
   * and earns a measurement of its own. Counting from AFTER that settles is what
   * separates the probe's own cost from the canvas's.
   */
  async function settled(): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }

  it("re-probes on a measurement that changed nothing else", async () => {
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    await settled();
    const writes = countProbeWrites(selectedBlock(container));

    remeasure();
    await settled();
    // One per side of each box, with nothing carried over from the earlier pass.
    expect(writes()).toBe(8);

    remeasure();
    await settled();
    expect(writes()).toBe(16);
  });

  /*
   * And asking every pass does not become a loop, which is the property that
   * makes it safe rather than merely correct. The probe writes to a node this
   * overlay's own subscription watches; what stops it is the canvas ignoring a
   * batch of mutations whose net effect is nothing.
   */
  it("does not schedule another measurement by probing", async () => {
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    await settled();
    const writes = countProbeWrites(selectedBlock(container));

    remeasure();
    await settled();
    const afterOnePass = writes();
    expect(afterOnePass).toBe(8);

    // Nothing further, however long the observer is given to deliver.
    await settled();
    await settled();
    expect(writes()).toBe(afterOnePass);
  });
});

describe("the space a container puts between its children", () => {
  /** A container declaring a child gap, holding two leaves. */
  function registerStack() {
    register();
    if (hasBlock("acme/stack")) return;
    registerBlocks(
      [
        {
          name: "acme/stack",
          version: 1,
          description: "A stack.",
          example: { props: {} },
          editor: { label: "Stack" },
          childGap: { $token: "space.stack" },
          slots: { children: {} },
          supports: { spacing: { margin: true, padding: true } },
          render: ({
            className,
            renderSlot,
          }: {
            className: string;
            renderSlot: (name: string) => React.ReactNode;
          }) =>
            React.createElement("div", { className }, renderSlot("children")),
        },
        {
          // A leaf that wears the classes it is handed, as every core block
          // does, so its own node class can be taken away and put back.
          name: "acme/item",
          version: 1,
          description: "An item.",
          example: { props: {} },
          supports: { spacing: { margin: true, padding: true } },
          render: ({ className }: { className: string }) =>
            React.createElement("p", { className }, "item"),
        },
      ] as never,
      { source: "spacing-overlay-test" }
    );
  }

  const STACKED = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "s",
        type: "acme/stack",
        version: 1,
        props: {},
        slots: {
          children: [
            { id: "a", type: "acme/item", version: 1, props: {} },
            { id: "b", type: "acme/item", version: 1, props: {} },
          ],
        },
      },
    ],
  } as unknown as BlockDocument;

  /** A compile context, so the canvas compiles and marks gap containers. */
  const COMPILED = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };

  function stackedEditor(selectedId: string): EditorState {
    return { ...editorOf(selectedId), document: STACKED } as EditorState;
  }

  /**
   * Computed styles per node, modelling the cascade the overlay probes:
   * whether the element wears its own node class (an author's value applies),
   * whether the container's gap rule reaches it (its parent wears the gap
   * marker the compiler keys that rule on), and whether the parent still wears
   * its block-type class (the defaults, such as padding, that a percentage
   * margin resolves against).
   */
  function stubByElement(
    styles: (
      id: string,
      ownClass: boolean,
      gapRuleMatches: boolean,
      parentDefaults: boolean
    ) => Partial<Record<string, string>> | undefined
  ) {
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) => {
      const id = element.getAttribute?.(NODE_ID_ATTRIBUTE);
      const ownClass = Array.from(element.classList ?? []).some(
        name =>
          name.startsWith("nx-pb-") &&
          name !== "nx-pb-contained" &&
          name !== CHILD_GAP_CLASS
      );
      const parentClasses = Array.from(element.parentElement?.classList ?? []);
      const gapRuleMatches = parentClasses.includes(CHILD_GAP_CLASS);
      const parentDefaults = parentClasses.some(name =>
        name.startsWith("nx-bt-")
      );
      const values =
        id === null || id === undefined
          ? undefined
          : styles(id, ownClass, gapRuleMatches, parentDefaults);
      return values === undefined
        ? REAL_COMPUTED_STYLE(element, pseudo)
        : styleOf(
            Object.fromEntries(
              Object.entries(values).filter(
                (entry): entry is [string, string] => entry[1] !== undefined
              )
            )
          );
    }) as typeof window.getComputedStyle);
  }

  function mountStacked(selectedId: string) {
    stubLayoutBoxes(true);
    registerStack();
    const editor = stackedEditor(selectedId);
    return render(
      <Canvas
        document={editor.document}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId={editor.selectedId}
        selectedIds={editor.selection.ids}
        render={{ styleContext: COMPILED }}
        overlay={<SpacingOverlay editor={editor} />}
      />
    );
  }

  it("names the container a second child's top space comes from", () => {
    stubByElement((id, _own, gap) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? { marginTop: gap ? "18px" : "0px" }
          : undefined
    );
    const { container } = mountStacked("b");
    expect(labels(container)).toEqual(["18 · Gap · from Stack"]);
  });

  it("calls an author's own margin on the child its own", () => {
    // 40px while the node wears its own class, 18px (the gap) without it: the
    // author's value is what is on screen, and it is theirs.
    stubByElement((id, ownClass, gap) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? { marginTop: ownClass ? "40px" : gap ? "18px" : "0px" }
          : undefined
    );
    const { container } = mountStacked("b");
    expect(labels(container)).toEqual(["40"]);
  });

  it("calls an author's margin its own even when it equals the gap", () => {
    // The author's class sets the same 18px the gap would: the gap rule loses
    // to it, so taking the gap rule away changes nothing and the space is the
    // block's own. Comparing values alone would call it the container's.
    stubByElement((id, ownClass, gap) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? { marginTop: ownClass ? "18px" : gap ? "18px" : "0px" }
          : undefined
    );
    const { container } = mountStacked("b");
    expect(labels(container)).toEqual(["18"]);
  });

  it("never calls the first child's space a gap", () => {
    stubByElement(id =>
      id === "s"
        ? { display: "block" }
        : id === "a"
          ? { marginTop: "18px" }
          : undefined
    );
    const { container } = mountStacked("a");
    expect(labels(container)).toEqual(["18"]);
  });

  it("names the container through the resolver the canvas renders with", () => {
    // A container only the canvas's own resolver knows: nothing registers it
    // in the process registry, so asking that registry finds no editor label
    // and would name the owner after its type ("Private stack") instead of the
    // label this resolver gives it.
    stubLayoutBoxes(true);
    registerStack();
    const resolver = createBlockResolver([
      {
        name: "acme/private-stack",
        version: 1,
        description: "A stack only this canvas knows.",
        example: { props: {} },
        editor: { label: "Hero band" },
        childGap: "1rem",
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => React.ReactNode;
        }) => React.createElement("div", { className }, renderSlot("children")),
      },
      getBlock("acme/item"),
    ] as never);
    const document = {
      ...STACKED,
      nodes: [{ ...STACKED.nodes[0], type: "acme/private-stack" }],
    } as unknown as BlockDocument;
    stubByElement((id, _own, gap) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? { marginTop: gap ? "16px" : "0px" }
          : undefined
    );
    const editor = { ...editorOf("b"), document } as EditorState;
    const { container } = render(
      <Canvas
        document={document}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="b"
        selectedIds={["b"]}
        render={{ blocks: resolver, styleContext: COMPILED }}
        overlay={<SpacingOverlay editor={editor} blocks={resolver} />}
      />
    );
    expect(labels(container)).toEqual(["16 · Gap · from Hero band"]);
  });

  it("names a container whose gap only the compile context declares", () => {
    // A container whose definition declares no `childGap`: the gap comes from
    // the compile context alone, which marks the container and writes the gap
    // all the same. Reading ownership from the definition would find nothing
    // there and call the gap the child's own margin.
    stubLayoutBoxes(true);
    registerStack();
    const resolver = createBlockResolver([
      {
        name: "acme/plain-stack",
        version: 1,
        description: "A stack declaring no gap of its own.",
        example: { props: {} },
        editor: { label: "Plain stack" },
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => React.ReactNode;
        }) => React.createElement("div", { className }, renderSlot("children")),
      },
      getBlock("acme/item"),
    ] as never);
    const document = {
      ...STACKED,
      nodes: [{ ...STACKED.nodes[0], type: "acme/plain-stack" }],
    } as unknown as BlockDocument;
    stubByElement((id, _own, gap) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? { marginTop: gap ? "16px" : "0px" }
          : undefined
    );
    const editor = { ...editorOf("b"), document } as EditorState;
    const { container } = render(
      <Canvas
        document={document}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="b"
        selectedIds={["b"]}
        render={{
          blocks: resolver,
          styleContext: {
            ...COMPILED,
            childGaps: { "acme/plain-stack": "1rem" },
          },
        }}
        overlay={<SpacingOverlay editor={editor} blocks={resolver} />}
      />
    );
    // The marker is what the compiled gap rule is keyed on, so its presence
    // shows the context's gap reached the canvas.
    expect(
      container.querySelector(`[${NODE_ID_ATTRIBUTE}="s"]`)?.classList
    ).toContain(CHILD_GAP_CLASS);
    expect(labels(container)).toEqual(["16 · Gap · from Plain stack"]);
  });

  it("calls an author's percentage margin its own, though the section's padding moves it", () => {
    // 5% of a width the section's own padding decides: without the section's
    // defaults it would compute differently, but the gap rule losing is what
    // matters, and only the gap marker comes off to ask.
    stubByElement((id, ownClass, gap, parentDefaults) =>
      id === "s"
        ? { display: "block" }
        : id === "b"
          ? {
              marginTop: ownClass
                ? parentDefaults
                  ? "40px"
                  : "38px"
                : gap
                  ? "18px"
                  : "0px",
            }
          : undefined
    );
    const { container } = mountStacked("b");
    expect(labels(container)).toEqual(["40"]);
  });

  it("names the loop as the owner of a gap inside one of its entries", () => {
    // A container that repeats its slot inside wrappers of its own, as a
    // configured collection loop draws its entries: the wrapper holds the gap
    // rule and the marker, and is no node, so the loop around it is the owner.
    // That the real loop puts the marker on its wrappers is asserted on its
    // rendered markup in `blocks-react`'s `collection-loop-spacing.test.tsx`.
    stubLayoutBoxes(true);
    registerStack();
    const resolver = createBlockResolver([
      {
        name: "acme/loop",
        version: 1,
        description: "A loop drawing its template once per entry.",
        example: { props: {} },
        editor: { label: "Collection loop" },
        childGap: { $token: "space.stack" },
        slots: { children: {} },
        render: ({
          className,
          renderSlot,
        }: {
          className: string;
          renderSlot: (name: string) => React.ReactNode;
        }) =>
          React.createElement(
            "div",
            { className },
            ["e1", "e2"].map(key =>
              React.createElement(
                "div",
                { key, className: `nx-bt-acme--loop ${CHILD_GAP_CLASS}` },
                renderSlot("children")
              )
            )
          ),
      },
      getBlock("acme/item"),
    ] as never);
    const document = {
      ...STACKED,
      nodes: [{ ...STACKED.nodes[0], id: "loop", type: "acme/loop" }],
    } as unknown as BlockDocument;
    stubByElement((id, _own, gap) =>
      id === "b" ? { marginTop: gap ? "18px" : "0px" } : undefined
    );
    const editor = { ...editorOf("b"), document } as EditorState;
    const { container } = render(
      <Canvas
        document={document}
        siteStyles={{ css: "", classes: {} } as never}
        selectedId="b"
        selectedIds={["b"]}
        render={{ blocks: resolver, styleContext: COMPILED }}
        overlay={<SpacingOverlay editor={editor} blocks={resolver} />}
      />
    );
    expect(labels(container)).toEqual(["18 · Gap · from Collection loop"]);
  });

  it("leaves a flex container's child margin alone, since flex spaces with gap", () => {
    stubByElement(id =>
      id === "s"
        ? { display: "flex" }
        : id === "b"
          ? { marginTop: "18px" }
          : undefined
    );
    const { container } = mountStacked("b");
    expect(labels(container)).toEqual(["18"]);
  });
});
