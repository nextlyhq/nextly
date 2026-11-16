/**
 * @vitest-environment jsdom
 */
/**
 * Opening the editor at the section its address names.
 *
 * The wrong versions this separates: one that selects but never scrolls (the
 * author lands at the top of a long page with an outline somewhere below), one
 * that scrolls once and gives up when the canvas draws after it looked, one
 * that selects whatever id it is handed (an address naming a deleted section
 * would leave a selection with nothing on screen), and one that re-runs on
 * every render and drags the author back each time they scroll away.
 */
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTLE_MS, useOpenAtSection } from "./use-open-at-section";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const DOCUMENT = {
  nodes: [
    { id: "hero", type: "core/section", version: 1, props: {} },
    {
      id: "plans",
      type: "core/section",
      version: 1,
      props: {},
      slots: {
        children: [{ id: "nested", type: "core/text", version: 1, props: {} }],
      },
    },
  ],
};

function drawn(canvas: HTMLElement, id: string): ReturnType<typeof vi.fn> {
  const element = document.createElement("section");
  element.setAttribute(NODE_ID_ATTRIBUTE, id);
  const scroll = vi.fn();
  element.scrollIntoView = scroll;
  canvas.append(element);
  return scroll;
}

function canvasElement(): HTMLDivElement {
  const canvas = document.createElement("div");
  document.body.append(canvas);
  return canvas;
}

function setup(
  sectionId: string | undefined,
  canvas: HTMLElement | null,
  blockId?: string
) {
  const select = vi.fn();
  const requestPanel = vi.fn();
  const hook = renderHook(
    ({ canvas: root }: { canvas: HTMLElement | null }) =>
      useOpenAtSection({
        sectionId,
        blockId,
        editor: { document: DOCUMENT as never, select },
        canvas: root,
        requestPanel,
      }),
    { initialProps: { canvas } }
  );
  return { select, requestPanel, hook };
}

describe("useOpenAtSection", () => {
  it("selects the section, shows Layers and scrolls the section into view", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "plans");

    const { select, requestPanel } = setup("plans", canvas);

    expect(select).toHaveBeenCalledWith("plans");
    expect(requestPanel).toHaveBeenCalledWith("layers");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a section the page no longer has", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");

    const { select, requestPanel } = setup("deleted", canvas);

    expect(select).not.toHaveBeenCalled();
    expect(requestPanel).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does nothing for a block that is not a section of the page", () => {
    // A section is a top-level block; an address naming a nested one names no
    // section the entry screen offered.
    const { select } = setup("nested", canvasElement());
    expect(select).not.toHaveBeenCalled();
  });

  it("selects a block at any depth when the address names it as a block", () => {
    // The bindings report links the block holding a binding, wherever it
    // sits; the same id as a section opens nothing (the case above).
    const canvas = canvasElement();
    drawn(canvas, "nested");
    const { select, requestPanel } = setup(undefined, canvas, "nested");
    expect(select).toHaveBeenCalledWith("nested");
    expect(requestPanel).toHaveBeenCalledWith("layers");
  });

  it("does nothing when the address names no section", () => {
    const { select, requestPanel } = setup(undefined, canvasElement());
    expect(select).not.toHaveBeenCalled();
    expect(requestPanel).not.toHaveBeenCalled();
  });

  it("scrolls once the canvas exists, when it mounts after the editor", () => {
    const { hook } = setup("hero", null);
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");

    hook.rerender({ canvas });

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls once the section is drawn, when the canvas draws it later", async () => {
    const canvas = canvasElement();
    setup("hero", canvas);

    const scroll = drawn(canvas, "hero");
    // The observer reports on a microtask after the mutation.
    await act(async () => {
      await Promise.resolve();
    });

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls only once, however often the editor renders after", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "hero");
    const { hook, select } = setup("hero", canvas);

    hook.rerender({ canvas });
    hook.rerender({ canvas });

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("useOpenAtSection while the editor settles", () => {
  /** Resize observers created, so a test can report a resize as layout would. */
  let resized: (() => void)[] = [];
  beforeEach(() => {
    resized = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private live = true;
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(): void {
          // A disconnected observer reports nothing, as a real one does.
          resized.push(() => {
            if (!this.live) return;
            act(() => this.callback([], this as unknown as ResizeObserver));
          });
        }
        disconnect(): void {
          this.live = false;
        }
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const resize = (): void => resized.forEach(report => report());

  it("keeps the section in view as the canvas resizes around it", () => {
    // Opening Layers adds a panel and narrows the canvas a render or two
    // after the first scroll; the text above the section reflows, and the
    // section can move back out of view.
    const canvas = canvasElement();
    const scroll = drawn(canvas, "plans");
    setup("plans", canvas);
    expect(scroll).toHaveBeenCalledTimes(1);

    resize();

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("lets go as soon as the author scrolls, clicks or types", () => {
    const canvas = canvasElement();
    const scroll = drawn(canvas, "plans");
    setup("plans", canvas);

    act(() => {
      window.dispatchEvent(new WheelEvent("wheel"));
    });
    resize();

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("lets go when the author clicks in the editor around a canvas in a frame", () => {
    // In a frame, the canvas has a window of its own, and a click, key or
    // wheel over the editor's panels is delivered to the EDITOR's window, not
    // the canvas's. Listening on the canvas's alone, settling carries on and
    // the next resize pulls the author back to the section.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    const view = inner?.defaultView ?? null;
    if (inner === null || view === null) throw new Error("no frame realm");
    expect(view).not.toBe(window);
    Object.defineProperty(view, "ResizeObserver", {
      value: globalThis.ResizeObserver,
    });
    const canvas = inner.createElement("div");
    inner.body.append(canvas);
    const section = inner.createElement("section");
    section.setAttribute(NODE_ID_ATTRIBUTE, "plans");
    const scroll = vi.fn();
    section.scrollIntoView = scroll;
    canvas.append(section);
    setup("plans", canvas);
    // The control: settling is under way, so a resize reveals the section
    // again.
    resize();
    expect(scroll).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    resize();

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("lets go once the editor has had time to settle", () => {
    vi.useFakeTimers();
    const canvas = canvasElement();
    const scroll = drawn(canvas, "plans");
    setup("plans", canvas);

    act(() => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    resize();

    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

describe("a canvas rendered in a frame", () => {
  it("waits for the section with an observer from the frame's own window", async () => {
    // The canvas's nodes belong to the frame's document, so the observer
    // watching for the section to be drawn is built from that window. Two
    // recorders tell the windows apart: the editor's is what a bare
    // `new MutationObserver` reaches for.
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    const view = inner?.defaultView ?? null;
    if (inner === null || view === null) throw new Error("no frame realm");
    expect(view).not.toBe(window);
    const framed: unknown[] = [];
    const strays: unknown[] = [];
    const FrameBase = view.MutationObserver;
    Object.defineProperty(view, "MutationObserver", {
      value: class extends FrameBase {
        constructor(callback: MutationCallback) {
          super(callback);
          framed.push(this);
        }
      },
    });
    const EditorBase = globalThis.MutationObserver;
    vi.stubGlobal(
      "MutationObserver",
      class extends EditorBase {
        constructor(callback: MutationCallback) {
          super(callback);
          strays.push(this);
        }
      }
    );
    const canvas = inner.createElement("div");
    inner.body.append(canvas);
    setup("hero", canvas);

    const element = inner.createElement("section");
    element.setAttribute(NODE_ID_ATTRIBUTE, "hero");
    const scroll = vi.fn();
    element.scrollIntoView = scroll;
    canvas.append(element);
    await act(async () => {
      await Promise.resolve();
    });

    expect(framed).toHaveLength(1);
    expect(strays).toEqual([]);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
