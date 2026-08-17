// @vitest-environment jsdom

/**
 * What the editor state guarantees beyond what the op layer already does.
 *
 * `applyOp` is tested in `ops.test.ts`; nothing here re-asserts that an insert
 * inserts. What is only true HERE is the bookkeeping around it: that history is
 * built from the op layer's own inverses, that a new edit invalidates the redo
 * branch, that a refused op changes nothing at all, and that a selection cannot
 * outlive the node it names.
 *
 * @module editor-state.test
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEditorState, MAX_HISTORY } from "./editor-state";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(slots ? { slots } : {}),
  };
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function ids(d: BlockDocument): string[] {
  return d.nodes.map(n => n.id);
}

describe("applying edits", () => {
  it("moves the document forward and records an undo step", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    expect(result.current.canUndo).toBe(false);

    act(() => {
      result.current.apply({
        kind: "insert",
        node: node("b"),
        at: { index: 1 },
      });
    });

    expect(ids(result.current.document)).toEqual(["a", "b"]);
    // The flag must be STATE, not a ref read: a ref mutation schedules no
    // render, so an undo control would stay disabled after a real edit.
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoDepth).toBe(1);
  });

  it("returns null and changes NOTHING when the op is refused", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    let outcome: BlockDocument | null = doc([]);
    act(() => {
      // Removing a node that is not there.
      outcome = result.current.apply({ kind: "remove", id: "ghost" });
    });

    expect(outcome).toBeNull();
    expect(ids(result.current.document)).toEqual(["a"]);
    // The part worth pinning: a refused op must not leave a history step, or
    // undo replays an edit that never happened.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.undoDepth).toBe(0);
  });
});

describe("undo and redo", () => {
  it("takes an edit back and puts it forward again", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply({
        kind: "insert",
        node: node("b"),
        at: { index: 1 },
      });
    });
    expect(ids(result.current.document)).toEqual(["a", "b"]);

    act(() => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a"]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(ids(result.current.document)).toEqual(["a", "b"]);
    expect(result.current.canUndo).toBe(true);
  });

  it("INVALIDATES the redo branch when a new edit arrives", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply({
        kind: "insert",
        node: node("b"),
        at: { index: 1 },
      });
    });
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.apply({
        kind: "insert",
        node: node("c"),
        at: { index: 1 },
      });
    });

    // Those inverses were computed against a document that no longer exists.
    // Replaying one would apply an edit derived from a tree that has changed
    // underneath it.
    expect(result.current.canRedo).toBe(false);
    expect(ids(result.current.document)).toEqual(["a", "c"]);
  });

  it("bounds history from the OLD end, keeping the most recent edits", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );

    act(() => {
      for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
        result.current.apply({
          kind: "insert",
          node: node(`n${i}`),
          at: { index: i },
        });
      }
    });

    // Asserted as the CAP, not merely "some number": a stack that dropped the
    // newest instead would also stay bounded, and would make the last edit the
    // one an author cannot take back.
    expect(result.current.undoDepth).toBe(MAX_HISTORY);
    act(() => result.current.undo());
    // The most recent insert is what comes off first.
    expect(ids(result.current.document)).not.toContain(`n${MAX_HISTORY + 4}`);
  });
});

describe("selection", () => {
  it("clears when the selected node is removed", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("b")]) })
    );

    act(() => result.current.select("b"));
    expect(result.current.selectedId).toBe("b");

    act(() => {
      result.current.apply({ kind: "remove", id: "b" });
    });

    // A selection outliving its node leaves every panel describing something
    // the author cannot see.
    expect(result.current.selectedId).toBeNull();
  });

  it("clears when the selected node is removed as part of a SUBTREE", () => {
    // The case an op-inspecting implementation gets wrong: the op names the
    // container, and the child disappears without being mentioned.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([node("parent", { default: [node("child")] })]),
      })
    );

    act(() => result.current.select("child"));
    expect(result.current.selectedId).toBe("child");

    act(() => {
      result.current.apply({ kind: "remove", id: "parent" });
    });

    expect(result.current.selectedId).toBeNull();
  });

  it("SURVIVES an edit that leaves the selected node in place", () => {
    // The control for the two above. A rule that cleared the selection on every
    // edit would pass both of them and be useless, so this pins the other side.
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("b")]) })
    );

    act(() => result.current.select("a"));
    act(() => {
      result.current.apply({ kind: "remove", id: "b" });
    });

    expect(result.current.selectedId).toBe("a");
  });
});
