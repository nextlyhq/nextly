// @vitest-environment jsdom

/**
 * Which document and window the canvas is in, and the editor's keys reaching it.
 *
 * Each case that names a frame builds a real iframe: jsdom gives its
 * `contentDocument` a window of its own, so "the frame's document" is a
 * different object from the global `document` here exactly as it is in a
 * browser. A fixture that handed back the global document under another name
 * would let code reading the global pass every assertion below.
 *
 * @module canvas-frame-context.test
 */
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasFrameProvider,
  CanvasFrameShortcuts,
  inputDocuments,
  useCanvasFrame,
} from "./canvas-frame-context";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** An iframe attached to this document, with a readable document of its own. */
function frameOf(): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  if (frame.contentDocument === null) throw new Error("no frame document");
  // The control that makes every case below mean something: the frame's
  // document is NOT the one the global names.
  expect(frame.contentDocument).not.toBe(document);
  return frame;
}

function framed(frame: HTMLIFrameElement | null) {
  return function Wrapper({ children }: { children?: React.ReactNode }) {
    return <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>;
  };
}

describe("the document and window the canvas is in", () => {
  it("is the editor's own with no provider, as a canvas mounted directly is", () => {
    const { result } = renderHook(() => useCanvasFrame());
    expect(result.current.frame).toBeNull();
    expect(result.current.document).toBe(document);
    expect(result.current.window).toBe(window);
  });

  it("is the editor's own under a provider given no frame", () => {
    const { result } = renderHook(() => useCanvasFrame(), {
      wrapper: framed(null),
    });
    expect(result.current.document).toBe(document);
  });

  it("is the frame's under a provider given one", () => {
    const frame = frameOf();
    const { result } = renderHook(() => useCanvasFrame(), {
      wrapper: framed(frame),
    });
    expect(result.current.frame).toBe(frame);
    expect(result.current.document).toBe(frame.contentDocument);
    expect(result.current.window).toBe(frame.contentWindow);
    expect(result.current.window).not.toBe(window);
  });

  it("keeps one identity across renders while nothing has changed", () => {
    // Effects depend on it; a fresh object per render would tear down and
    // re-add every listener on every render.
    const frame = frameOf();
    const { result, rerender } = renderHook(() => useCanvasFrame(), {
      wrapper: framed(frame),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("the documents an input gesture can be delivered to", () => {
  it("is the editor's document and the frame's, editor's first, while framed", () => {
    const frame = frameOf();
    const { result } = renderHook(() => useCanvasFrame(), {
      wrapper: framed(frame),
    });
    expect(inputDocuments(result.current)).toEqual([
      document,
      frame.contentDocument,
    ]);
  });

  it("is the one document, once, while the canvas shares the editor's", () => {
    // Listening twice on one document would run every listener twice.
    const { result } = renderHook(() => useCanvasFrame());
    expect(inputDocuments(result.current)).toEqual([document]);
  });
});

/**
 * Registers a Mod+S binding on whatever manager the provider above holds.
 *
 * Not preventing the default, and that is what makes a doubled listener
 * visible: the manager skips a key whose default is already prevented, so with
 * the default prevented a second listener of the same manager on the same
 * document would run nothing and every "fires once" below would pass whether
 * or not the listener was doubled.
 */
function SaveBinding({ onSave }: { onSave: () => void }): null {
  useShortcuts(
    [
      {
        keys: "mod+s",
        description: "Save",
        preventDefault: false,
        run: () => onSave(),
      },
    ],
    { name: "Test save" }
  );
  return null;
}

/** Mod+S on a manager told it is not on Apple, where `mod` is Control. */
function pressSave(target: Document): void {
  fireEvent.keyDown(target, { key: "s", ctrlKey: true });
}

describe("the editor's shortcuts inside the frame", () => {
  it("fires a binding of the ONE manager for a key pressed in the frame", () => {
    const frame = frameOf();
    const onSave = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameProvider frame={frame}>
          <CanvasFrameShortcuts />
          <SaveBinding onSave={onSave} />
        </CanvasFrameProvider>
      </ShortcutProvider>
    );
    // The binding was registered on the editor's manager, not on anything
    // built for the frame: it is what the admin's save looks like.
    pressSave(frame.contentDocument!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("fires nothing in the frame without it, which is what it is for", () => {
    // The control: a manager listening on the editor's document alone does
    // not hear a key dispatched in the frame's.
    const frame = frameOf();
    const onSave = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameProvider frame={frame}>
          <SaveBinding onSave={onSave} />
        </CanvasFrameProvider>
      </ShortcutProvider>
    );
    pressSave(frame.contentDocument!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fires once under Strict Mode's replayed effects", () => {
    const frame = frameOf();
    const onSave = vi.fn();
    render(
      <React.StrictMode>
        <ShortcutProvider isApple={false}>
          <CanvasFrameProvider frame={frame}>
            <CanvasFrameShortcuts />
            <SaveBinding onSave={onSave} />
          </CanvasFrameProvider>
        </ShortcutProvider>
      </React.StrictMode>
    );
    pressSave(frame.contentDocument!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("fires once when two callers attach the same frame", () => {
    const frame = frameOf();
    const onSave = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameProvider frame={frame}>
          <CanvasFrameShortcuts />
          <CanvasFrameShortcuts />
          <SaveBinding onSave={onSave} />
        </CanvasFrameProvider>
      </ShortcutProvider>
    );
    pressSave(frame.contentDocument!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the frame listened on while one of two callers goes", () => {
    const frame = frameOf();
    const onSave = vi.fn();
    function Tree({ both }: { both: boolean }) {
      return (
        <ShortcutProvider isApple={false}>
          <CanvasFrameProvider frame={frame}>
            <CanvasFrameShortcuts />
            {both ? <CanvasFrameShortcuts /> : null}
            <SaveBinding onSave={onSave} />
          </CanvasFrameProvider>
        </ShortcutProvider>
      );
    }
    const { rerender } = render(<Tree both />);
    rerender(<Tree both={false} />);
    pressSave(frame.contentDocument!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("stops listening in the frame once it unmounts", () => {
    const frame = frameOf();
    const onSave = vi.fn();
    function Tree({ attached }: { attached: boolean }) {
      return (
        <ShortcutProvider isApple={false}>
          <CanvasFrameProvider frame={frame}>
            {attached ? <CanvasFrameShortcuts /> : null}
            <SaveBinding onSave={onSave} />
          </CanvasFrameProvider>
        </ShortcutProvider>
      );
    }
    const { rerender } = render(<Tree attached />);
    rerender(<Tree attached={false} />);
    pressSave(frame.contentDocument!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("adds no second listener while the canvas shares the editor's document", () => {
    // The manager already listens on the editor's document; attaching it there
    // again would run the save twice for one key.
    const onSave = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameShortcuts />
        <SaveBinding onSave={onSave} />
      </ShortcutProvider>
    );
    pressSave(document);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("a frame whose document is replaced", () => {
  /**
   * Replace the frame's document and wait for the frame's `load`.
   *
   * Taking the frame out of the page and putting it back is what makes jsdom
   * give it a NEW document, as a browser does for a reload or for the content
   * that follows a frame's first `about:blank`; setting `srcdoc` or writing
   * into the document keeps the same object there. Nothing here renders: the
   * provider has to learn of the replacement from the frame itself.
   */
  async function replaceDocument(frame: HTMLIFrameElement): Promise<void> {
    const loaded = new Promise<void>(resolve => {
      frame.addEventListener("load", () => resolve(), { once: true });
    });
    frame.remove();
    document.body.append(frame);
    await loaded;
  }

  it("answers with the new document and window once the frame has loaded it", async () => {
    const frame = frameOf();
    const before = frame.contentDocument;
    let seen: Document | null = null;
    function Probe(): null {
      seen = useCanvasFrame().document;
      return null;
    }
    render(
      <CanvasFrameProvider frame={frame}>
        <Probe />
      </CanvasFrameProvider>
    );
    expect(seen).toBe(before);

    await act(async () => {
      await replaceDocument(frame);
    });

    // As booleans: a failing `toBe` tries to print both documents, and the
    // printer cannot describe a frame's document, so the report would be a
    // crash in the printer rather than the comparison that failed.
    // The control: the frame really holds a different document now.
    expect(frame.contentDocument === before).toBe(false);
    expect(seen === frame.contentDocument).toBe(true);
  });

  it("never answers with a document the frame dropped while it was not provided", async () => {
    // The frame is handed in, taken away, reloads while away, and is handed
    // back. Read in a LAYOUT effect, which runs before the provider's own
    // effects can correct anything: whatever the committed render answers
    // there is what every layout-timed consumer attaches to.
    const frame = frameOf();
    const committed: (Document | null)[] = [];
    function Probe(): null {
      const { document: current } = useCanvasFrame();
      React.useLayoutEffect(() => {
        committed.push(current);
      });
      return null;
    }
    const { rerender } = render(
      <CanvasFrameProvider frame={frame}>
        <Probe />
      </CanvasFrameProvider>
    );
    rerender(
      <CanvasFrameProvider frame={null}>
        <Probe />
      </CanvasFrameProvider>
    );
    const before = frame.contentDocument;
    await act(async () => {
      await replaceDocument(frame);
    });
    expect(frame.contentDocument === before).toBe(false);
    committed.length = 0;

    rerender(
      <CanvasFrameProvider frame={frame}>
        <Probe />
      </CanvasFrameProvider>
    );

    expect(committed.length).toBeGreaterThan(0);
    expect(committed[0] === frame.contentDocument).toBe(true);
  });

  it("moves the editor's keys to the new document, and off the old one", async () => {
    const frame = frameOf();
    const before = frame.contentDocument;
    if (before === null) throw new Error("no frame document");
    const onSave = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameProvider frame={frame}>
          <CanvasFrameShortcuts />
          <SaveBinding onSave={onSave} />
        </CanvasFrameProvider>
      </ShortcutProvider>
    );

    await act(async () => {
      await replaceDocument(frame);
    });
    const after = frame.contentDocument;
    if (after === null || after === before) {
      throw new Error("the frame's document was not replaced");
    }

    pressSave(after);
    expect(onSave).toHaveBeenCalledTimes(1);
    // jsdom keeps the old document dispatchable, which is what makes a
    // listener left behind on it observable here.
    pressSave(before);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("when the frame's keys start working", () => {
  it("hears a key pressed in the same commit the frame first appears in", () => {
    // A layout effect below the attach presses Mod+S the moment the tree is
    // committed, before any passive effect has run. Attached in a passive
    // effect, the frame is not listened on yet and the keystroke is lost.
    const frame = frameOf();
    const found = frame.contentDocument;
    if (found === null) throw new Error("no frame document");
    const inner: Document = found;
    const onSave = vi.fn();
    function PressOnCommit(): null {
      React.useLayoutEffect(() => {
        pressSave(inner);
      }, []);
      return null;
    }
    render(
      <ShortcutProvider isApple={false}>
        <CanvasFrameProvider frame={frame}>
          <CanvasFrameShortcuts />
          <SaveBinding onSave={onSave} />
          <PressOnCommit />
        </CanvasFrameProvider>
      </ShortcutProvider>
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("the answer as React's development build describes it", () => {
  it("keeps the frame, its document and its window out of its own keys", () => {
    /*
     * A provider's value is described by walking its own enumerable keys, and
     * a window's own keys include every frame inside it: a page with an Embed
     * block holds one in an opaque origin, where the walk throws in the middle
     * of React's commit.
     */
    const frame = frameOf();
    const { result } = renderHook(() => useCanvasFrame(), {
      wrapper: framed(frame),
    });
    const keys = Object.keys(result.current);
    for (const hidden of ["frame", "document", "window"]) {
      expect(keys, hidden).not.toContain(hidden);
    }
    // The control: the values are still there to be read.
    expect(result.current.window).toBe(frame.contentWindow);
  });
});
