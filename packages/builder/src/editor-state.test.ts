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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorState, MAX_HISTORY } from "./editor-state";
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  registerBlocks,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

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

describe("the caps an editor applies under", () => {
  it("says which caps it judges edits by, so a preflight can judge by the same ones", () => {
    // A surface that asks the resolver whether a placement fits has to ask
    // under the caps the apply will enforce, or the two disagree: a
    // preflight under the engine's defaults accepts what a raised-cap apply
    // accepts and refuses what it does not.
    const raised = { ...DEFAULT_LIMITS, maxNodes: DEFAULT_LIMITS.maxNodes + 1 };
    const configured = renderHook(() =>
      useEditorState({ initialDocument: doc([]), limits: raised })
    );
    const unconfigured = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );

    expect(configured.result.current.limits).toBe(raised);
    expect(unconfigured.result.current.limits).toBe(DEFAULT_LIMITS);
  });
});

describe("room for the components an edit places", () => {
  // Every surface reaches the document through this apply, so this is where
  // the resolver is asked whether the page still composes with the edit in:
  // an insert, a move, a duplicated group, a paste and a pattern all ask the
  // same question, and one that asked for itself would be one more that
  // could forget to. Refused, nothing is committed and the host is told why.
  const instance = (id: string): BlockNode => ({
    id,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId: "three" },
  });
  const three: BlockDocument = {
    formatVersion: 1,
    kind: "component",
    nodes: [node("d1"), node("d2"), node("d3")],
  } as BlockDocument;
  const definitions = new Map([["three", three]]);
  // Room for one instance of three on a page of one block, not two.
  const limits = { ...DEFAULT_LIMITS, maxNodes: 6 };

  it("refuses an insert the page has no room for, tells the host why, and commits nothing", () => {
    const onRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([node("p0"), instance("first")]),
        limits,
        definitions,
        onRefused,
      })
    );

    let outcome: BlockDocument | null = null;
    act(() => {
      outcome = result.current.apply({
        kind: "insert",
        node: instance("second"),
        at: { index: 2 },
      });
    });

    expect(outcome).toBeNull();
    expect(ids(result.current.document)).toEqual(["p0", "first"]);
    expect(result.current.undoDepth).toBe(0);
    expect(onRefused).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "budget" })
    );
    expect(onRefused.mock.calls[0]?.[0].sentence).toMatch(/no room left/);
  });

  it("refuses a move and a duplicated group by the same rule", () => {
    // Moving the second instance ahead of the first takes the budget the
    // first had; a group of ops is judged once, as the document it leaves.
    const onRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          node("p0"),
          instance("first"),
          instance("second"),
        ]),
        limits: { ...DEFAULT_LIMITS, maxNodes: 7 },
        definitions,
        onRefused,
      })
    );
    // Room for exactly what stands: the second is already a placeholder,
    // which is not this edit's doing — moving p0 is allowed.
    act(() => {
      expect(
        result.current.apply({ kind: "move", id: "p0", to: { index: 2 } })
      ).not.toBeNull();
    });
    expect(onRefused).not.toHaveBeenCalled();

    const fresh = renderHook(() =>
      useEditorState({
        initialDocument: doc([node("p0"), instance("first")]),
        limits,
        definitions,
        onRefused,
      })
    );
    act(() => {
      expect(
        fresh.result.current.applyAll([
          { kind: "insert", node: instance("copy"), at: { index: 2 } },
          { kind: "move", id: "copy", to: { index: 1 } },
        ])
      ).toBeNull();
    });
    expect(ids(fresh.result.current.document)).toEqual(["p0", "first"]);
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("never refuses an undo or a redo for room, even once the library has grown past the page", () => {
    // An accepted edit's inverse returns the page to a state that was
    // accepted; the room question is asked of fresh edits only, so a library
    // that grew or a cap that shrank between the two cannot strand history.
    // The library GROWS here between each edit and its replay — a definition
    // of three nodes becomes one of ten, which no longer fits — so a replay
    // that were asked would be refused.
    const grown = new Map([
      [
        "three",
        {
          ...three,
          nodes: Array.from({ length: 10 }, (_, i) => node(`g${String(i)}`)),
        } as BlockDocument,
      ],
    ]);
    const onRefused = vi.fn();
    const mountWith = (initialDocument: BlockDocument) =>
      renderHook(
        ({ lookup }: { lookup: Map<string, BlockDocument> }) =>
          useEditorState({
            initialDocument,
            limits,
            definitions: lookup,
            onRefused,
          }),
        { initialProps: { lookup: definitions } }
      );

    // A REDO that re-places the instance.
    const placed = mountWith(doc([node("p0")]));
    act(() => {
      placed.result.current.apply({
        kind: "insert",
        node: instance("first"),
        at: { index: 1 },
      });
    });
    act(() => {
      placed.result.current.undo();
    });
    placed.rerender({ lookup: grown });
    act(() => {
      placed.result.current.redo();
    });
    expect(ids(placed.result.current.document)).toEqual(["p0", "first"]);

    // An UNDO that puts a removed instance back.
    const removed = mountWith(doc([node("p0"), instance("first")]));
    act(() => {
      removed.result.current.apply({ kind: "remove", id: "first" });
    });
    removed.rerender({ lookup: grown });
    act(() => {
      removed.result.current.undo();
    });
    expect(ids(removed.result.current.document)).toEqual(["p0", "first"]);

    expect(onRefused).not.toHaveBeenCalled();
    // The control: the grown library DOES refuse the same placement as a
    // fresh edit, so the replays above were judged by the rule and spared.
    act(() => {
      removed.result.current.apply({
        kind: "insert",
        node: instance("second"),
        at: { index: 2 },
      });
    });
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a host that supplies no definitions", () => {
    // Nothing resolves, so nothing is standing that was not standing before;
    // the host that resolves nothing keeps the apply it had.
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("p0")]), limits })
    );
    act(() => {
      expect(
        result.current.apply({
          kind: "insert",
          node: instance("first"),
          at: { index: 1 },
        })
      ).not.toBeNull();
    });
    expect(ids(result.current.document)).toEqual(["p0", "first"]);
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

    // The most recent insert is what comes off first, and exactly the
    // bound's worth can be taken back: the five oldest stay. Counted by
    // undoing rather than by a depth, which measures the document's position
    // and keeps counting past the bound.
    act(() => result.current.undo());
    expect(ids(result.current.document)).not.toContain(`n${MAX_HISTORY + 4}`);
    act(() => {
      for (let i = 1; i < MAX_HISTORY; i += 1) result.current.undo();
    });
    expect(result.current.canUndo).toBe(false);
    expect(ids(result.current.document)).toEqual([
      "n0",
      "n1",
      "n2",
      "n3",
      "n4",
    ]);
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

describe("the locks an edit is held to", () => {
  // Every surface reaches the document through this apply, so the lock is
  // judged here exactly as a save judges it: an edit that adds a break is
  // refused and the host told why in the lock's words; an edit that leaves a
  // stored break as it was, or only changes content, applies.
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };

  beforeEach(() => {
    registerBlocks(
      [
        {
          ...base,
          name: "acme/headline",
          props: {
            text: { type: "text", role: "content" },
            align: { type: "select" },
          },
          defaultProps: { text: "Title", align: "left" },
        },
        {
          ...base,
          name: "acme/fixed-row",
          slots: {
            items: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
          },
        },
        {
          ...base,
          name: "acme/sealed-card",
          slots: {
            body: {
              defaultBlock: [{ type: "acme/headline" }],
              lock: "contentOnly",
            },
          },
        },
      ] as never,
      { source: "acme" }
    );
  });

  afterEach(() => {
    clearBlocks();
  });

  const headline = (id: string, align = "left"): BlockNode => ({
    id,
    type: "acme/headline",
    version: 1,
    props: { text: "Title", align },
  });
  const holding = (type: string, slot: string, children: BlockNode[]) => ({
    id: "holder",
    type,
    version: 1,
    props: {},
    slots: { [slot]: children },
  });

  it("asks its lock questions again when the host swaps the lock sources", () => {
    // A surface keyed on the store (the repair notice, the inserter's cache)
    // must not keep answers judged against the source the host replaced.
    const first = { get: () => undefined };
    const second = { get: () => undefined };
    // Opened once, as a host holds it: a new document is a new baseline.
    const opened = doc([headline("h")]);
    const { result, rerender } = renderHook(
      ({ definitions }) =>
        useEditorState({ initialDocument: opened, locks: { definitions } }),
      { initialProps: { definitions: first } }
    );
    const before = result.current;

    rerender({ definitions: first });
    expect(result.current.lockRefusalFor).toBe(before.lockRefusalFor);

    rerender({ definitions: second });
    expect(result.current.lockRefusalFor).not.toBe(before.lockRefusalFor);
    expect(result.current.planRepair).not.toBe(before.planRepair);
    expect(result.current).not.toBe(before);
  });

  it("refuses an insert into a slot locked all, tells the host why, and commits nothing", () => {
    const onLockRefused = vi.fn();
    // Room refusals keep their own callback and shape.
    const onRoom = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/fixed-row", "items", [headline("h1")]),
        ]),
        onRefused: onRoom,
        onLockRefused,
      })
    );

    let outcome: BlockDocument | null = null;
    act(() => {
      outcome = result.current.apply({
        kind: "insert",
        node: headline("h2"),
        at: { parentId: "holder", slot: "items", index: 1 },
      });
    });

    expect(outcome).toBeNull();
    expect(result.current.undoDepth).toBe(0);
    expect(onLockRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "locked",
        sentence:
          "This area of Fixed row is locked. Its blocks can't be added, removed or moved.",
      })
    );
    expect(onRoom).not.toHaveBeenCalled();
  });

  it("refuses a design change inside contentOnly and applies a content change", () => {
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/sealed-card", "body", [headline("h1")]),
        ]),
        onLockRefused,
      })
    );

    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "h1",
          patch: { props: { text: "Spring sale", align: "left" } },
        })
      ).not.toBeNull();
    });
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "h1",
          patch: { props: { text: "Spring sale", align: "right" } },
        })
      ).toBeNull();
    });
    expect(onLockRefused).toHaveBeenCalledTimes(1);
    expect(onLockRefused.mock.calls[0]?.[0].sentence).toMatch(
      /locked to its content/
    );
  });

  it("applies an edit that leaves a stored break as it was", () => {
    // Stored before locks were enforced: the row holds a headline more.
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/fixed-row", "items", [headline("h1"), headline("h2")]),
        ]),
        onLockRefused,
      })
    );
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "h1",
          patch: { props: { text: "Spring sale", align: "left" } },
        })
      ).not.toBeNull();
    });
    expect(onLockRefused).not.toHaveBeenCalled();
  });

  it("judges against the document as last SAVED, so a break a saved repair removed is refused again", () => {
    // Opened with the headline aligned right, against today's defaults. The
    // author puts it back as it starts and saves: the stored copy now holds
    // "left", so a save refuses "right" again, and the editor must agree.
    const opened = doc([
      holding("acme/sealed-card", "body", [headline("h1", "right")]),
    ]);
    const repaired = doc([
      holding("acme/sealed-card", "body", [headline("h1", "left")]),
    ]);
    const set = (align: string) => ({
      kind: "update" as const,
      id: "h1",
      patch: { props: { text: "Title", align } },
    });
    const { result, rerender } = renderHook(
      ({ stored }) => useEditorState({ initialDocument: opened, stored }),
      { initialProps: { stored: opened } }
    );

    act(() => {
      expect(result.current.apply(set("left"))).not.toBeNull();
    });
    // Not saved yet: the stored copy still holds "right", so it is allowed.
    act(() => {
      expect(result.current.apply(set("right"))).not.toBeNull();
    });
    act(() => {
      expect(result.current.apply(set("left"))).not.toBeNull();
    });
    // Saved: the stored copy is the repaired document.
    rerender({ stored: repaired });
    act(() => {
      expect(result.current.apply(set("right"))).toBeNull();
    });
  });

  it("answers ahead of time what apply would refuse, and applies nothing", () => {
    // The question a drop indicator, the inserter or a toolbar asks before an
    // action: the same answer apply then gives, with nothing committed.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/fixed-row", "items", [headline("h1")]),
          headline("loose"),
        ]),
      })
    );
    const insert = {
      kind: "insert" as const,
      node: headline("h2"),
      at: { parentId: "holder", slot: "items", index: 1 },
    };
    expect(result.current.lockRefusalFor([insert])).toEqual(
      expect.objectContaining({
        code: "locked-slot-altered",
        holderId: "holder",
      })
    );
    expect(result.current.undoDepth).toBe(0);
    expect(result.current.document.nodes[0]!.slots!.items).toHaveLength(1);
    // Allowed: moving a top-level headline ahead of the row, which no lock
    // holds. A real change, so "allowed" is an answer and not an empty edit.
    expect(
      result.current.lockRefusalFor([
        { kind: "move", id: "loose", to: { index: 0 } },
      ])
    ).toBeUndefined();
    act(() => {
      expect(result.current.apply(insert)).toBeNull();
    });
  });

  it("keeps a design value the document was opened with, after an edit in between", () => {
    // Opened with the headline aligned right. Putting it back as it started
    // and then back to "right" again returns to what the stored page holds.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/sealed-card", "body", [headline("h1", "right")]),
        ]),
      })
    );
    for (const align of ["left", "right"]) {
      act(() => {
        expect(
          result.current.apply({
            kind: "update",
            id: "h1",
            patch: { props: { text: "Title", align } },
          })
        ).not.toBeNull();
      });
    }
  });

  it("hands out the composed page, where a placement's content keeps its own id", () => {
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [holding("acme/fixed-row", "items", [headline("own")])],
      slots: { extra: { label: "Extra", nodeId: "holder", slot: "items" } },
    } as unknown as BlockDocument;
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo" },
            slots: { extra: [headline("given")] },
          } as BlockNode,
        ]),
        definitions: new Map([["promo", promo]]),
      })
    );
    const ids: string[] = [];
    const walk = (nodes: readonly BlockNode[]) => {
      for (const node of nodes) {
        ids.push(node.id);
        for (const children of Object.values(node.slots ?? {})) walk(children);
      }
    };
    walk(result.current.composed()?.nodes ?? []);

    // Inside the component's own row, beside the row's own headline.
    expect(ids).toContain("given");
    expect(ids).not.toContain("i1");
    // No library, nothing composed.
    const bare = renderHook(() =>
      useEditorState({ initialDocument: doc([headline("h")]) })
    );
    expect(bare.result.current.composed()).toBeUndefined();
  });

  it("refuses a placement's value on a block its component locks, naming the component", () => {
    // The component locks "Hero" in Layers and exposes its text; the page
    // cannot unlock it, so a value for it is refused before it is applied,
    // as the save would refuse it, and a value for the free block applies.
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        { ...headline("hero"), locked: true, name: "Hero" },
        headline("free"),
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "hero",
          propPath: "text",
          type: "text",
        },
        {
          id: "strap",
          label: "Strap",
          nodeId: "free",
          propPath: "text",
          type: "text",
        },
      ],
    } as unknown as BlockDocument;
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo" },
          } as BlockNode,
        ]),
        definitions: new Map([["promo", promo]]),
        componentName: id => (id === "promo" ? "Promo" : undefined),
        onLockRefused,
      })
    );
    const give = (overrides: Record<string, string>) => ({
      kind: "update" as const,
      id: "i1",
      patch: { props: { componentId: "promo", overrides } },
    });

    expect(result.current.lockRefusalFor([give({ title: "Changed" })])).toEqual(
      {
        code: "layers-locked",
        label: "Promo",
        relation: "component",
        verb: "change",
      }
    );
    act(() => {
      expect(result.current.apply(give({ title: "Changed" }))).toBeNull();
    });
    expect(onLockRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        sentence:
          "Set by the component Promo. Change it where the component is edited.",
      })
    );
    expect(
      result.current.lockRefusalFor([give({ strap: "Sale" })])
    ).toBeUndefined();
    act(() => {
      expect(result.current.apply(give({ strap: "Sale" }))).not.toBeNull();
    });
  });

  it("refuses an edit that hides a block its component locks, by a value or by a variant", () => {
    // Hidden, the block leaves no lock on the page after the edit; it is
    // judged against the page as its components hold it, where it is drawn.
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        { ...headline("hero"), locked: true, name: "Hero" },
        headline("free"),
      ],
      exposed: [
        {
          id: "heroShown",
          label: "Hero shown",
          nodeId: "hero",
          propPath: "visibility",
          type: "visibility",
        },
        {
          id: "freeShown",
          label: "Free shown",
          nodeId: "free",
          propPath: "visibility",
          type: "visibility",
        },
      ],
      variants: { quiet: { label: "Quiet", overrides: { heroShown: false } } },
    } as unknown as BlockDocument;
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo" },
          } as BlockNode,
        ]),
        definitions: new Map([["promo", promo]]),
        componentName: () => "Promo",
      })
    );
    const set = (props: Record<string, unknown>) => ({
      kind: "update" as const,
      id: "i1",
      patch: { props: { componentId: "promo", ...props } },
    });
    const refused = {
      code: "layers-locked",
      label: "Promo",
      relation: "component",
      verb: "change",
    };

    expect(
      result.current.lockRefusalFor([set({ overrides: { heroShown: false } })])
    ).toEqual(refused);
    expect(result.current.lockRefusalFor([set({ variant: "quiet" })])).toEqual(
      refused
    );
    // CONTROL: hiding the free block is the placement's to decide.
    expect(
      result.current.lockRefusalFor([set({ overrides: { freeShown: false } })])
    ).toBeUndefined();
  });

  /** A component locking "Hero" and exposing its text, and a free block's. */
  const lockingPromo = (heroText = "hero") =>
    ({
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          ...headline("hero"),
          props: { text: heroText, align: "left" },
          locked: true,
          name: "Hero",
        },
        headline("free"),
      ],
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "hero",
          propPath: "text",
          type: "text",
        },
        {
          id: "strap",
          label: "Strap",
          nodeId: "free",
          propPath: "text",
          type: "text",
        },
      ],
    }) as unknown as BlockDocument;

  it("refuses a value on a block locked by a component placed in another's slot", () => {
    // The promo is the page's own placement, inside the frame's exposed row:
    // the frame's baseline drops it with the row's content, so it is held at
    // a level of its own.
    const frame = {
      formatVersion: 1,
      kind: "component",
      nodes: [holding("acme/fixed-row", "items", [])],
      slots: { body: { label: "Body", nodeId: "holder", slot: "items" } },
    } as unknown as BlockDocument;
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "o1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "frame" },
            slots: {
              body: [
                {
                  id: "i1",
                  type: COMPONENT_INSTANCE_TYPE,
                  version: 1,
                  props: { componentId: "promo" },
                } as BlockNode,
              ],
            },
          } as BlockNode,
        ]),
        definitions: new Map([
          ["frame", frame],
          ["promo", lockingPromo()],
        ]),
        componentName: id => (id === "promo" ? "Promo" : "Frame"),
      })
    );
    const give = (overrides: Record<string, string>) => ({
      kind: "update" as const,
      id: "i1",
      patch: { props: { componentId: "promo", overrides } },
    });

    expect(result.current.lockRefusalFor([give({ title: "Changed" })])).toEqual(
      {
        code: "layers-locked",
        label: "Promo",
        relation: "component",
        verb: "change",
      }
    );
    // CONTROL: the free block's value is the placement's to give.
    expect(
      result.current.lockRefusalFor([give({ strap: "Sale" })])
    ).toBeUndefined();
  });

  it("refuses switching a placement to another component while keeping the first one's value", () => {
    // The copy's locked block shares the first one's id; the value the page
    // gave it was given under the first component's lock, not the copy's.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo", overrides: { strap: "Sale" } },
          } as BlockNode,
        ]),
        definitions: new Map([
          ["promo", lockingPromo()],
          ["copy", lockingPromo("Held by the copy")],
        ]),
        componentName: id => (id === "copy" ? "Promo copy" : "Promo"),
      })
    );
    const switchTo = (overrides: Record<string, string>) => ({
      kind: "update" as const,
      id: "i1",
      patch: { props: { componentId: "copy", overrides } },
    });

    expect(
      result.current.lockRefusalFor([switchTo({ title: "hero" })])
    ).toEqual({
      code: "layers-locked",
      label: "Promo copy",
      relation: "component",
      verb: "change",
    });
    // CONTROL: switched with no value for the locked block, it draws as the
    // copy holds it.
    expect(
      result.current.lockRefusalFor([switchTo({ strap: "Sale" })])
    ).toBeUndefined();
  });

  it("refuses content a placement gives a component's locked slot, judged on the composed page", () => {
    // The component exposes its own row, locked "all", for each placement to
    // fill. One headline is what the row starts with; a second is a block the
    // lock refuses, though the page alone shows only a placement holding two.
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [holding("acme/fixed-row", "items", [headline("own")])],
      slots: { extra: { label: "Extra", nodeId: "holder", slot: "items" } },
    } as unknown as BlockDocument;
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo" },
          } as BlockNode,
        ]),
        definitions: new Map([["promo", promo]]),
        onLockRefused,
      })
    );
    const give = (id: string) => ({
      kind: "insert" as const,
      node: headline(id),
      at: { parentId: "i1", slot: "extra", index: 0 },
    });

    act(() => {
      expect(result.current.apply(give("first"))).not.toBeNull();
    });
    expect(result.current.lockRefusalFor([give("second")])).toEqual(
      expect.objectContaining({ code: "locked-slot-altered", instanceId: "i1" })
    );
    act(() => {
      expect(result.current.apply(give("second"))).toBeNull();
    });
    expect(onLockRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        sentence:
          "This area of Fixed row is locked. Its blocks can't be added, removed or moved.",
      })
    );
  });

  it("allows an unrelated edit while a placement already breaks a component's lock", () => {
    // Stored before locks were enforced: the placement gives the component's
    // row two headlines. The editor refuses only a break an edit adds, so an
    // edit elsewhere on the page applies.
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [holding("acme/fixed-row", "items", [headline("own")])],
      slots: { extra: { label: "Extra", nodeId: "holder", slot: "items" } },
    } as unknown as BlockDocument;
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "promo" },
            slots: { extra: [headline("one"), headline("two")] },
          } as BlockNode,
          headline("loose"),
        ]),
        definitions: new Map([["promo", promo]]),
        onLockRefused,
      })
    );
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "loose",
          patch: { props: { text: "Spring sale", align: "left" } },
        })
      ).not.toBeNull();
    });
    expect(onLockRefused).not.toHaveBeenCalled();
  });

  it("composes each document once: an edit composes only the document it makes", () => {
    // The room check and the lock check both read the composed page. Each
    // composition is counted by the lookups it makes; one composition of the
    // edited page, measured on its own, is what an edit may cost once the
    // document before it and the saved one were composed.
    const promo = {
      formatVersion: 1,
      kind: "component",
      nodes: [holding("acme/fixed-row", "items", [headline("own")])],
      slots: { extra: { label: "Extra", nodeId: "holder", slot: "items" } },
    } as unknown as BlockDocument;
    const known = new Map([["promo", promo]]);
    let asked = 0;
    const counting = {
      has: (id: string) => (asked++, known.has(id)),
      get: (id: string) => (asked++, known.get(id)),
    };
    const page = doc([
      {
        id: "i1",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "promo" },
      } as BlockNode,
      headline("loose"),
    ]);
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page, definitions: counting })
    );
    const rename = (text: string) => ({
      kind: "update" as const,
      id: "loose",
      patch: { props: { text, align: "left" } },
    });
    act(() => {
      result.current.apply(rename("One"));
    });

    asked = 0;
    resolveComponentInstances(result.current.document, counting);
    const oneComposition = asked;
    expect(oneComposition).toBeGreaterThan(0);

    asked = 0;
    act(() => {
      expect(result.current.apply(rename("Two"))).not.toBeNull();
    });
    expect(asked).toBe(oneComposition);
  });

  it("plans the repair of a break the document holds, against the same baseline", () => {
    // The row holds a headline more, which the repair takes out to just after
    // the row.
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([
          holding("acme/fixed-row", "items", [headline("h1"), headline("h2")]),
        ]),
      })
    );

    const plan = result.current.planRepair();
    expect(plan.steps).toEqual([
      expect.objectContaining({ kind: "move", nodeId: "h2", after: "holder" }),
    ]);
    expect(plan.result.nodes.map(node => node.id)).toEqual(["holder", "h2"]);
    // Asked, not applied.
    expect(result.current.undoDepth).toBe(0);
  });

  it("plans nothing for a design value the saved page holds, which the save keeps", () => {
    // "Starting or stored": the save accepts a contentOnly value the stored
    // copy holds, so there is nothing to repair. Planned without the stored
    // copy, the same document would have its alignment put back.
    const opened = doc([
      holding("acme/sealed-card", "body", [headline("h1", "right")]),
    ]);
    const { result, rerender } = renderHook(
      ({ stored }) => useEditorState({ initialDocument: opened, stored }),
      { initialProps: { stored: opened } }
    );
    expect(result.current.planRepair().steps).toEqual([]);

    rerender({
      stored: doc([holding("acme/sealed-card", "body", [headline("h1")])]),
    });
    expect(result.current.planRepair().steps).toEqual([
      expect.objectContaining({ kind: "reset", nodeId: "h1" }),
    ]);
  });
});

describe("the placement rule on every edit", () => {
  const base = {
    version: 1,
    description: "A block.",
    example: { props: {} },
    render: () => null,
  };

  afterEach(() => {
    clearBlocks();
  });

  function registerLinkable(): void {
    registerBlocks(
      [
        {
          ...base,
          name: "t/card",
          slots: { children: {} },
          contentModel: (props: { link?: string }) =>
            props.link
              ? {
                  is: ["flow", "interactive"],
                  accepts: { without: ["interactive"] },
                }
              : { is: ["flow"] },
        },
        {
          ...base,
          name: "t/button",
          contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
        },
      ] as never,
      { source: "test" }
    );
  }

  const card = (
    props: Record<string, unknown>,
    children: BlockNode[] = []
  ): BlockNode => ({
    id: "card",
    type: "t/card",
    version: 1,
    props,
    slots: { children },
  });
  const button: BlockNode = {
    id: "btn",
    type: "t/button",
    version: 1,
    props: {},
  };

  it("refuses an insert that puts a Button inside a linked card, and says which", () => {
    registerLinkable();
    const onPlacementRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([card({ link: "/go" })]),
        onPlacementRefused,
      })
    );

    let outcome: BlockDocument | null = doc([]);
    act(() => {
      outcome = result.current.apply({
        kind: "insert",
        node: button,
        at: { parentId: "card", slot: "children", index: 0 },
      });
    });

    expect(outcome).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(onPlacementRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "btn",
        verdict: expect.objectContaining({ reason: "content-model" }),
      })
    );
  });

  it("refuses turning the link on while the card holds a Button", () => {
    registerLinkable();
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([card({}, [button])]) })
    );

    let outcome: BlockDocument | null = doc([]);
    act(() => {
      outcome = result.current.apply({
        kind: "update",
        id: "card",
        patch: { props: { link: "/go" } },
      });
    });

    expect(outcome).toBeNull();
  });

  it("lets an unrelated edit through on a page that already breaks the rule", () => {
    registerLinkable();
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([card({ link: "/go" }, [button])]),
      })
    );

    act(() => {
      result.current.apply({
        kind: "insert",
        node: node("after"),
        at: { index: 1 },
      });
    });

    expect(ids(result.current.document)).toEqual(["card", "after"]);
  });
});

/**
 * A change made outside the document, such as a shared style, recorded as one
 * step of the same history. Its two halves answer whether they took effect.
 */
function step(calls: string[], name: string, works = true) {
  return {
    undo: () => {
      calls.push(`undo ${name}`);
      return Promise.resolve(works);
    },
    redo: () => {
      calls.push(`redo ${name}`);
      return Promise.resolve(works);
    },
  };
}

describe("a step recorded from outside the document", () => {
  const insert = (id: string, index: number) =>
    ({ kind: "insert", node: node(id), at: { index } }) as const;

  it("is undone and redone as one step of the same history", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => result.current.recordStep(step(calls, "style")));
    expect(result.current.canUndo).toBe(true);

    await act(async () => result.current.undo());
    expect(calls).toEqual(["undo style"]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(async () => result.current.redo());
    expect(calls).toEqual(["undo style", "redo style"]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("takes its place among document edits, undone in the order they were made", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply(insert("b", 1));
    });
    act(() => result.current.recordStep(step(calls, "style")));
    act(() => {
      result.current.apply(insert("c", 2));
    });

    await act(async () => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a", "b"]);
    expect(calls).toEqual([]);

    await act(async () => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a", "b"]);
    expect(calls).toEqual(["undo style"]);

    await act(async () => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a"]);

    await act(async () => result.current.redo());
    await act(async () => result.current.redo());
    expect(calls).toEqual(["undo style", "redo style"]);
    expect(ids(result.current.document)).toEqual(["a", "b"]);
  });

  it("leaves the document's undo depth alone, so the page's save state does not move", async () => {
    // The depth is what the host compares with its save point. A style is
    // stored as it is changed, so its step is no unsaved work on the page.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply(insert("b", 1));
    });
    expect(result.current.undoDepth).toBe(1);

    act(() => result.current.recordStep(step(calls, "style")));
    expect(result.current.undoDepth).toBe(1);

    await act(async () => result.current.undo());
    expect(calls).toEqual(["undo style"]);
    expect(result.current.undoDepth).toBe(1);

    await act(async () => result.current.redo());
    expect(result.current.undoDepth).toBe(1);
  });

  it("ends the redo branch, as a new document edit does", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.recordStep(step(calls, "style")));
    expect(result.current.canRedo).toBe(false);
  });

  it("is dropped when it can no longer be taken back", async () => {
    // A refused write changed nothing: keeping the step would offer a redo
    // of a change that is still in place, and an undo that never clears.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );

    act(() => {
      result.current.apply(insert("b", 1));
    });
    act(() => result.current.recordStep(step(calls, "style", false)));

    await act(async () => result.current.undo());
    expect(calls).toEqual(["undo style"]);
    expect(result.current.canRedo).toBe(false);

    // The next undo reaches the edit before it.
    await act(async () => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a"]);
  });

  it("is dropped when its undo throws", async () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() =>
      result.current.recordStep({
        undo: () => Promise.reject(new Error("offline")),
        redo: () => Promise.resolve(true),
      })
    );
    await act(async () => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("keeps the page's save point where it was when style steps pass the bound", () => {
    // A page saved at depth 1 stays saved however many style steps follow,
    // though its edit falls off the old end of the history.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );
    act(() => {
      result.current.apply(insert("first", 0));
      for (let i = 0; i < MAX_HISTORY + 5; i += 1) {
        result.current.recordStep(step(calls, `s${i}`));
      }
    });
    expect(result.current.undoDepth).toBe(1);
  });

  it("drops the oldest entry at the bound, never the newest step", async () => {
    // A full history of page edits, then a style change: undo takes back the
    // style change first, as the author made it last.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );
    act(() => {
      for (let i = 0; i < MAX_HISTORY; i += 1) {
        result.current.apply(insert(`n${i}`, i));
      }
      result.current.recordStep(step(calls, "style"));
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(calls).toEqual(["undo style"]);
    expect(ids(result.current.document)).toHaveLength(MAX_HISTORY);
  });

  it("answers whether an undo or redo of a step took effect", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.recordStep(step(calls, "kept", true));
    });
    let undone: boolean | undefined;
    await act(async () => {
      undone = await result.current.undo();
    });
    expect(undone).toBe(true);
    act(() => {
      result.current.recordStep(step(calls, "refused", false));
    });
    await act(async () => {
      undone = await result.current.undo();
    });
    expect(undone).toBe(false);
  });

  it("gives back the redo branch it ended when withdrawn before anything follows it", async () => {
    // A held style change that came back to where it started changed
    // nothing, so the redo it cut off is the author's again.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    let withdraw: () => void = () => {};
    act(() => {
      withdraw = result.current.recordStep(step(calls, "back to start"));
    });
    expect(result.current.canRedo).toBe(false);
    act(() => withdraw());
    expect(result.current.canRedo).toBe(true);
    await act(async () => {
      await result.current.redo();
    });
    expect(ids(result.current.document)).toEqual(["a", "b"]);
    expect(calls).toEqual([]);
  });

  it("gives back the redo branch when a step undone before its change answered is withdrawn", async () => {
    // An earlier edit undone, a held style change recorded, and that change
    // undone before its save answers. The save is then refused, so the
    // change never took effect: the earlier Redo is still the author's.
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    let withdraw: () => void = () => {};
    let answer: (took: boolean) => void = () => {};
    act(() => {
      withdraw = result.current.recordStep({
        undo: () =>
          new Promise<boolean>(resolve => {
            answer = resolve;
          }),
        redo: () => Promise.resolve(true),
      });
    });
    let undoing: Promise<boolean> | boolean = false;
    act(() => {
      undoing = result.current.undo();
    });
    act(() => withdraw());
    await act(async () => {
      answer(false);
      await undoing;
    });
    expect(result.current.canRedo).toBe(true);
    await act(async () => {
      await result.current.redo();
    });
    expect(ids(result.current.document)).toEqual(["a", "b"]);
  });

  it("ends the redo branch for good once undoing the step took effect", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    let withdraw: () => void = () => {};
    act(() => {
      withdraw = result.current.recordStep(step(calls, "style"));
    });
    await act(async () => {
      await result.current.undo();
    });
    act(() => withdraw());
    expect(result.current.canRedo).toBe(false);
  });

  it("gives back the redo branch once every one of several unanswered steps is withdrawn", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    let first: () => void = () => {};
    let second: () => void = () => {};
    act(() => {
      first = result.current.recordStep(step(calls, "first"));
      second = result.current.recordStep(step(calls, "second"));
    });
    act(() => first());
    // One of them may still have taken effect: no redo yet.
    expect(result.current.canRedo).toBe(false);
    act(() => second());
    expect(result.current.canRedo).toBe(true);
    await act(async () => {
      await result.current.redo();
    });
    expect(ids(result.current.document)).toEqual(["a", "b"]);
  });

  it("keeps the redo branch ended when one of several unanswered steps stays", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    let second: () => void = () => {};
    act(() => {
      result.current.recordStep(step(calls, "first"));
      second = result.current.recordStep(step(calls, "second"));
    });
    act(() => second());
    expect(result.current.canRedo).toBe(false);
  });

  it("keeps the redo branch ended once another edit has followed it", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    await act(async () => {
      await result.current.undo();
    });
    let withdraw: () => void = () => {};
    act(() => {
      withdraw = result.current.recordStep(step(calls, "style"));
      result.current.apply(insert("c", 1));
    });
    act(() => withdraw());
    expect(result.current.canRedo).toBe(false);
  });

  it("is withdrawn wherever it sits, even after it was undone", async () => {
    // Undone while its save is still pending, then refused: no Redo may be
    // left for a change that was never stored.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    let withdraw: () => void = () => {};
    act(() => {
      withdraw = result.current.recordStep(step(calls, "pending"));
    });
    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    act(() => withdraw());
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it("gives back the entry it pushed off a full history when it is withdrawn", () => {
    // A refused change changed nothing, so it must not cost the oldest edit.
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([]) })
    );
    let withdraw: () => void = () => {};
    act(() => {
      for (let i = 0; i < MAX_HISTORY; i += 1) {
        result.current.apply(insert(`n${i}`, i));
      }
      withdraw = result.current.recordStep(step(calls, "refused"));
    });
    act(() => withdraw());
    expect(result.current.undoDepth).toBe(MAX_HISTORY);
    act(() => {
      for (let i = 0; i < MAX_HISTORY; i += 1) result.current.undo();
    });
    expect(ids(result.current.document)).toEqual([]);
  });

  it("can be withdrawn before it is replayed, as a refused save is", () => {
    const calls: string[] = [];
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a")]) })
    );
    act(() => {
      result.current.apply(insert("b", 1));
    });
    let withdraw: () => void = () => {};
    act(() => {
      withdraw = result.current.recordStep(step(calls, "style"));
    });
    act(() => withdraw());
    // The next undo reaches the page edit, and the step was never replayed.
    act(() => result.current.undo());
    expect(ids(result.current.document)).toEqual(["a"]);
    expect(calls).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });
});

describe("a block locked in Layers, asked and applied", () => {
  /** A locked section holding a heading, beside an unlocked block. */
  function lockedPage(): BlockDocument {
    return doc([
      { ...node("hero", { children: [node("title")] }), locked: true },
      node("loose"),
    ]);
  }

  it("answers ahead of time, in the lock's words, for every way into it", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: lockedPage() })
    );
    const ask = result.current.lockRefusalFor;
    // A block put into the locked one, a block inside it changed, and the
    // locked block itself moved: the store's question answers each, where it
    // answered nothing before because the op layer's refusal was swallowed.
    expect(
      ask([
        {
          kind: "move",
          id: "loose",
          to: { parentId: "hero", slot: "children", index: 0 },
        },
      ])
    ).toMatchObject({ code: "layers-locked", relation: "destination" });
    expect(
      ask([{ kind: "update", id: "title", patch: { name: "Big" } }])
    ).toMatchObject({ code: "layers-locked", relation: "around" });
    expect(ask([{ kind: "move", id: "hero", to: { index: 2 } }])).toMatchObject(
      { code: "layers-locked", relation: "self", verb: "move" }
    );
    // The control: an edit the lock does not cover is not refused for it.
    expect(
      ask([{ kind: "update", id: "loose", patch: { name: "Free" } }])
    ).toBeUndefined();
  });

  it("tells the host why when it refuses an edit the lock covers", () => {
    const onLockRefused = vi.fn();
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: lockedPage(), onLockRefused })
    );
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "title",
          patch: { name: "Big" },
        })
      ).toBeNull();
    });
    expect(onLockRefused).toHaveBeenCalledWith(
      expect.objectContaining({
        sentence:
          "This block is inside Box, which is locked. Unlock Box to change this block.",
      })
    );
  });

  it("refuses deleting a block the saved page still holds locked, until the unlock is saved", () => {
    // Unlocked in the editor and not yet saved: a save would refuse to drop a
    // block locked in what is stored, so the editor refuses the delete first,
    // with the way forward. Once the unlock is saved, the delete goes through.
    const opened = lockedPage();
    const onLockRefused = vi.fn();
    const { result, rerender } = renderHook(
      ({ stored }) =>
        useEditorState({ initialDocument: opened, stored, onLockRefused }),
      { initialProps: { stored: opened } }
    );
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "hero",
          patch: {},
          unset: ["locked"],
        })
      ).not.toBeNull();
    });
    expect(
      result.current.lockRefusalFor([{ kind: "remove", id: "hero" }])
    ).toMatchObject({ code: "layers-locked-when-saved", relation: "self" });
    act(() => {
      expect(result.current.apply({ kind: "remove", id: "hero" })).toBeNull();
    });
    expect(onLockRefused).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sentence:
          "Save first: this block is still locked on the saved page. Save, then delete it.",
      })
    );
    // A change to it, or a move, may ride in the same save as the unlock.
    act(() => {
      expect(
        result.current.apply({
          kind: "update",
          id: "title",
          patch: { name: "Big" },
        })
      ).not.toBeNull();
    });

    // Saved: the stored page now holds the unlock, so the delete is allowed.
    rerender({ stored: result.current.document });
    act(() => {
      expect(
        result.current.apply({ kind: "remove", id: "hero" })
      ).not.toBeNull();
    });
  });
});

describe("the lists the canvas shows empty", () => {
  it("names a list shown empty and forgets it again, as editor state outside the history", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("list")]) })
    );
    const none = result.current.listsShowingEmpty;
    expect(none?.size).toBe(0);
    act(() => result.current.showListEmpty?.("list", true));
    expect([...(result.current.listsShowingEmpty ?? [])]).toEqual(["list"]);
    expect(result.current.canUndo).toBe(false);
    // Asked again for what already holds, the set is the same one, so the
    // canvas, which draws per set, draws nothing again.
    const shown = result.current.listsShowingEmpty;
    act(() => result.current.showListEmpty?.("list", true));
    expect(result.current.listsShowingEmpty).toBe(shown);
    act(() => result.current.showListEmpty?.("list", false));
    expect(result.current.listsShowingEmpty?.size).toBe(0);
  });
});

describe("a list's sort, asked for from its canvas note", () => {
  it("selects the list and counts each ask, outside the history", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: doc([node("a"), node("list")]) })
    );
    expect(result.current.sortFieldAsked).toBeUndefined();
    act(() => result.current.askSortField?.("list"));
    expect(result.current.selectedId).toBe("list");
    expect(result.current.sortFieldAsked).toEqual({ id: "list", seq: 1 });
    // A second press asks again, though the list is already selected.
    act(() => result.current.askSortField?.("list"));
    expect(result.current.sortFieldAsked).toEqual({ id: "list", seq: 2 });
    expect(result.current.canUndo).toBe(false);
  });
});
