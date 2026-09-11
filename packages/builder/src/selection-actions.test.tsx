// @vitest-environment jsdom

/**
 * The one answer every pointer surface reads, and what happens without it.
 *
 * Both halves matter and only one of them is obvious. INSIDE a provider the
 * surfaces must read the same list — that is what stops them disagreeing, and
 * what stops the save preflight, which builds the document a save would store,
 * running once per surface on every edit. OUTSIDE one they must still track the
 * selection: written as a fallback memoised on the context alone, a surface
 * with no provider kept its FIRST answer for ever, and the suppression that
 * made that compile was hiding it.
 *
 * @module selection-actions.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { ShortcutProvider } from "@nextlyhq/ui";
import { render, renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { BlockKeyboardActions } from "./keyboard-actions";
import { useSelectionActions } from "./selection-actions";
import { toolbarActions, type ToolbarAction } from "./toolbar-actions";

function node(id: string): BlockNode {
  return { id, type: "acme/text", version: 1, props: {} } as BlockNode;
}

const document = {
  formatVersion: 1,
  kind: "page",
  nodes: [node("a"), node("b"), node("c")],
} as BlockDocument;

/** An editor over the three blocks, with `selectedId` as the primary. */
function editorFor(selectedId: string): EditorState {
  return {
    document,
    selectedId,
    selection: { ids: [selectedId], primary: selectedId },
    select: vi.fn(),
    apply: vi.fn(),
    applyAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  } as unknown as EditorState;
}

describe("a surface with no provider above it", () => {
  it("tracks the selection rather than keeping its first answer", () => {
    // The defect a suppressed dependency was hiding. `a` is first so it cannot
    // move up; `b` can — so an answer that never recomputed would report the
    // wrong availability for every selection after the first, and the refusal
    // reasons with it.
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSelectionActions(editorFor(id)),
      {
        initialProps: { id: "a" },
        wrapper: ({ children }) => (
          <ShortcutProvider>{children}</ShortcutProvider>
        ),
      }
    );
    const first = result.current.find(a => a.id === "move-up")?.enabled;

    rerender({ id: "b" });
    const second = result.current.find(a => a.id === "move-up")?.enabled;

    expect(first).toBe(false);
    expect(second).toBe(true);
  });
});

describe("two surfaces under one provider", () => {
  it("read the SAME array, rather than each building its own", () => {
    /*
     * Asserted by identity, which is the only thing that separates "shared"
     * from "computed the same way twice" — and computing it twice is the cost
     * this exists to remove, since the preflight behind the list clones the
     * selected forest and surveys it.
     *
     * TWO consumers in ONE provider, because a comparison across two providers
     * would prove only that separate subtrees get separate arrays, which is
     * true of a hook that shares nothing.
     */
    const editor = editorFor("a");
    const seen: ToolbarAction[][] = [];
    function Consumer(): null {
      seen.push(useSelectionActions(editor));
      return null;
    }

    render(
      <ShortcutProvider>
        <BlockKeyboardActions editor={editor} onSaveAsPattern={() => undefined}>
          <Consumer />
          <Consumer />
        </BlockKeyboardActions>
      </ShortcutProvider>
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]?.map(a => a.id)).toEqual(
      toolbarActions(document, "a", ["a"]).map(a => a.id)
    );
  });

  it("differs from what a surface OUTSIDE computes, in identity only", () => {
    // The control for the case above: an unprovided surface builds its own
    // array, so identity there is a different object with the same answer —
    // which is what makes identity a meaningful test of sharing rather than of
    // memoisation.
    const editor = editorFor("a");
    const outside = renderHook(() => useSelectionActions(editor), {
      wrapper: ({ children }) => (
        <ShortcutProvider>{children}</ShortcutProvider>
      ),
    });
    const inside = renderHook(() => useSelectionActions(editor), {
      wrapper: ({ children }) => (
        <ShortcutProvider>
          <BlockKeyboardActions
            editor={editor}
            onSaveAsPattern={() => undefined}
          >
            {children}
          </BlockKeyboardActions>
        </ShortcutProvider>
      ),
    });

    expect(outside.result.current).not.toBe(inside.result.current);
    expect(outside.result.current.map(a => a.id)).toEqual(
      inside.result.current.map(a => a.id)
    );
  });
});
