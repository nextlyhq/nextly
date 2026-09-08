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

describe("an empty group", () => {
  it("changes nothing and records nothing", () => {
    /*
     * One question — is there anything to record — answered in one place. An
     * entry for a group with no ops would undo to no visible effect, which is
     * the same refusal a group whose ops cancel out already gets.
     */
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    let returned: BlockDocument | null = null;
    act(() => {
      returned = result.current.applyAll([]);
    });

    expect(returned).not.toBeNull();
    expect(ids(result.current.document)).toEqual(["a"]);
    // The property: no history entry, so undo stays unavailable.
    expect(result.current.canUndo).toBe(false);
    expect(result.current.undoDepth).toBe(0);
  });

  it("judges no limit, because it judges no edit", () => {
    /*
     * The limits belong to the op that is applied, and an empty group applies
     * none — so nothing is measured against a cap that nothing is judged by.
     * `maxBytes: 0` is unusable rather than merely small (every cap is a `>`
     * comparison, so a limit below 1 decides nothing), and it still does not
     * turn "no edit" into a refusal.
     *
     * The same limits DO refuse a real edit, which is the control: without it
     * this would pass just as well on limits that were never consulted at all.
     */
    const limits = { maxDepth: 10, maxNodes: 10, maxBytes: 0 };
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]), limits })
    );

    let empty: BlockDocument | null = null;
    act(() => {
      empty = result.current.applyAll([]);
    });
    expect(empty).not.toBeNull();
    expect(result.current.undoDepth).toBe(0);

    let real: BlockDocument | null = null;
    act(() => {
      real = result.current.applyAll([
        { kind: "insert", node: node("b"), at: { index: 1 } },
      ]);
    });
    expect(real).toBeNull();
    expect(result.current.undoDepth).toBe(0);
  });
});

describe("a group of ONE", () => {
  /*
   * The property the style panel now depends on. Every style edit in the
   * builder goes through the batch layer, including the ordinary single-block
   * one, so that there is a single implementation of "what ops set this
   * address" rather than two that drift. That collapse is only safe if a group
   * of one is indistinguishable from the single-op call it replaced.
   *
   * Asserted rather than reasoned from the source. `apply` and `applyAll` do
   * read as the same `run(ops, "new")` today, and a claim about what another
   * function does is exactly the sentence no gate checks — so it is pinned
   * here, where a future divergence between the two fails instead of quietly
   * giving multi-selection different behaviour from a single click.
   */
  const insertB = {
    kind: "insert",
    node: node("b"),
    at: { index: 1 },
  } as const;

  it("moves the document exactly as the single-op call does", () => {
    const one = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    const grouped = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      one.result.current.apply(insertB);
    });
    act(() => {
      grouped.result.current.applyAll([insertB]);
    });

    // The DOCUMENT is the oracle, not the op that was handed over: two ways of
    // asking the store to do one thing have to leave the same tree behind.
    expect(ids(grouped.result.current.document)).toEqual(
      ids(one.result.current.document)
    );
    expect(ids(grouped.result.current.document)).toEqual(["a", "b"]);
  });

  it("costs exactly one undo step, and undoes in one press", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.applyAll([insertB]);
    });

    // One entry, not one per op — which is what would make a batch of six take
    // six presses to take back, and is the whole reason the group exists.
    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.undo());

    expect(ids(result.current.document)).toEqual(["a"]);
    expect(result.current.undoDepth).toBe(0);
  });

  it("refuses the whole group when its single op is refused", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    let returned: BlockDocument | null = null;
    act(() => {
      returned = result.current.applyAll([{ kind: "remove", id: "nobody" }]);
    });

    // Null rather than a document, and nothing recorded — the same answer
    // `apply` gives, so a caller cannot tell the two apart on the failure path
    // either.
    expect(returned).toBeNull();
    expect(ids(result.current.document)).toEqual(["a"]);
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

describe("an op applied from a closure the document has moved past", () => {
  /*
   * A panel that commits from an unmount cleanup calls the `apply` it captured
   * on its LAST render — the removed component never renders again, so its
   * closure predates the edit that removed it. Folding onto that render's
   * document made the op SUCCEED against a tree the node was still in, and the
   * commit wrote the whole stale document back: the deleted node returned and
   * every change since was lost.
   */
  it("refuses an update to a node a later edit removed", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("b")]) })
    );

    // Captured BEFORE the removal, exactly as an unmount cleanup holds it.
    const stale = result.current.apply;

    act(() => {
      result.current.apply({ kind: "remove", id: "a" });
    });
    expect(result.current.document.nodes.map(each => each.id)).toEqual(["b"]);

    let answered: unknown = "not called";
    act(() => {
      answered = stale({
        kind: "update",
        id: "a",
        patch: { cssId: "hero" },
      });
    });

    // Refused, because the node is gone from the document as it stands now.
    expect(answered).toBeNull();
    // And the removal still holds — the stale write did not resurrect it.
    expect(result.current.document.nodes.map(each => each.id)).toEqual(["b"]);
  });

  it("still applies a stale op to a node that is STILL there", () => {
    // The control: refusing every stale call would break the commit-on-unmount
    // path this exists to protect, which is the ordinary case.
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("b")]) })
    );
    const stale = result.current.apply;

    act(() => {
      result.current.apply({ kind: "remove", id: "b" });
    });
    act(() => {
      stale({ kind: "update", id: "a", patch: { cssId: "hero" } });
    });

    const nodes = result.current.document.nodes;
    expect(nodes.map(each => each.id)).toEqual(["a"]);
    expect((nodes[0] as BlockNode).cssId).toBe("hero");
  });
});

describe("two ops applied in one tick", () => {
  it("keeps both, rather than folding the second onto the first's input", () => {
    /*
     * `setDocument` does not take effect until the next render, so a second op
     * applied before that render must not read the document the first one
     * replaced — it would be folded onto a tree without the first edit and
     * write it back, silently discarding it.
     *
     * `applyAll` exists for a deliberate group; this is the accidental pair,
     * two handlers on one gesture, and it must not lose an edit either.
     */
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("b")]) })
    );

    act(() => {
      result.current.apply({ kind: "update", id: "a", patch: { cssId: "x" } });
      result.current.apply({ kind: "update", id: "b", patch: { cssId: "y" } });
    });

    const byId = new Map(
      result.current.document.nodes.map(each => [each.id, each])
    );
    expect(byId.get("a")?.cssId).toBe("x");
    expect(byId.get("b")?.cssId).toBe("y");
  });
});

describe("selecting what was just inserted", () => {
  it("lands in the same tick as the insert", () => {
    // `select` resolves the id against the document, so it can only work if
    // the insert is visible to it immediately rather than at the next render.
    // A mocked editor cannot observe this: it records the call and says
    // nothing about whether the selection took.
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    const fresh = node("brand-new");

    act(() => {
      result.current.apply({ kind: "insert", node: fresh, at: { index: 1 } });
      result.current.select(fresh.id);
    });

    // The insert landing is the control: without it this test would be
    // measuring a selection that was refused for the right reason.
    expect(ids(result.current.document)).toEqual(["a", "brand-new"]);
    expect(result.current.selectedId).toBe("brand-new");
  });
});
