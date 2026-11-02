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
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSavePatternVerb } from "./use-editor-mount";

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
