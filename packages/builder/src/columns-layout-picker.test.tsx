// @vitest-environment jsdom

/**
 * The Columns chooser on first add: its six tiles, in the Content tab's
 * names and order, a pick laying the row out in the insert's own step, Skip
 * and Escape keeping two equal columns, and the keyboard moving between
 * tiles without picking.
 *
 * @module columns-layout-picker.test
 */
import {
  clearBlocks,
  findNode,
  registerBlocks,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { COLUMNS_LAYOUTS } from "./columns-layout";
import { readStyleValue } from "./style-values";
import {
  COLUMNS_PICKER_WORDS,
  ColumnsLayoutPicker,
} from "./columns-layout-picker";
import { useEditorState, type EditorState } from "./editor-state";

beforeAll(() => {
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
    ] as never,
    { source: "columns-layout-picker-test" }
  );
});
afterAll(() => clearBlocks());
afterEach(cleanup);

function column(id: string): BlockNode {
  return {
    id,
    type: "core/column",
    version: 1,
    props: {},
    slots: { children: [] },
  };
}

const ROW: BlockNode = {
  id: "row",
  type: "core/columns",
  version: 1,
  props: {},
  slots: { children: [column("a"), column("b")] },
};

/** The editor after a Columns row was inserted and selected, and the picker. */
function Harness({
  onEditor,
}: {
  onEditor: (editor: EditorState) => void;
}): React.JSX.Element | null {
  const editor = useEditorState({
    initialDocument: { formatVersion: 1, kind: "page", nodes: [] },
  });
  onEditor(editor);
  // Once, as an insert is made once.
  const inserted = React.useRef(false);
  React.useEffect(() => {
    if (inserted.current) return;
    inserted.current = true;
    editor.apply({ kind: "insert", node: ROW, at: { index: 0 } });
    editor.select("row");
  }, [editor]);
  return editor.firstAdd === undefined ? null : (
    <ColumnsLayoutPicker editor={editor} firstAdd={editor.firstAdd} />
  );
}

function mount(): { editor: () => EditorState } {
  let latest: EditorState | undefined;
  render(<Harness onEditor={editor => (latest = editor)} />);
  return {
    editor: () => {
      if (latest === undefined) throw new Error("not rendered");
      return latest;
    },
  };
}

function columnsOf(editor: EditorState): number | undefined {
  return findNode(editor.document.nodes, "row")?.slots?.children?.length;
}

describe("the Columns layout picker", () => {
  it("offers the six layouts by name, in order, and Skip", () => {
    mount();
    expect(screen.getByText(COLUMNS_PICKER_WORDS.title)).toBeTruthy();
    const names = screen
      .getAllByRole("button")
      .map(button => button.textContent);
    expect(names).toEqual([
      "2 equal",
      "3 equal",
      "4 equal",
      "Wide left",
      "Wide right",
      "Wide middle",
      "Skip",
    ]);
    // The tiles are the Content tab's own list.
    expect(names.slice(0, 6)).toEqual(COLUMNS_LAYOUTS.map(l => l.label));
  });

  it("lays the row out as picked, in the insert's one step", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("button", { name: "3 equal" }));
    expect(columnsOf(editor())).toBe(3);
    expect(editor().firstAdd).toBeUndefined();
    expect(editor().undoDepth).toBe(1);
    expect(screen.queryByText(COLUMNS_PICKER_WORDS.title)).toBeNull();
    act(() => {
      editor().undo();
    });
    expect(findNode(editor().document.nodes, "row")).toBeUndefined();
  });

  it("writes the picked widths: Wide left is two to one", () => {
    const { editor } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Wide left" }));
    const row = findNode(editor().document.nodes, "row");
    expect(row?.slots?.children).toHaveLength(2);
    expect(
      readStyleValue(row?.styles, {
        state: "base",
        breakpoint: "base",
        property: "gridTemplateColumns",
        path: [],
      })
    ).toBe("2fr 1fr");
  });

  it("keeps two equal columns on Skip", () => {
    const { editor } = mount();
    const before = editor().document;
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(editor().firstAdd).toBeUndefined();
    expect(editor().document).toBe(before);
    expect(columnsOf(editor())).toBe(2);
  });

  it("keeps two equal columns on Escape, and keeps the row selected", () => {
    const { editor } = mount();
    const before = editor().document;
    fireEvent.keyDown(screen.getByRole("button", { name: "4 equal" }), {
      key: "Escape",
    });
    expect(editor().firstAdd).toBeUndefined();
    expect(editor().document).toBe(before);
    expect(editor().selectedId).toBe("row");
  });

  it("is one tab stop, the arrows moving between tiles without picking", () => {
    const { editor } = mount();
    const tiles = COLUMNS_LAYOUTS.map(layout =>
      screen.getByRole("button", { name: layout.label })
    );
    const at = (index: number): HTMLElement => {
      const tile = tiles[index];
      if (tile === undefined) throw new Error(`no tile ${String(index)}`);
      return tile;
    };
    expect(tiles.map(tile => tile.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    at(0).focus();
    fireEvent.keyDown(at(0), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tiles[1]);
    fireEvent.keyDown(at(1), { key: "End" });
    expect(document.activeElement).toBe(tiles[5]);
    fireEvent.keyDown(at(5), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tiles[0]);
    fireEvent.keyDown(at(0), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tiles[5]);
    expect(tiles.map(tile => tile.tabIndex)).toEqual([-1, -1, -1, -1, -1, 0]);
    // Moving picks nothing.
    expect(editor().firstAdd).toBeDefined();
    expect(columnsOf(editor())).toBe(2);
  });
});
