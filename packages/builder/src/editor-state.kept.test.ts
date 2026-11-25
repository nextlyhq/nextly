// @vitest-environment jsdom

/**
 * An editor's history kept across a remount of the same document.
 *
 * A host that unmounts its editor for a while (the Page Builder draws a
 * read-only page while the document's lock is lost) hands a later mount what
 * the earlier one kept, and the later one carries on with the same undo and
 * redo. Only onto the very document the history was built against: its
 * inverses describe that document, and replayed onto any other they would
 * put back content nobody on screen is looking at.
 *
 * @module editor-state.kept.test
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { startsFromKept, type KeptEditorState } from "./editor-keeping";
import { useEditorState, type UseEditorStateArgs } from "./editor-state";

function node(id: string): BlockNode {
  return { id, type: "core/box", version: 1, props: {} };
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function ids(d: BlockDocument): string[] {
  return d.nodes.map(n => n.id);
}

const insert = (id: string, index: number) =>
  ({ kind: "insert", node: node(id), at: { index } }) as const;

/** Mounts an editor, and answers what it kept once it is unmounted. */
function mountKeeping(args: Omit<UseEditorStateArgs, "keeping">) {
  let kept: KeptEditorState | undefined;
  const view = renderHook(() =>
    useEditorState({ ...args, keeping: { keep: state => (kept = state) } })
  );
  return {
    result: view.result,
    unmount: (): KeptEditorState | undefined => {
      view.unmount();
      return kept;
    },
  };
}

/** The document as the host's form hands it back: a copy, not the object. */
function copyOf(d: BlockDocument): BlockDocument {
  return JSON.parse(JSON.stringify(d)) as BlockDocument;
}

describe("an editor mounted again on the document it left", () => {
  it("undoes and redoes what the earlier mount did, with its selection", () => {
    const first = mountKeeping({ initialDocument: doc([node("a")]) });
    act(() => {
      first.result.current.apply(insert("b", 1));
    });
    act(() => {
      first.result.current.apply(insert("c", 2));
    });
    act(() => {
      first.result.current.undo();
    });
    act(() => first.result.current.select("b"));
    const left = first.result.current.document;
    const kept = first.unmount();

    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: copyOf(left),
        keeping: { kept, keep: () => {} },
      })
    );

    expect(ids(result.current.document)).toEqual(["a", "b"]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.undoDepth).toBe(1);
    expect(result.current.selectedId).toBe("b");

    act(() => {
      result.current.undo();
    });
    expect(ids(result.current.document)).toEqual(["a"]);
    act(() => {
      result.current.redo();
    });
    act(() => {
      result.current.redo();
    });
    expect(ids(result.current.document)).toEqual(["a", "b", "c"]);
  });

  it("matches the document by value, whatever order its keys arrive in", () => {
    const first = mountKeeping({ initialDocument: doc([node("a")]) });
    act(() => {
      first.result.current.apply(insert("b", 1));
    });
    const kept = first.unmount();
    const reordered = {
      nodes: [
        { props: {}, version: 1, type: "core/box", id: "a" },
        { props: {}, version: 1, type: "core/box", id: "b" },
      ],
      kind: "page",
      formatVersion: 1,
    } as BlockDocument;

    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: reordered,
        keeping: { kept, keep: () => {} },
      })
    );

    expect(result.current.canUndo).toBe(true);
  });

  it("starts fresh when it opens on any other document", () => {
    // Someone else's change loaded while the editor was away: the history
    // was built against the page before it, and an undo would put that back.
    const first = mountKeeping({ initialDocument: doc([node("a")]) });
    act(() => {
      first.result.current.apply(insert("b", 1));
    });
    act(() => first.result.current.select("b"));
    const kept = first.unmount();
    const theirs = doc([node("a"), node("x")]);

    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: theirs,
        keeping: { kept, keep: () => {} },
      })
    );

    expect(result.current.document).toBe(theirs);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoDepth).toBe(0);
    expect(result.current.selectedId).toBeNull();
    expect(startsFromKept(kept, theirs)).toBe(false);
  });

  it("keeps the document's edits and not a step recorded from outside it", async () => {
    // A step changes something beside the page (the site's shared styles),
    // which may have moved meanwhile; only the page's own edits are kept.
    const calls: string[] = [];
    const first = mountKeeping({ initialDocument: doc([node("a")]) });
    act(() => {
      first.result.current.apply(insert("b", 1));
    });
    act(() => {
      first.result.current.recordStep({
        undo: () => (calls.push("undo style"), Promise.resolve(true)),
        redo: () => (calls.push("redo style"), Promise.resolve(true)),
      });
    });
    const left = first.result.current.document;
    const kept = first.unmount();

    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: copyOf(left),
        keeping: { kept, keep: () => {} },
      })
    );
    expect(startsFromKept(kept, copyOf(left))).toBe(true);
    expect(result.current.undoDepth).toBe(1);

    await act(async () => {
      await result.current.undo();
    });
    expect(ids(result.current.document)).toEqual(["a"]);
    expect(calls).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });

  it("starts fresh with nothing kept, as before", () => {
    const { result } = renderHook(() =>
      useEditorState({
        initialDocument: doc([node("a")]),
        keeping: { kept: undefined, keep: () => {} },
      })
    );

    expect(result.current.canUndo).toBe(false);
    expect(startsFromKept(undefined, doc([node("a")]))).toBe(false);
  });
});
