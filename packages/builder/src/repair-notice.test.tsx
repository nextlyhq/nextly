// @vitest-environment jsdom

/**
 * The repair of a locked area, as an author meets it: a notice while the page
 * holds what a lock doesn't allow, the steps shown before anything changes,
 * and one confirmed edit that undo takes back.
 *
 * Driven through the real store, so the plan, the apply and the undo are the
 * ones the editor runs; a spy store would agree with any notice.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";

import {
  clearBlocks,
  DEFAULT_LIMITS,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { useEditorState, type EditorState } from "./editor-state";
import { RepairNotice } from "./repair-notice";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      { ...base, name: "acme/headline", editor: { label: "Headline" } },
      // May sit only in a row, so a repair has nowhere else to put one.
      { ...base, name: "acme/item", parent: ["acme/row"] },
      {
        ...base,
        name: "acme/titled",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "text" },
        },
      },
      {
        ...base,
        name: "acme/card",
        editor: { label: "Card" },
        slots: {
          body: {
            defaultBlock: [{ type: "acme/titled", props: { align: "left" } }],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/row",
        editor: { label: "Row" },
        slots: {
          items: { defaultBlock: [{ type: "acme/headline" }], lock: "all" },
        },
      },
    ] as never,
    { source: "lock-repair-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const headline = (id: string, locked?: boolean): BlockNode =>
  ({
    id,
    type: "acme/headline",
    version: 1,
    props: {},
    ...(locked === true ? { locked } : {}),
  }) as BlockNode;

/** A row holding the headline it starts with, and `extra` after it. */
function rowHolding(...extra: BlockNode[]): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "row",
        type: "acme/row",
        version: 1,
        props: {},
        slots: { items: [headline("kept"), ...extra] },
      },
    ],
  } as BlockDocument;
}

/** The notice over a real store, with the store handed back to the test. */
function mount(document: BlockDocument) {
  const seen: { editor?: EditorState } = {};
  function Host() {
    const editor = useEditorState({ initialDocument: document });
    seen.editor = editor;
    return <RepairNotice editor={editor} />;
  }
  render(<Host />);
  return () => seen.editor!;
}

const topLevel = (editor: EditorState) => editor.document.nodes.map(n => n.id);

describe("RepairNotice", () => {
  it("says nothing on a page every lock allows", () => {
    mount(rowHolding());
    expect(screen.queryByRole("region", { name: "Locked areas" })).toBeNull();
  });

  it("shows the steps before anything changes", () => {
    const editor = mount(rowHolding(headline("extra")));
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));

    expect(
      screen.getByText(
        "Move Headline out of Row's locked area, to just after Row."
      )
    ).toBeTruthy();
    expect(topLevel(editor())).toEqual(["row"]);
    expect(editor().undoDepth).toBe(0);
  });

  it("repairs as one edit, which undo takes back", () => {
    const editor = mount(rowHolding(headline("extra")));
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));

    expect(topLevel(editor())).toEqual(["row", "extra"]);
    expect(editor().undoDepth).toBe(1);
    expect(screen.queryByRole("region", { name: "Locked areas" })).toBeNull();

    act(() => editor().undo());
    expect(topLevel(editor())).toEqual(["row"]);
    expect(screen.getByRole("region", { name: "Locked areas" })).toBeTruthy();
  });

  it("applies a repair that adds a block the slot starts with", () => {
    // Each plan mints new ids for a block it adds, so the plan applied must
    // be the one shown, not one made again at the click.
    const editor = mount({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "acme/row",
          version: 1,
          props: {},
          slots: { items: [] },
        },
      ],
    } as unknown as BlockDocument);
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));

    expect(screen.queryByRole("alert")).toBeNull();
    const row = editor().document.nodes[0]!;
    expect(row.slots!.items!.map(node => node.type)).toEqual(["acme/headline"]);
    expect(editor().undoDepth).toBe(1);
  });

  it("changes nothing when the author cancels", () => {
    const editor = mount(rowHolding(headline("extra")));
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Repair" })).toBeNull();
    expect(topLevel(editor())).toEqual(["row"]);
  });

  it("says, before the author confirms, when some of the page can't be repaired", () => {
    const stuck = rowHolding({
      id: "item",
      type: "acme/item",
      version: 1,
      props: {},
    } as BlockNode).nodes[0]!;
    const other = {
      id: "row2",
      type: "acme/row",
      version: 1,
      props: {},
      slots: { items: [headline("kept2"), headline("extra")] },
    } as BlockNode;
    mount({
      formatVersion: 1,
      kind: "page",
      nodes: [stuck, other],
    } as BlockDocument);
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));

    expect(screen.getByText(/can’t be repaired here/)).toBeTruthy();
  });

  it("says which block to unlock when the repair must move a locked one, and changes nothing", () => {
    const editor = mount(rowHolding(headline("extra", true)));
    fireEvent.click(screen.getByRole("button", { name: "Review the repair" }));
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Headline is locked, and the repair moves it. Unlock it, then repair."
    );
    expect(topLevel(editor())).toEqual(["row"]);
    expect(editor().undoDepth).toBe(0);
  });
  it("warns, with nothing to confirm, when every break left is one it can't repair", () => {
    // The item may sit only in a row, so the plan has no step for it; the
    // page still breaks the lock, and the next save still refuses it.
    mount(
      rowHolding({
        id: "item",
        type: "acme/item",
        version: 1,
        props: {},
      } as BlockNode)
    );

    expect(screen.getByRole("region", { name: "Locked areas" })).toBeTruthy();
    expect(screen.getByText(/can’t be repaired here/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Review the repair" })
    ).toBeNull();
  });

  it("plans again when a save changes the baseline and not the page", () => {
    const card = (align: string): BlockDocument =>
      ({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "card",
            type: "acme/card",
            version: 1,
            props: {},
            slots: {
              body: [
                {
                  id: "t",
                  type: "acme/titled",
                  version: 1,
                  props: { align },
                },
              ],
            },
          },
        ],
      }) as BlockDocument;
    function Host({ stored }: { stored: BlockDocument }) {
      const editor = useEditorState({
        initialDocument: card("right"),
        stored,
      });
      return <RepairNotice editor={editor} />;
    }
    // Stored as it stands: the design it holds is the page's own, so kept.
    const { rerender } = render(<Host stored={card("right")} />);
    expect(screen.queryByRole("region", { name: "Locked areas" })).toBeNull();

    // A save stores the starting design, which the page no longer holds.
    rerender(<Host stored={card("left")} />);
    expect(screen.getByRole("region", { name: "Locked areas" })).toBeTruthy();
  });

  it("plans under the caps the editor applies edits under", () => {
    // The row is missing the headline it starts with. Adding it would pass
    // the editor's own node cap, so no repair the apply would refuse is
    // offered.
    const missing = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "row",
          type: "acme/row",
          version: 1,
          props: {},
          slots: { items: [] },
        },
      ],
    } as unknown as BlockDocument;
    const seen: { editor?: EditorState } = {};
    function Host() {
      seen.editor = useEditorState({
        initialDocument: missing,
        limits: { ...DEFAULT_LIMITS, maxNodes: 1 },
      });
      return null;
    }
    render(<Host />);

    expect(seen.editor!.planRepair().steps).toEqual([]);
  });
});
