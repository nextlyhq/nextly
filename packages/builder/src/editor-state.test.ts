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

describe("applying several ops as one action", () => {
  /** Three top-level blocks, so a group can act on more than one of them. */
  function three() {
    return renderHook(() =>
      useEditorState({
        initialDocument: doc([node("a"), node("b"), node("c")]),
      })
    );
  }

  it("applies every op in the group", () => {
    const { result } = three();

    act(() => {
      result.current.applyAll([
        { kind: "remove", id: "a" },
        { kind: "remove", id: "c" },
      ]);
    });

    expect(ids(result.current.document)).toEqual(["b"]);
  });

  it("costs ONE undo, not one per op", () => {
    /*
     * The property the whole change exists for. "Delete these two" is one thing
     * an author did, and two presses to take it back reads as the history being
     * wrong rather than as a design.
     */
    const { result } = three();

    act(() => {
      result.current.applyAll([
        { kind: "remove", id: "a" },
        { kind: "remove", id: "c" },
      ]);
    });
    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.undo());

    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);
    expect(result.current.undoDepth).toBe(0);
  });

  it("redoes the whole group as one action too", () => {
    const { result } = three();

    act(() => {
      result.current.applyAll([
        { kind: "remove", id: "a" },
        { kind: "remove", id: "c" },
      ]);
    });
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(ids(result.current.document)).toEqual(["b"]);
    expect(result.current.undoDepth).toBe(1);
  });

  it("commits NOTHING when any op in the group is refused", () => {
    /*
     * Atomicity, and the case that separates a group from a loop of applies.
     * Removing four of six blocks because the fifth was refused leaves a
     * document the author never asked for and that no single undo can leave.
     */
    const { result } = three();

    let returned: unknown;
    act(() => {
      returned = result.current.applyAll([
        { kind: "remove", id: "a" },
        { kind: "remove", id: "does-not-exist" },
      ]);
    });

    expect(returned).toBeNull();
    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);
    // And no history either — a group that changed nothing must not be
    // undoable, or one press of undo would appear to do nothing.
    expect(result.current.undoDepth).toBe(0);
  });

  it("records nothing for an empty group", () => {
    /*
     * A delete with an empty selection. An entry here would be an undo that
     * appears to do nothing, which reads as the history being broken.
     *
     * Asserted by making a REAL edit afterwards, not by reading `undoDepth`
     * straight after the empty call. The empty case returns before the depth
     * is published, so a stack corrupted by it stays invisible until something
     * else republishes — which is exactly what a later edit does, and is how a
     * stub that pushed an empty entry passed this test in its first form.
     */
    const { result } = three();

    act(() => {
      result.current.applyAll([]);
    });
    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);

    act(() => {
      result.current.apply({ kind: "remove", id: "b" });
    });

    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.undo());

    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);
    expect(result.current.canUndo).toBe(false);
  });

  it("undoes a group in reverse, so each inverse meets the tree it expects", () => {
    /*
     * The ordering case. Two inserts at fixed indices only reverse correctly
     * when the LAST one is undone first — applied in collection order the first
     * inverse would meet a document the second insert had already shifted.
     */
    const { result } = three();

    act(() => {
      result.current.applyAll([
        { kind: "insert", node: node("x"), at: { index: 0 } },
        { kind: "insert", node: node("y"), at: { index: 2 } },
      ]);
    });
    expect(ids(result.current.document)).toEqual(["x", "a", "y", "b", "c"]);

    act(() => result.current.undo());

    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);
  });

  it("a single apply is still one undo, which is the control", () => {
    // Without this, "one entry per group" would pass against a store that had
    // stopped recording single edits at all.
    const { result } = three();

    act(() => {
      result.current.apply({ kind: "remove", id: "b" });
    });

    expect(result.current.undoDepth).toBe(1);
    expect(ids(result.current.document)).toEqual(["a", "c"]);
  });
});
