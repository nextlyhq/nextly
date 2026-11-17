// @vitest-environment jsdom

/**
 * The first-add step: a block that asks for a choice is held as "just added"
 * in editor state while its chooser shows, and the step ends on a pick, Skip,
 * Escape (a selection elsewhere), undo or any other edit. A pick joins the
 * insert's one undo step, and nothing of the step is written to the document.
 *
 * @module first-add.test
 */
import {
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planLayout } from "./columns-layout";
import { readStyleValue } from "./style-values";
import { useEditorState } from "./editor-state";
import { firstAddChooserOf } from "./first-add";
import { applyOps, type BuilderOp } from "./op-vocabulary";

beforeAll(() => {
  // The row and its column as the core pair declare them: a slot that admits
  // only the column, and equal columns that wrap by default.
  const block = (name: string, slot: Record<string, unknown>) => ({
    name,
    version: 1,
    description: name,
    example: { props: {} },
    editor: { label: name },
    props: {},
    defaultProps: {},
    slots: { children: slot },
    render: () => null,
  });
  registerBlocks(
    [
      {
        ...block("core/columns", { allow: ["core/column"] }),
        baseStyles: {
          base: {
            base: {
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
            },
          },
        },
      },
      block("core/column", {}),
      block("core/box", {}),
    ] as never,
    { source: "first-add-test" }
  );
});

afterAll(() => clearBlocks());

function column(id: string): BlockNode {
  return {
    id,
    type: "core/column",
    version: 1,
    props: {},
    slots: { children: [] },
  };
}

/** A Columns row as the inserter places one: two empty columns. */
function columns(id = "row"): BlockNode {
  return {
    id,
    type: "core/columns",
    version: 1,
    props: {},
    slots: { children: [column(`${id}-a`), column(`${id}-b`)] },
  };
}

function box(id: string): BlockNode {
  return { id, type: "core/box", version: 1, props: {}, slots: {} };
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

const START = doc([box("intro")]);

/** The editor, with a Columns row inserted and selected as the inserters do. */
function inserted(node: BlockNode = columns()) {
  const hook = renderHook(() => useEditorState({ initialDocument: START }));
  const op: BuilderOp = { kind: "insert", node, at: { index: 1 } };
  act(() => {
    hook.result.current.apply(op);
    hook.result.current.select(node.id);
  });
  return { ...hook, op };
}

function rowIn(document: BlockDocument): BlockNode | undefined {
  return findNode(document.nodes, "row");
}

describe("which blocks ask on first add", () => {
  it("names the Columns layout chooser for Columns, and none for others", () => {
    expect(firstAddChooserOf("core/columns")).toBe("columns-layout");
    expect(firstAddChooserOf("core/box")).toBeUndefined();
    // A name every object carries is not a block that asks.
    expect(firstAddChooserOf("constructor")).toBeUndefined();
  });
});

describe("the first-add step", () => {
  it("is set when a block that asks is inserted and selected", () => {
    const { result } = inserted();
    expect(result.current.firstAdd?.nodeId).toBe("row");
    expect(result.current.firstAdd?.chooser).toBe("columns-layout");
  });

  it("is not set for a block that asks for nothing", () => {
    const { result } = inserted(box("other"));
    expect(result.current.firstAdd).toBeUndefined();
  });

  it("is never written to the document", () => {
    const { result, op } = inserted();
    // The page is exactly what the insert alone makes.
    expect(result.current.document).toEqual(applyOps(START, [op]).document);
    expect(JSON.stringify(result.current.document)).not.toMatch(/first/i);
  });

  it("ends on Skip, keeping the block as added in one step", () => {
    const { result } = inserted();
    const before = result.current.document;
    act(() => result.current.firstAdd?.skip());
    expect(result.current.firstAdd).toBeUndefined();
    expect(result.current.document).toBe(before);
    expect(rowIn(result.current.document)?.slots?.children).toHaveLength(2);
    expect(result.current.undoDepth).toBe(1);
  });

  it("ends on a pick, which joins the insert's one undo step", () => {
    const { result } = inserted();
    const row = rowIn(result.current.document);
    if (row === undefined) throw new Error("row not inserted");
    const plan = planLayout(row, "3", { state: "base", breakpoint: "base" });
    if (!plan.ok) throw new Error(plan.reason);
    let landed = false;
    act(() => {
      landed = result.current.firstAdd?.choose(plan.ops) ?? false;
    });
    expect(landed).toBe(true);
    expect(result.current.firstAdd).toBeUndefined();
    expect(rowIn(result.current.document)?.slots?.children).toHaveLength(3);
    // Still selected, and one step: one undo takes the whole row away.
    expect(result.current.selectedId).toBe("row");
    expect(result.current.undoDepth).toBe(1);
    act(() => {
      result.current.undo();
    });
    expect(rowIn(result.current.document)).toBeUndefined();
    expect(result.current.document.nodes.map(n => n.id)).toEqual(["intro"]);
  });

  it("a pick writes its layout's widths, not only its count", () => {
    const { result } = inserted();
    const row = rowIn(result.current.document);
    if (row === undefined) throw new Error("row not inserted");
    const plan = planLayout(row, "wide-left", {
      state: "base",
      breakpoint: "base",
    });
    if (!plan.ok) throw new Error(plan.reason);
    act(() => {
      result.current.firstAdd?.choose(plan.ops);
    });
    const laid = rowIn(result.current.document);
    expect(laid?.slots?.children).toHaveLength(2);
    expect(
      readStyleValue(laid?.styles, {
        state: "base",
        breakpoint: "base",
        property: "gridTemplateColumns",
        path: [],
      })
    ).toBe("2fr 1fr");
    expect(result.current.undoDepth).toBe(1);
  });

  it("stands when a group edit is refused, as it does for one op", () => {
    const { result } = inserted();
    act(() => {
      result.current.applyAll([{ kind: "remove", id: "ghost" }]);
    });
    expect(result.current.firstAdd?.nodeId).toBe("row");
  });

  it("ends on undo, and a redo does not bring it back", () => {
    const { result } = inserted();
    const held = result.current.firstAdd;
    let landed = true;
    act(() => {
      result.current.undo();
      // A pick in the same tick finds nothing to join: the insert is undone.
      landed = held?.choose([]) ?? true;
    });
    expect(landed).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.firstAdd).toBeUndefined();
    expect(rowIn(result.current.document)).toBeUndefined();
    act(() => {
      result.current.redo();
      result.current.select("row");
    });
    expect(rowIn(result.current.document)).toBeDefined();
    expect(result.current.firstAdd).toBeUndefined();
  });

  it("ends when the selection moves away (Escape, a click elsewhere)", () => {
    const { result } = inserted();
    act(() => result.current.select(null));
    expect(result.current.firstAdd).toBeUndefined();
    // Selecting the row again later does not bring the chooser back.
    act(() => result.current.select("row"));
    expect(result.current.firstAdd).toBeUndefined();
    expect(rowIn(result.current.document)?.slots?.children).toHaveLength(2);
  });

  it("ends on any other edit, and a pick held from before changes nothing", () => {
    const { result } = inserted();
    const held = result.current.firstAdd;
    const row = rowIn(result.current.document);
    if (held === undefined || row === undefined) throw new Error("no step");
    const plan = planLayout(row, "4", { state: "base", breakpoint: "base" });
    if (!plan.ok) throw new Error(plan.reason);
    let landed = true;
    // In one tick, before the page is drawn again: the edit itself ends it,
    // so the pick cannot take the edit back in place of the insert.
    act(() => {
      result.current.apply({
        kind: "update",
        id: "intro",
        patch: { props: { a: 1 } },
      });
      landed = held.choose(plan.ops);
    });
    expect(result.current.firstAdd).toBeUndefined();
    // The other edit is not taken back, and the row is as it was added.
    expect(landed).toBe(false);
    expect(findNode(result.current.document.nodes, "intro")?.props).toEqual({
      a: 1,
    });
    expect(rowIn(result.current.document)?.slots?.children).toHaveLength(2);
    expect(result.current.undoDepth).toBe(2);
  });

  it("ends when a step is recorded outside the page", () => {
    const { result } = inserted();
    act(() => {
      result.current.recordStep({
        undo: () => Promise.resolve(true),
        redo: () => Promise.resolve(true),
      });
    });
    expect(result.current.firstAdd).toBeUndefined();
  });
});
