// @vitest-environment jsdom
/**
 * A shared style change undone and redone from the editor leaves the page's
 * own save state where it was: the style is stored as it changes, so its
 * step is no unsaved work on the page, before or after an undo.
 *
 * @module admin/editor/style-undo-save-state.test
 */
import { useEditorState } from "@nextlyhq/builder/shell";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { hasUnsavedWork } from "./use-host-commit";

const CLOSED = { editing: null, editingRich: null };

describe("a shared style step and the page's save state", () => {
  it("leaves a stored page stored while the step is undone and redone", async () => {
    const writes: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: { formatVersion: 1, kind: "page", nodes: [] },
      })
    );
    const dirty = () => hasUnsavedWork(result.current, CLOSED, 0);

    act(() =>
      result.current.recordStep({
        undo: async () => {
          writes.push("before");
          return true;
        },
        redo: async () => {
          writes.push("after");
          return true;
        },
      })
    );
    expect(dirty()).toBe(false);

    await act(async () => result.current.undo());
    expect(writes).toEqual(["before"]);
    expect(dirty()).toBe(false);

    await act(async () => result.current.redo());
    expect(writes).toEqual(["before", "after"]);
    expect(dirty()).toBe(false);
  });

  it("still counts a page edit made beside it as unsaved work", async () => {
    // The control: the save state does move for the page's own edits.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: { formatVersion: 1, kind: "page", nodes: [] },
      })
    );
    act(() =>
      result.current.recordStep({
        undo: async () => true,
        redo: async () => true,
      })
    );
    act(() => {
      result.current.apply({
        kind: "insert",
        node: { id: "a", type: "core/box", version: 1, props: {} },
        at: { index: 0 },
      });
    });
    expect(hasUnsavedWork(result.current, CLOSED, 0)).toBe(true);
  });
});
