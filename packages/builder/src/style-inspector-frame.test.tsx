// @vitest-environment jsdom
/**
 * That the inspector asks its media queries of the window the canvas is in.
 *
 * A canvas rendered in a frame is as wide as the device it previews, and its
 * page's `@media` rules are evaluated against THAT window. The editor's window
 * is as wide as the admin, so asking it which breakpoints apply reports the
 * tiers of a screen nobody is previewing. Each case gives the two windows
 * separate recorders, so a query asked of the wrong one is seen as such.
 *
 * @module style-inspector-frame.test
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BreakpointSet } from "./breakpoints";
import { CanvasFrameProvider } from "./canvas-frame-context";
import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

const BREAKPOINTS = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
} as unknown as BreakpointSet;

const editor = {
  document: { formatVersion: 1, kind: "page", nodes: [] },
  selection: { ids: [] },
  selectedId: null,
  apply: () => null,
  undoDepth: 0,
  lockRefusalFor: () => undefined,
} as unknown as EditorState;

/** A `matchMedia` that records every query it is asked into `asked`. */
function recorder(asked: string[]) {
  return (query: string) => {
    asked.push(query);
    return {
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  };
}

let editorAsked: string[] = [];
let frameAsked: string[] = [];

beforeEach(() => {
  editorAsked = [];
  frameAsked = [];
  vi.stubGlobal("matchMedia", recorder(editorAsked));
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = "";
});

function frameWithMedia(): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const view = frame.contentWindow;
  if (view === null) throw new Error("no frame window");
  // The control: the frame's window is not the one the global names, so a
  // panel reading the global cannot reach this recorder.
  expect(view).not.toBe(window);
  Object.defineProperty(view, "matchMedia", { value: recorder(frameAsked) });
  return frame;
}

describe("which window the inspector asks", () => {
  it("asks the frame's window, and not the editor's, while the canvas is in a frame", () => {
    const frame = frameWithMedia();
    render(
      <CanvasFrameProvider frame={frame}>
        <StyleInspectorPanel editor={editor} breakpoints={BREAKPOINTS} />
      </CanvasFrameProvider>
    );

    expect(frameAsked.join(" ")).toContain("max-width: 991px");
    expect(frameAsked).toContain("(prefers-color-scheme: dark)");
    expect(editorAsked).toEqual([]);
  });

  it("asks the new window once the frame loads another document", async () => {
    // A frame replaces its document, and its window, when it loads: its first
    // `about:blank` gives way to its content. Taking it out of the page and
    // putting it back is what makes jsdom do the same.
    const frame = frameWithMedia();
    const reloadAsked: string[] = [];
    // Registered before the panel renders, so it runs before the provider's
    // own `load` listener and the new window can answer by then.
    const loaded = new Promise<void>(resolve => {
      frame.addEventListener(
        "load",
        () => {
          const view = frame.contentWindow;
          if (view !== null) {
            Object.defineProperty(view, "matchMedia", {
              value: recorder(reloadAsked),
            });
          }
          resolve();
        },
        { once: true }
      );
    });
    render(
      <CanvasFrameProvider frame={frame}>
        <StyleInspectorPanel editor={editor} breakpoints={BREAKPOINTS} />
      </CanvasFrameProvider>
    );
    expect(frameAsked.join(" ")).toContain("max-width: 991px");

    await act(async () => {
      frame.remove();
      document.body.append(frame);
      await loaded;
    });

    expect(reloadAsked.join(" ")).toContain("max-width: 991px");
    expect(reloadAsked).toContain("(prefers-color-scheme: dark)");
  });

  it("asks the editor's window while the canvas shares its document", () => {
    // The population for the case above: the panel does ask queries, and
    // without a frame it asks them where it always has.
    render(<StyleInspectorPanel editor={editor} breakpoints={BREAKPOINTS} />);

    expect(editorAsked.join(" ")).toContain("max-width: 991px");
    expect(editorAsked).toContain("(prefers-color-scheme: dark)");
  });
});
