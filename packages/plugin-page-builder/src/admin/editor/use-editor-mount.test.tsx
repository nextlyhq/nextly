/**
 * @vitest-environment jsdom
 */

/**
 * Where the save-as-pattern form sends focus back to, when the author was
 * inside a canvas mounted in a same-origin iframe.
 *
 * From the host document, focus on a control inside the frame reads as the
 * iframe, and the control itself was built by the frame's window, so a check
 * made with this window's `HTMLElement` refuses it. Either way the form would
 * forget the control the author pressed and hand focus to a fallback.
 *
 * @module use-editor-mount.test
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { CanvasFrameProvider } from "@nextlyhq/builder/shell";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { partOfToastOptions, useSavePatternVerb } from "./use-editor-mount";

afterEach(() => {
  document.body.innerHTML = "";
});

const PAGE = { formatVersion: 1, kind: "page", nodes: [] } as BlockDocument;

describe("the save-as-pattern opener", () => {
  it("remembers a control focused inside a same-origin frame", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the iframe has no document");
    const origin = inner.createElement("button");
    inner.body.appendChild(origin);
    origin.focus();
    // The controls: this realm sees only the frame, and refuses the control.
    expect(document.activeElement).toBe(frame);
    expect(origin instanceof HTMLElement).toBe(false);

    const { result } = renderHook(() =>
      useSavePatternVerb(
        { document: PAGE },
        { commit: () => ({ status: "unchanged" }) }
      )
    );
    act(() => result.current.open());

    // The form did open, so the opener was read rather than skipped.
    expect(result.current.document).toBe(PAGE);
    // Identity as a boolean: a failing `toBe` cannot print another realm's node.
    expect(result.current.returnFocusTo() === origin).toBe(true);
  });
});

describe("where focus goes when the opener has gone", () => {
  it("goes back into the canvas's frame, found through the frame", () => {
    /*
     * The opener — a menu item, a palette row — has usually unmounted by the
     * time the form closes, so focus goes back to the canvas. In a frame the
     * canvas root is in the frame's document, where a search of the editor's
     * own finds nothing, and the frame is what takes focus into the page.
     */
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the iframe has no document");
    const root = inner.createElement("div");
    root.className = "nx-canvas";
    inner.body.appendChild(root);
    // The control: the editor's own document holds no canvas to find.
    expect(document.querySelector(".nx-canvas")).toBeNull();

    const { result } = renderHook(
      () =>
        useSavePatternVerb(
          { document: PAGE },
          { commit: () => ({ status: "unchanged" }) }
        ),
      {
        wrapper: ({ children }: { children?: React.ReactNode }) => (
          <CanvasFrameProvider frame={frame}>{children}</CanvasFrameProvider>
        ),
      }
    );
    // Opened from a menu item that has gone by the time the form closes.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    act(() => result.current.open());
    opener.remove();

    expect(result.current.returnFocusTo() === frame).toBe(true);
  });
});

describe("the toast after a double-click on a placement's own content", () => {
  const inspection = { componentId: "card", nodeId: "p1" };

  it("offers Edit component, opening that component from this placement", () => {
    const open = vi.fn();
    const options = partOfToastOptions(inspection, open);
    expect(options.action?.label).toBe("Edit component");
    options.action?.onClick();
    expect(open).toHaveBeenCalledWith("card", "p1");
  });

  it("offers nothing to an author who may not edit components", () => {
    expect(partOfToastOptions(inspection, undefined).action).toBeUndefined();
  });
});
