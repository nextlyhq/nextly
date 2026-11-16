// @vitest-environment jsdom

/**
 * Observers and scroll listeners built in the realm of the canvas they watch.
 *
 * Each case puts the canvas in a real iframe's document, whose window jsdom
 * gives constructors of its own, and gives the two windows SEPARATE
 * recorders: the frame's, where an observer of the canvas has to come from,
 * and the editor's, which a bare `new ResizeObserver` reaches for. A case
 * passes only when the frame's recorder saw the canvas and the editor's did
 * not, so code still reading the global fails it rather than passing on a
 * shared stub.
 *
 * @module canvas-frame-realm.test
 */
import {
  clearBlocks,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Canvas, DropRefusal } from "./canvas";
import type { CanvasDragState } from "./canvas-drag";
import { CanvasFrameProvider } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import { observeRenderedTree } from "./rendered-tree";
import { CANVAS_ROOT_CLASS } from "./shell-state";
import { useCanvasReading } from "./use-canvas-reading";

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Records what each observer built from it was asked to watch. */
function resizeRecorder(observed: unknown[]) {
  return class {
    observe(target: unknown): void {
      observed.push(target);
    }
    unobserve(): void {}
    disconnect(): void {}
  };
}

/**
 * A frame whose window builds recording observers, and an editor window whose
 * observers record somewhere else.
 *
 * The frame's `MutationObserver` stays jsdom's real one for that window, so it
 * still delivers; it only notes each construction.
 */
function frameRealm() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument;
  // Read through the document for its full type: `contentWindow` is typed as
  // a bare `Window`, which declares none of the constructors.
  const view = doc?.defaultView ?? null;
  if (doc === null || view === null) throw new Error("no frame realm");
  // The control: a second window, not the global under another name.
  expect(view).not.toBe(window);

  const frameObserved: unknown[] = [];
  const editorObserved: unknown[] = [];
  Object.defineProperty(view, "ResizeObserver", {
    value: resizeRecorder(frameObserved),
  });
  vi.stubGlobal("ResizeObserver", resizeRecorder(editorObserved));

  const frameMutations: unknown[] = [];
  const editorMutations: unknown[] = [];
  const FrameBase = view.MutationObserver;
  Object.defineProperty(view, "MutationObserver", {
    value: class extends FrameBase {
      constructor(callback: MutationCallback) {
        super(callback);
        frameMutations.push(this);
      }
    },
  });
  const EditorBase = globalThis.MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    class extends EditorBase {
      constructor(callback: MutationCallback) {
        super(callback);
        editorMutations.push(this);
      }
    }
  );
  return {
    frame,
    doc,
    frameObserved,
    editorObserved,
    frameMutations,
    editorMutations,
  };
}

/** A canvas root and a chrome layer inside it, in `doc`. */
function rootIn(doc: Document): { root: HTMLElement; layer: HTMLElement } {
  const root = doc.createElement("div");
  root.className = CANVAS_ROOT_CLASS;
  const layer = doc.createElement("div");
  root.append(layer);
  doc.body.append(root);
  return { root, layer };
}

describe("the overlays' geometry watch, on a canvas in a frame", () => {
  it("observes the root's sizes with the frame's ResizeObserver", () => {
    const realm = frameRealm();
    const { root, layer } = rootIn(realm.doc);
    const stop = watchCanvasFor(
      () => layer,
      () => {}
    );
    expect(realm.frameObserved.includes(root)).toBe(true);
    expect(realm.editorObserved).toEqual([]);
    stop?.();
  });

  it("watches the root's subtree with the frame's MutationObserver", () => {
    const realm = frameRealm();
    const { layer } = rootIn(realm.doc);
    const stop = watchCanvasFor(
      () => layer,
      () => {}
    );
    expect(realm.frameMutations.length).toBeGreaterThan(0);
    expect(realm.editorMutations).toEqual([]);
    stop?.();
  });

  it("re-measures when the frame's own viewport scrolls", () => {
    // A viewport's scroll is dispatched at the document, which no listener on
    // the root hears.
    const realm = frameRealm();
    const { layer } = rootIn(realm.doc);
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    realm.doc.dispatchEvent(new Event("scroll"));
    expect(moves).toBe(1);
    stop?.();
    // And stops hearing it once unsubscribed.
    realm.doc.dispatchEvent(new Event("scroll"));
    expect(moves).toBe(1);
  });
});

describe("the rendered tree's watch, on a canvas in a frame", () => {
  it("is built from the frame's MutationObserver", () => {
    const realm = frameRealm();
    const { root } = rootIn(realm.doc);
    const stop = observeRenderedTree(root, () => {});
    expect(realm.frameMutations).toHaveLength(1);
    expect(realm.editorMutations).toEqual([]);
    stop();
  });
});

describe("the inspector's reading of the canvas, in a frame", () => {
  it("observes the canvas root with the frame's ResizeObserver", () => {
    const realm = frameRealm();
    const { root } = rootIn(realm.doc);
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [],
    };
    renderHook(() => useCanvasReading(root, null, { document }));
    expect(realm.frameObserved.includes(root)).toBe(true);
    expect(realm.editorObserved).toEqual([]);
  });
});

const BLOCKS: AnyBlockDefinition[] = [
  {
    name: "realm/box",
    version: 1,
    description: "A container.",
    example: { props: {} },
    render: ({ className }: { className: string }) =>
      React.createElement("div", { className }),
  },
  {
    name: "realm/leaf",
    version: 1,
    description: "A leaf.",
    example: { props: {} },
    render: ({ className }: { className: string }) =>
      React.createElement("p", { className }, "leaf"),
  },
] as never;

const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "box", type: "realm/box", version: 1, props: {} },
    { id: "leaf", type: "realm/leaf", version: 1, props: {} },
  ],
} as BlockDocument;

/** A container for React inside the frame's document. */
function containerIn(doc: Document): HTMLDivElement {
  const container = doc.createElement("div");
  doc.body.append(container);
  return container;
}

describe("the drop refusal notice, in a frame", () => {
  it("follows the frame's own viewport as it scrolls", async () => {
    registerBlocks(BLOCKS, { source: "canvas-frame-realm-test" });
    const realm = frameRealm();
    // What a browser gives a standards-mode document and jsdom leaves
    // undefined: the root element scrolls the viewport.
    Object.defineProperty(realm.doc, "scrollingElement", {
      value: realm.doc.documentElement,
    });
    const container = containerIn(realm.doc);
    const drag: CanvasDragState = {
      draggingId: "leaf",
      draggingBlockName: "realm/leaf",
      target: null,
      refusal: {
        regionId: "box::children",
        parentId: "box",
        reason: "wrong-parent",
        permitted: [],
      } as never,
    };
    render(
      <CanvasFrameProvider frame={realm.frame}>
        <Canvas
          document={PAGE}
          siteStyles={false}
          drag={drag}
          overlay={<DropRefusal drag={drag} document={PAGE} />}
        />
      </CanvasFrameProvider>,
      { container }
    );
    await act(async () => undefined);
    const notice = container.querySelector<HTMLElement>(".nx-drop-refusal");
    const box = container.querySelector<HTMLElement>(
      `[${NODE_ID_ATTRIBUTE}="box"]`
    );
    if (notice === null || box === null) throw new Error("nothing drawn");
    // Held 12 pixels inside the top of the frame's viewport, where an
    // unmeasured box at the page's origin is.
    expect(notice.style.top).toBe("12px");

    // The page scrolls under a stationary pointer: the box is now elsewhere,
    // and only the scroll can say so.
    box.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 300,
        left: 20,
        top: 300,
        width: 100,
        height: 50,
      }) as DOMRect;
    await act(async () => {
      realm.doc.dispatchEvent(new Event("scroll"));
    });
    expect(notice.style.top).toBe("300px");
  });

  it("is held inside the frame's viewport for a tall container whose top has scrolled away", async () => {
    // The frame's page is scrolled 1000 pixels down a 600-pixel viewport, and
    // the refused container starts 100 pixels into the page and runs on for
    // 3000. Its top is far above the viewport, so the explanation belongs at
    // the viewport's top edge, 12 pixels in: content y 1012. Nothing inside a
    // frame is styled to scroll, so a band taken from an ancestor walk finds
    // none and leaves the explanation at y 100, out of sight.
    registerBlocks(BLOCKS, { source: "canvas-frame-realm-test" });
    const realm = frameRealm();
    Object.defineProperty(realm.doc, "scrollingElement", {
      value: realm.doc.documentElement,
    });
    const view = realm.doc.defaultView;
    if (view === null) throw new Error("no frame window");
    Object.defineProperty(view, "innerHeight", { value: 600 });
    Object.defineProperty(view, "innerWidth", { value: 800 });
    const container = containerIn(realm.doc);
    const drag: CanvasDragState = {
      draggingId: "leaf",
      draggingBlockName: "realm/leaf",
      target: null,
      refusal: {
        regionId: "box::children",
        parentId: "box",
        reason: "wrong-parent",
        permitted: [],
      } as never,
    };
    const result = render(
      <CanvasFrameProvider frame={realm.frame}>
        <Canvas
          document={PAGE}
          siteStyles={false}
          drag={drag}
          overlay={<DropRefusal drag={drag} document={PAGE} />}
        />
      </CanvasFrameProvider>,
      { container }
    );
    await act(async () => undefined);
    const root = container.querySelector<HTMLElement>(`.${CANVAS_ROOT_CLASS}`);
    const box = container.querySelector<HTMLElement>(
      `[${NODE_ID_ATTRIBUTE}="box"]`
    );
    const notice = container.querySelector<HTMLElement>(".nx-drop-refusal");
    if (root === null || box === null || notice === null) {
      throw new Error("nothing drawn");
    }
    root.getBoundingClientRect = () =>
      ({
        x: 0,
        y: -1000,
        left: 0,
        top: -1000,
        width: 800,
        height: 4000,
      }) as DOMRect;
    box.getBoundingClientRect = () =>
      ({
        x: 0,
        y: -900,
        left: 0,
        top: -900,
        width: 800,
        height: 3000,
      }) as DOMRect;
    // Re-measured by the scroll it subscribes to, now that the page is laid out.
    await act(async () => {
      realm.doc.dispatchEvent(new Event("scroll"));
    });
    expect(notice.style.top).toBe("1012px");
    result.unmount();
  });
});
