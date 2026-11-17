// @vitest-environment jsdom
/**
 * A read of the saved entry, as the editor takes it in: a read that holds the
 * document already on screen is kept as the object the editor holds, so the
 * editor redraws nothing and walks the page no further; a read that differs
 * is taken once.
 *
 * The chain from the form to the editor is the editor's own: the field's
 * value and its stored copy pass through `useReadBack` into the real editor
 * state (`useEditorState`), with the real repair notice beside it, which
 * plans the page's repair, a walk of the whole page, whenever the editor
 * changes. What is counted is every redraw of what the editor draws and the
 * engine's whole-page walks.
 *
 * @module admin/editor/read-back.test
 */
import {
  documentWork,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  RepairNotice,
  useEditorState,
  type EditorState,
} from "@nextlyhq/builder/shell";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { memo, useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { sameJsonValue, useReadBack, type ReadBack } from "./read-back";
import { documentFrom } from "./stored-document";

function heading(id: string, text: string): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
  } as BlockNode;
}

/** A page long enough that a walk of it is a walk of many blocks. */
const OPENED: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: Array.from({ length: 40 }, (_, i) =>
    heading(`block-${String(i)}`, `Block ${String(i)}`)
  ),
} as BlockDocument;

/** The same data in a new object, as a reply parsed from the server is. */
const fromServer = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

afterEach(cleanup);

describe("sameJsonValue", () => {
  it("matches the same data in new objects, and a key left undefined", () => {
    expect(sameJsonValue(OPENED, fromServer(OPENED))).toBe(true);
    expect(sameJsonValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJsonValue([1, [2, { c: "x" }]], [1, [2, { c: "x" }]])).toBe(
      true
    );
  });

  it("tells apart a changed text, an extra key, a reordered list and a type", () => {
    const changed = fromServer(OPENED);
    (changed.nodes[39] as { props: { text: string } }).props.text = "Other";
    expect(sameJsonValue(OPENED, changed)).toBe(false);
    expect(sameJsonValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJsonValue({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(sameJsonValue([1, 2], [2, 1])).toBe(false);
    expect(sameJsonValue({ a: "1" }, { a: 1 })).toBe(false);
    expect(sameJsonValue([], {})).toBe(false);
    expect(sameJsonValue(null, {})).toBe(false);
  });
});

describe("useReadBack", () => {
  it("keeps the object held while the arriving values hold the same data", () => {
    const { result } = renderHook(() => useReadBack<unknown>(() => {}));
    expect(result.current.kept("stored", OPENED)).toBe(OPENED);
    expect(result.current.kept("stored", fromServer(OPENED))).toBe(OPENED);
    const other = { ...fromServer(OPENED), kind: "template" };
    expect(result.current.kept("stored", other)).toBe(other);
  });

  it("takes in the document it handed over as the object it handed", () => {
    const { result } = renderHook(() => useReadBack<unknown>(() => {}));
    result.current.kept("stored", OPENED);
    const edited = { ...OPENED, nodes: [heading("new", "New")] };
    result.current.handOver(edited);
    // The save's answer: the stored copy moves to what was handed, as that
    // very object.
    expect(result.current.kept("stored", fromServer(edited))).toBe(edited);
    // And the read after it, again.
    expect(result.current.kept("stored", fromServer(edited))).toBe(edited);
  });

  it("keeps the opening value and the stored copy apart", () => {
    const { result } = renderHook(() => useReadBack<unknown>(() => {}));
    const stored = { ...OPENED, nodes: [] };
    expect(result.current.kept("opened", OPENED)).toBe(OPENED);
    expect(result.current.kept("stored", stored)).toBe(stored);
    expect(result.current.kept("opened", fromServer(OPENED))).toBe(OPENED);
  });
});

/** Every draw of what the editor draws, counted. */
const draws = { editor: 0 };

/** Stands in for everything drawn from the editor: drawn when it changes. */
const Drawn = memo(function Drawn({ editor }: { editor: EditorState }) {
  draws.editor += 1;
  return <p data-testid="first">{editor.document.nodes.length}</p>;
});

let readBack: ReadBack<BlockDocument> | null = null;
let held: EditorState | null = null;

/** The form's side: the field's value and its stored copy, as the form holds them. */
function Host({
  opened,
  stored,
  steady,
}: {
  opened: unknown;
  stored: unknown;
  /** Off for the break run: the values reach the editor as they come. */
  steady: boolean;
}) {
  const own = useReadBack<BlockDocument>(() => {});
  readBack = own;
  const openedValue = steady ? own.kept("opened", opened) : opened;
  const storedValue = steady ? own.kept("stored", stored) : stored;
  const initialDocument = useMemo(
    () => documentFrom(openedValue),
    [openedValue]
  );
  const storedDocument = useMemo(
    () => documentFrom(storedValue),
    [storedValue]
  );
  const editor = useEditorState({ initialDocument, stored: storedDocument });
  held = editor;
  return (
    <>
      <RepairNotice editor={editor} />
      <Drawn editor={editor} />
    </>
  );
}

/** The editor's document after one edit, handed to the form as a save does. */
function editAndHand(): BlockDocument {
  if (held === null || readBack === null) throw new Error("not rendered");
  const editor = held;
  act(() => {
    editor.apply({
      kind: "insert",
      node: heading("added", "Added"),
      at: { index: 0 },
    });
  });
  const document = held.document;
  readBack.handOver(document);
  return document;
}

/** The work a rerender with these values costs. */
function costOf(rerender: () => void): { draws: number; walks: number } {
  const walksBefore = documentWork().walks;
  draws.editor = 0;
  rerender();
  return { draws: draws.editor, walks: documentWork().walks - walksBefore };
}

for (const steady of [true, false]) {
  describe(
    steady ? "a read of the saved entry" : "break run: values as they come",
    () => {
      it(
        steady
          ? "that matches what is shown draws nothing and walks nothing, after the save's own one move"
          : "draws and walks again for every read that matches",
        () => {
          const view = render(
            <Host opened={OPENED} stored={OPENED} steady={steady} />
          );
          const saved = editAndHand();
          // The form now holds what was handed, and its stored copy is the
          // save's answer: the stored copy moves once, to the saved document.
          const answer = fromServer(saved);
          const save = costOf(() =>
            view.rerender(
              <Host opened={saved} stored={answer} steady={steady} />
            )
          );
          expect(save.draws, "the save's own move").toBe(1);
          // The read of the entry after the save, and the save's answer taken in
          // again: the same document, each as a new object.
          const reads = costOf(() => {
            view.rerender(
              <Host
                opened={fromServer(saved)}
                stored={fromServer(saved)}
                steady={steady}
              />
            );
            view.rerender(
              <Host
                opened={fromServer(saved)}
                stored={fromServer(saved)}
                steady={steady}
              />
            );
          });
          if (steady) {
            expect(reads).toEqual({ draws: 0, walks: 0 });
          } else {
            // The control: the counters see the work a read costs when it is
            // taken as it comes.
            expect(reads.draws).toBe(2);
            expect(reads.walks).toBeGreaterThan(0);
          }
        }
      );
    }
  );
}

describe("a read of the saved entry that differs from what is shown", () => {
  it("is taken once", () => {
    const view = render(<Host opened={OPENED} stored={OPENED} steady />);
    const saved = editAndHand();
    view.rerender(<Host opened={saved} stored={fromServer(saved)} steady />);
    // Another author's save, read after this one.
    const theirs = fromServer(saved);
    (theirs.nodes[1] as { props: { text: string } }).props.text = "Theirs";
    const differs = costOf(() => {
      view.rerender(<Host opened={saved} stored={theirs} steady />);
      view.rerender(<Host opened={saved} stored={fromServer(theirs)} steady />);
    });
    expect(differs.draws).toBe(1);
    expect(differs.walks).toBeGreaterThan(0);
  });
});
