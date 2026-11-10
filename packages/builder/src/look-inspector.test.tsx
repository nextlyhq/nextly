// @vitest-environment jsdom

import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { SharedStyleChange } from "./shared-style-target";
import type { SharedStylesHost } from "./style-target";

/*
 * The inspector while a look is edited on its own, from the Design panel:
 * no block selected, the look's bar, and the Style controls writing the look.
 */

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: {},
        supports: { effects: true },
        render: () => null,
      },
    ] as never,
    { source: "look-inspector-test" }
  );
});
afterAll(clearBlocks);
afterEach(cleanup);

const own: NamedClass = {
  id: "look:acme/box:plain",
  slug: "box-plain",
  label: "Plain",
  orderIndex: 0,
  blockType: "acme/box",
  isDefault: true,
  styles: {},
};
const raised: NamedClass = {
  id: "look:acme/box:raised",
  slug: "box-raised",
  label: "Raised",
  orderIndex: 1,
  blockType: "acme/box",
  styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.5 } } } as NodeStyles,
};

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/box", version: 1, props: {} }],
} as unknown as BlockDocument;

function editorFor(selectedId: string | null): EditorState & {
  applyAll: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
} {
  return {
    document: page,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    applyAll: vi.fn(() => page),
    select: vi.fn(),
    apply: vi.fn(() => page),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & {
    applyAll: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
  };
}

function mount(lookId: string, selectedId: string | null = null) {
  const editor = editorFor(selectedId);
  const writeStyles = vi.fn(
    async (_id: string, _change: SharedStyleChange) =>
      undefined as string | undefined
  );
  const onExit = vi.fn();
  render(
    <InspectorPanel
      editor={editor}
      classLibrary={[own, raised]}
      sharedStyles={{
        mayChange: true,
        writeStyles: writeStyles as unknown as SharedStylesHost["writeStyles"],
      }}
      lookEditing={{ look: { id: lookId, blockType: "acme/box" }, onExit }}
    />
  );
  return { editor, writeStyles, onExit };
}

/** Set the Opacity field, under Effects, and leave it. */
function setOpacity(percent: string): void {
  // Open unless it already is, as it is when the look sets a value there.
  const effects = screen.getByRole("button", { name: /^Effects/ });
  if (effects.getAttribute("aria-expanded") !== "true")
    fireEvent.click(effects);
  const field = screen.getByRole("textbox", { name: "Opacity" });
  fireEvent.change(field, { target: { value: percent } });
  fireEvent.blur(field);
}

describe("editing a look with no block selected", () => {
  it("names the block's own look and who an edit reaches, in the bar's exact words", () => {
    mount(own.id);
    expect(screen.getByText("A look for Box blocks")).toBeDefined();
    const bar = screen.getByRole("group", { name: "Editing Plain" });
    expect(bar.querySelector(".nx-look-bar__line")?.textContent).toBe(
      "Editing Plain · every Box"
    );
  });

  it("says a worn look reaches every block that wears it", () => {
    mount(raised.id);
    const bar = screen.getByRole("group", { name: "Editing Raised" });
    expect(bar.querySelector(".nx-look-bar__line")?.textContent).toBe(
      "Editing Raised · every Box that wears it"
    );
  });

  it("writes an edit to the look, and never to the page", async () => {
    const { editor, writeStyles } = mount(raised.id);
    setOpacity("80");
    await Promise.resolve();
    expect(writeStyles).toHaveBeenCalledTimes(1);
    const [id, change] = writeStyles.mock.calls[0] ?? [];
    expect(id).toBe(raised.id);
    expect((change as SharedStyleChange)(raised.styles)).toMatchObject({
      kind: "write",
      styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.8 } } },
    });
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("goes back to block editing from the bar's button or Esc", () => {
    const { onExit } = mount(own.id);
    fireEvent.click(
      screen.getByRole("button", { name: /Back to block editing/ })
    );
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("group", { name: "Editing Plain" }), {
      key: "Escape",
    });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("marks on the canvas the blocks the edit reaches, and clears them after", () => {
    const canvas = window.document.createElement("div");
    canvas.innerHTML = '<div data-nx-node="a"></div>';
    const view = render(
      <InspectorPanel
        editor={editorFor(null)}
        canvasRoot={canvas}
        classLibrary={[own, raised]}
        sharedStyles={{
          mayChange: true,
          writeStyles: async () => undefined,
        }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    // The page's box wears no look, so the box's own look reaches it.
    expect(canvas.querySelector("[data-nx-look-reach]")).not.toBeNull();
    view.unmount();
    expect(canvas.querySelector("[data-nx-look-reach]")).toBeNull();
  });

  it("says why the look's values can't be changed when the author may not", () => {
    render(
      <InspectorPanel
        editor={editorFor(null)}
        classLibrary={[own, raised]}
        sharedStyles={{ mayChange: false, writeStyles: async () => undefined }}
        lookEditing={{
          look: { id: raised.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    const bar = screen.getByRole("group", { name: "Editing Raised" });
    const held = bar.querySelector(".nx-look-bar__held");
    expect(held?.textContent).not.toBe("");
    expect(held).not.toBeNull();
  });

  it("marks the blocks a component draws, read from the composed page, whatever their ids", () => {
    const composed = {
      ...page,
      nodes: [
        ...page.nodes,
        { id: "inner\nbox", type: "acme/box", version: 1, props: {} },
      ],
    } as unknown as BlockDocument;
    const editor = { ...editorFor(null), composed: () => composed };
    const canvas = window.document.createElement("div");
    const inner = window.document.createElement("div");
    inner.setAttribute("data-nx-node", "inner\nbox");
    canvas.append(inner);
    render(
      <InspectorPanel
        editor={editor}
        canvasRoot={canvas}
        classLibrary={[own, raised]}
        sharedStyles={{ mayChange: true, writeStyles: async () => undefined }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    expect(inner.hasAttribute("data-nx-look-reach")).toBe(true);
  });

  it("holds a look whose id another block type's own look shares, and writes nothing", () => {
    const twin: NamedClass = { ...own, blockType: "acme/other", orderIndex: 2 };
    const writeStyles = vi.fn(async () => undefined);
    render(
      <InspectorPanel
        editor={editorFor(null)}
        classLibrary={[own, twin, raised]}
        sharedStyles={{ mayChange: true, writeStyles }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    const bar = screen.getByRole("group", { name: "Editing Plain" });
    expect(bar.querySelector(".nx-look-bar__held")?.textContent).toMatch(
      /same id/
    );
    expect(writeStyles).not.toHaveBeenCalled();
  });

  it("edits the selected block instead while one is selected", () => {
    mount(own.id, "a");
    expect(screen.queryByRole("group", { name: "Editing Plain" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Style" })).toBeDefined();
  });

  it("says to select a block when the look is no longer on the site", () => {
    mount("look:acme/box:gone");
    expect(screen.getByText("Select a block to edit it.")).toBeDefined();
  });
});
