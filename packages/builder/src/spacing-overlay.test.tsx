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
  hasBlock,
  registerBlocks,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS, Canvas } from "./canvas";
import type { EditorState } from "./editor-state";
import { SpacingOverlay } from "./spacing-overlay";

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
        render: () => React.createElement("p", null, "leaf"),
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
  } as unknown as EditorState;
}

/** The properties the overlay reads, with everything else reported as zero. */
function styleOf(values: Record<string, string>): CSSStyleDeclaration {
  const zeroed: Record<string, string> = {
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
function stubComputedStyle(byNodeId: Record<string, Record<string, string>>) {
  const real = window.getComputedStyle.bind(window);
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
  constructor(_callback: ResizeObserverCallback) {
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

function withFakeResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
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
  it("is hidden from assistive technology", () => {
    // The values are in the inspector's Spacing section with real labels and
    // controls. Announcing up to eight numbers on every selection change would
    // bury that surface in the readers it exists for.
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));
    const layer = container.querySelector(".nx-spacing-overlay");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("what it stays subscribed to", () => {
  it("watches the canvas ROOT as well as the selected block", () => {
    /*
     * A `ResizeObserver` reports a size change and never a position one, so a
     * sibling above the selection finishing its load moves the block without
     * resizing it and the block's own entry never fires. The root sizes to its
     * content, which makes that reflow observable.
     */
    withFakeResizeObserver();
    stubComputedStyle({ a: { marginTop: "16px" } });
    const { container } = mount(editorOf("a"));

    const observer = FakeResizeObserver.instances.at(-1);
    const root = container.querySelector(`.${CANVAS_ROOT_CLASS}`);
    const block = container.querySelector('[data-nx-node="a"]');
    expect(observer?.observed).toContain(root);
    expect(observer?.observed).toContain(block);
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
    const before = FakeResizeObserver.instances.at(-1);

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
