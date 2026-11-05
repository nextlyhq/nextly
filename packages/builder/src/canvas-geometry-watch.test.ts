// @vitest-environment jsdom

/**
 * A batch of mutations that changed nothing is not a change.
 *
 * An overlay that MEASURES by writing has to write into the subtree it watches:
 * the spacing probe pushes a value, reads the edge and puts the attribute back,
 * all inside one task. Reacting to that would have every measurement schedule
 * the next one forever. Remembering the answers instead avoids that and buys a
 * staleness of its own, since the applied CSS changes for reasons nothing here
 * reports. Ignoring a net-zero batch removes the need to choose between them.
 *
 * @module canvas-geometry-watch.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OVERLAY_OUTPUT_ATTRIBUTE,
  watchCanvasFor,
  watchScreenBand,
} from "./canvas-geometry-watch";
import { CANVAS_ROOT_CLASS } from "./shell-state";

function canvas(): {
  root: HTMLElement;
  layer: HTMLElement;
  block: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = CANVAS_ROOT_CLASS;
  const layer = document.createElement("div");
  const block = document.createElement("div");
  root.append(block, layer);
  document.body.append(root);
  return { root, layer, block };
}

/** Let the `MutationObserver` deliver, which it does as a microtask. */
async function delivered(): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a block that moves without resizing", () => {
  it("re-measures when a block's keyframe animation ends or is cancelled", () => {
    // An entrance animation or a site's @keyframes moves a block by
    // transform: nothing resizes, mutates or finishes a transition, so the
    // marks stay at the starting geometry unless the animation's own end is
    // heard. The events bubble, so a block's reaches the root.
    const { layer, block } = canvas();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    block.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(moved).toHaveBeenCalledTimes(1);
    block.dispatchEvent(new Event("animationcancel", { bubbles: true }));
    expect(moved).toHaveBeenCalledTimes(2);
    stop?.();
    // Released with the rest: nothing is heard after the watch stops.
    block.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(moved).toHaveBeenCalledTimes(2);
  });
});

describe("a block an authored state rule moves", () => {
  it("re-measures when the input modality changes, which can turn :focus-visible on alone", () => {
    // A block a pointer focused starts matching :focus-visible once the
    // keyboard is used, with no focus event: the key press is the signal, as
    // a pointer press is for the change back.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    block.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(1);
    block.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(2);
    // And when a press ends, which ends an authored :active state with no
    // pointer leaving and no focus changing.
    for (const type of ["pointerup", "pointercancel"]) {
      block.dispatchEvent(new Event(type, { bubbles: true }));
      for (const run of frames.splice(0)) run(0);
    }
    // Space releases a keyboard-activated :active state on keyup.
    block.dispatchEvent(
      new KeyboardEvent("keyup", { key: " ", bubbles: true })
    );
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(5);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("does not re-measure for ordinary typing, only for a change of modality", () => {
    // Every keystroke re-measuring would run each overlay's measurement once
    // a frame while an author types. Only the first key after a pointer
    // changes the modality; letters after it change nothing a style reads.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    const press = (key: string, target: Element = block) => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true })
      );
      target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      for (const run of frames.splice(0)) run(0);
    };
    press("a");
    expect(moved).toHaveBeenCalledTimes(1);
    for (const key of ["b", "c", "Shift", "Backspace"]) press(key);
    expect(moved).toHaveBeenCalledTimes(1);
    // A space typed into editable text activates nothing either, the
    // canvas's own plain-text editor included.
    for (const editable of ["true", "plaintext-only"]) {
      const text = block.ownerDocument.createElement("p");
      text.setAttribute("contenteditable", editable);
      block.append(text);
      press(" ", text);
    }
    expect(moved).toHaveBeenCalledTimes(1);
    // A form field's value changes with no mutation, and can change what
    // :valid or :placeholder-shown styles: its input event is heard.
    const field = block.ownerDocument.createElement("input");
    block.append(field);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(2);
    moved.mockClear();
    moved.mockImplementation(() => undefined);
    // A control the keyboard toggles is not text entry: Space on a checkbox
    // can move what an authored :checked rule styles.
    const box = block.ownerDocument.createElement("input");
    box.type = "checkbox";
    block.append(box);
    press(" ", box);
    // Down and up, measured once in the frame they share.
    expect(moved).toHaveBeenCalledTimes(1);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("measures a typed character once, for the text it changed", async () => {
    // Typing changes a text node: that change is measured. The key that
    // typed it, and the input event that follows, add nothing of their own.
    // A character that also resizes the block is the test after this one.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    const words = block.ownerDocument.createElement("p");
    words.setAttribute("contenteditable", "plaintext-only");
    words.textContent = "Some words";
    block.append(words);
    await delivered();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    // The modality is already the keyboard's.
    words.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    );
    for (const run of frames.splice(0)) run(0);
    moved.mockClear();

    words.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true })
    );
    const typed = words.firstChild;
    if (!(typed instanceof Text)) throw new Error("no text node");
    typed.appendData("s");
    // A browser follows the edit with an input event at the editing host,
    // which must not add a second measurement to the mutation's.
    words.dispatchEvent(new Event("input", { bubbles: true }));
    words.dispatchEvent(
      new KeyboardEvent("keyup", { key: "s", bubbles: true })
    );
    await delivered();
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(1);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("hears an edit inside a custom element's shadow root, which no mutation reports", () => {
    // The event reaches the root retargeted to the host, and the root's
    // mutation watch cannot see into the shadow tree: the composed path is
    // what shows a field, or editable text, inside it.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    const host = block.ownerDocument.createElement("x-widget");
    block.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const field = block.ownerDocument.createElement("input");
    const words = block.ownerDocument.createElement("p");
    words.setAttribute("contenteditable", "true");
    shadow.append(field, words);
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    for (const inside of [field, words]) {
      inside.dispatchEvent(
        new Event("input", { bubbles: true, composed: true })
      );
      for (const run of frames.splice(0)) run(0);
    }
    expect(moved).toHaveBeenCalledTimes(2);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("hears a custom control that reports its own value change", () => {
    // A custom element can keep its value in script and dispatch input and
    // change on itself, with no mutation and no resize to say so.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    // On its own, and nested in editable text, whose editability it inherits
    // without being where an edit's input is fired.
    const control = block.ownerDocument.createElement("x-rating");
    const words = block.ownerDocument.createElement("p");
    words.setAttribute("contenteditable", "true");
    const nested = block.ownerDocument.createElement("x-rating");
    words.append(nested);
    block.append(control, words);
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    for (const reporter of [control, nested]) {
      for (const type of ["input", "change"]) {
        reporter.dispatchEvent(new Event(type, { bubbles: true }));
        for (const run of frames.splice(0)) run(0);
      }
    }
    expect(moved).toHaveBeenCalledTimes(4);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("measures a keystroke that resizes its block by the text and the resize, and no more", async () => {
    /*
     * The mutation is measured as it is delivered, and a resize it causes is
     * delivered after layout as an observer's report of its own. The report
     * is not folded into the mutation's measurement: the same delivery can
     * carry a later change of layout (an image arriving at its size), which
     * a skipped report would leave unmeasured. The keystroke and the editing
     * host's input event add nothing to the two.
     */
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    let report: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          report = callback;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    const { layer, block } = canvas();
    const words = block.ownerDocument.createElement("p");
    words.setAttribute("contenteditable", "true");
    words.textContent = "Some words";
    block.append(words);
    await delivered();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    words.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true })
    );
    for (const run of frames.splice(0)) run(0);
    moved.mockClear();

    words.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true })
    );
    const typed = words.firstChild;
    if (!(typed instanceof Text)) throw new Error("no text node");
    typed.appendData("s");
    words.dispatchEvent(new Event("input", { bubbles: true }));
    words.dispatchEvent(
      new KeyboardEvent("keyup", { key: "s", bubbles: true })
    );
    await delivered();
    // The line wrapped: the observer reports the block's new size.
    report?.();
    for (const run of frames.splice(0)) run(0);
    expect(report, "the watch observes sizes").toBeDefined();
    expect(moved).toHaveBeenCalledTimes(2);
    stop?.();
    vi.unstubAllGlobals();
  });

  it("re-measures on the frame after the pointer or focus enters or leaves a block", () => {
    // An authored :hover or :focus-visible rule can move a block (a
    // transform, a margin) with no transition: nothing resizes or mutates,
    // so the change of state itself is the only signal. Measured on the next
    // frame, once the browser has applied the state's styles.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
      frames.push(run);
      return frames.length;
    });
    const { layer, block } = canvas();
    const moved = vi.fn();
    const stop = watchCanvasFor(() => layer, moved);
    for (const type of ["pointerover", "pointerout", "focusin", "focusout"]) {
      block.dispatchEvent(new Event(type, { bubbles: true }));
    }
    // Nothing yet: the state's styles apply before the next frame.
    expect(moved).not.toHaveBeenCalled();
    // One measurement for the frame, however many changes arrived in it.
    for (const run of frames.splice(0)) run(0);
    expect(moved).toHaveBeenCalledTimes(1);
    stop?.();
    vi.unstubAllGlobals();
  });
});

describe("a batch that changed nothing", () => {
  it("does not re-measure for a probe that put the attribute back", async () => {
    const { layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    // Exactly what the spacing probe does: write, read, restore, in one task.
    const had = block.getAttribute("style");
    block.style.setProperty("margin-bottom", "30px", "important");
    block.getBoundingClientRect();
    if (had === null) block.removeAttribute("style");
    else block.setAttribute("style", had);

    await delivered();
    expect(moves).toBe(0);
    stop?.();
  });

  /*
   * The control, and the half that makes the assertion above mean anything: a
   * real change to the same attribute on the same element still arrives. Without
   * it, a filter that dropped everything would pass.
   */
  it("still re-measures for a change that stuck", async () => {
    const { layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    block.style.setProperty("margin-bottom", "30px");

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * A node arriving is a change by construction, whatever the attributes in the
   * same batch did — a recompiled site sheet is a `childList` record, and
   * dropping it would leave every overlay drawn at the old rule's coordinates.
   */
  it("re-measures for a node arriving even beside a restored attribute", async () => {
    const { root, layer, block } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    const had = block.getAttribute("style");
    block.style.setProperty("margin-bottom", "30px", "important");
    if (had === null) block.removeAttribute("style");
    else block.setAttribute("style", had);
    root.append(document.createElement("style"));

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * A NAMESPACED attribute is addressed by its namespace, not by the local name
   * the record reports. `MutationRecord.attributeName` for `xlink:href` is
   * `href`, and `getAttribute("href")` answers `null` for it however it was
   * set — so comparing by local name asks about a different, absent attribute,
   * finds `null` on both sides, and passes a real change off as no change.
   */
  it("re-measures for a namespaced attribute the local name cannot see", async () => {
    const { root, layer } = canvas();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    svg.append(use);
    root.append(svg);
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#icon");

    await delivered();
    expect(moves).toBe(1);
    stop?.();
  });

  /*
   * And the caller's OWN output is still its own. A net-zero test would let a
   * layer's real redraw through if ownership stopped being checked.
   */
  it("still ignores the caller's own output", async () => {
    const { layer } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    layer.append(document.createElement("div"));

    await delivered();
    expect(moves).toBe(0);
    stop?.();
  });
});

describe("another overlay drawing", () => {
  it("re-measures nothing, while a page change beside it still does", async () => {
    /*
     * A layer drawn over the page and marked as overlay output moves no block,
     * so one overlay drawing must not make every other re-measure. The same
     * mutation in the page is the positive control: it shows this watch does
     * hear the subtree the layer sits in.
     */
    const { root, layer } = canvas();
    const other = document.createElement("div");
    other.setAttribute(OVERLAY_OUTPUT_ATTRIBUTE, "");
    root.append(other);
    await delivered();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );

    other.append(document.createElement("div"));
    await delivered();
    expect(moves, "another overlay's drawing").toBe(0);

    root.append(document.createElement("div"));
    await delivered();
    expect(moves, "a change in the page").toBe(1);
    stop?.();
  });
});

describe("a block rendered after the watch began", () => {
  /*
   * A ResizeObserver the test drives: it remembers what it was asked to
   * observe and reports a resize only for those, as a real one does.
   */
  class DrivenResizeObserver {
    static instances: DrivenResizeObserver[] = [];
    readonly observed = new Set<Element>();
    constructor(private readonly report: () => void) {
      DrivenResizeObserver.instances.push(this);
    }
    observe(element: Element): void {
      this.observed.add(element);
    }
    unobserve(element: Element): void {
      this.observed.delete(element);
    }
    disconnect(): void {
      this.observed.clear();
    }
    /** A resize of `element`, delivered only if it is being observed. */
    resize(element: Element): void {
      if (this.observed.has(element)) this.report();
    }
  }

  afterEach(() => {
    DrivenResizeObserver.instances = [];
    Reflect.deleteProperty(window, "ResizeObserver");
  });

  it("is observed for resizes once it arrives, and released when it leaves", async () => {
    /*
     * A block inserted after setup — a Suspense or async block resolving — is
     * measured on insertion, but an image loading inside it later resizes only
     * that block. Unobserved, nothing reports it and every overlay drawn over
     * it stays at the size it had before the image arrived.
     */
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: DrivenResizeObserver,
    });
    const { root, layer } = canvas();
    let moves = 0;
    const stop = watchCanvasFor(
      () => layer,
      () => {
        moves += 1;
      }
    );
    const sizes = DrivenResizeObserver.instances[0];
    expect(sizes, "the watch observes sizes").toBeDefined();

    // Arrives later, inside a wrapper, as a resolved block's subtree does.
    const wrapper = document.createElement("section");
    const late = document.createElement("div");
    late.setAttribute("data-nx-node", "late");
    wrapper.append(late);
    root.append(wrapper);
    await delivered();
    const settled = moves;

    sizes?.resize(late);
    expect(moves, "a resize of the late block re-measures").toBe(settled + 1);

    wrapper.remove();
    await delivered();
    expect(sizes?.observed.has(late), "a removed block is released").toBe(
      false
    );
    stop?.();
  });
});

describe("what moves the part of a canvas on screen", () => {
  /** A canvas in a frame, the frame in the host's document. */
  function framed(): { frame: HTMLIFrameElement; root: HTMLElement } {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("no frame document");
    const root = inner.createElement("div");
    root.className = CANVAS_ROOT_CLASS;
    inner.body.append(root);
    return { frame, root };
  }

  afterEach(() => {
    document.documentElement.style.overflowY = "";
    vi.unstubAllGlobals();
  });

  it("hears the host page scrolling at its document, where a viewport's scroll is told", () => {
    // The host's own page is the scroller around the frame: its scroll is
    // dispatched at the document, never at <html>.
    document.documentElement.style.overflowY = "auto";
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: document.documentElement,
    });
    const { frame, root } = framed();
    const moved = vi.fn();
    const stop = watchScreenBand(root, frame, moved);
    document.dispatchEvent(new Event("scroll"));
    expect(moved).toHaveBeenCalledTimes(1);
    stop();
  });

  it("hears the host's scroller resize, which no scroll or frame reading reports", () => {
    // A side panel resized at a fixed zoom: the host's region changes size
    // and nothing inside the frame does.
    const observed: Element[] = [];
    let report: (() => void) | undefined;
    class Sizes {
      constructor(callback: () => void) {
        report = callback;
      }
      observe(element: Element): void {
        observed.push(element);
      }
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", Sizes);
    const region = document.createElement("div");
    region.style.overflowY = "auto";
    document.body.append(region);
    const frame = document.createElement("iframe");
    region.append(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("no frame document");
    const root = inner.createElement("div");
    root.className = CANVAS_ROOT_CLASS;
    inner.body.append(root);
    const moved = vi.fn();
    const stop = watchScreenBand(root, frame, moved);
    expect(observed).toContain(region);
    report?.();
    expect(moved).toHaveBeenCalled();
    stop();
  });
});
