// @vitest-environment jsdom

/**
 * A Layers row as a handle on its block: pointing at it, its eye, its lock,
 * renaming it, its keystrokes and its menu, driven through the panel against
 * a real editor.
 *
 * What each test separates from a plausible broken panel is named in it: the
 * eye that hides on narrower devices too, a rename whose keys the tree eats,
 * a verb on a locked block that silently does nothing.
 *
 * @module layers-row-verbs.test
 */
import {
  clearBlocks,
  deviceVisibility,
  findNode,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { ShortcutProvider, useActiveShortcuts } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useEditorState, type EditorState } from "./editor-state";
import { HoveredBlockProvider, useHoveredBlock } from "./hovered-block";
import { rowKeyAction, toggleOnDeviceOp } from "./layer-row-actions";
import { LayerRowMenu } from "./layer-row-menu";
import { LayersPanel } from "./layers-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.restoreAllMocks();
});

beforeAll(() => {
  // The tree virtualizes: jsdom has no layout, so it is given a viewport.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 800,
  });
});

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

function register(): void {
  if (hasBlock("core/heading")) return;
  registerBlocks(
    [
      { ...base, name: "core/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "core/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
    ] as never,
    { source: "layers-row-verbs-test" }
  );
}

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

let editorRef: EditorState | null = null;

function Host({
  document,
  device = "tablet",
}: {
  document: BlockDocument;
  device?: string;
}): React.JSX.Element {
  const editor = useEditorState({ initialDocument: document });
  editorRef = editor;
  return (
    <LayersPanel editor={editor} device={{ breakpoints: SITE, id: device }} />
  );
}

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/** Each device's state for one block, as a visitor gets it. */
function shown(id: string): Record<string, boolean> {
  const found = findNode(editor().document.nodes, id);
  return Object.fromEntries(
    deviceVisibility(found?.visibility, SITE).map(d => [d.id, d.visible])
  );
}

/** A block's row, found by the hook every row carries. */
function row(id: string): HTMLElement {
  const label = document.querySelector(`[data-nx-layer="${id}"]`);
  const item = label?.closest<HTMLElement>('[role="treeitem"]');
  if (item === null || item === undefined) throw new Error(`no row ${id}`);
  return item;
}

function action(id: string, name: "toggle-hidden" | "toggle-lock") {
  const found = row(id).querySelector<HTMLElement>(`[data-action="${name}"]`);
  return found;
}

function notice(): string {
  return document.querySelector(".nx-layers-panel__notice")?.textContent ?? "";
}

describe("the eye", () => {
  it("hides the block on the device being edited only", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    const eye = action("a", "toggle-hidden");
    expect(eye?.getAttribute("title")).toBe("Hide on Tablet");
    act(() => eye?.click());
    // The narrower device keeps showing it: a plain `false` on tablet would
    // hide it on mobile too.
    expect(shown("a")).toEqual({ base: true, tablet: false, mobile: true });
    expect(notice()).toBe("Hidden on Tablet.");
    // The row says so in a word and is drawn dimmed.
    expect(row("a").textContent).toContain("Hidden");
    expect(
      row("a").querySelector(".nx-layer-row")?.hasAttribute("data-hidden")
    ).toBe(true);
    // And shows it again on the same device.
    act(() => action("a", "toggle-hidden")?.click());
    expect(shown("a")).toEqual({ base: true, tablet: true, mobile: true });
    expect(findNode(editor().document.nodes, "a")?.visibility).toBeUndefined();
  });

  it("is not offered until the device's breakpoints are known", () => {
    register();
    function NoDevice(): React.JSX.Element {
      const editorState = useEditorState({
        initialDocument: page(node("a", "core/heading")),
      });
      return <LayersPanel editor={editorState} />;
    }
    render(<NoDevice />);
    expect(action("a", "toggle-hidden")).toBeNull();
  });

  it("is not offered on a block a lock holds", () => {
    register();
    render(
      <Host
        document={page(
          node("box", "core/box", {
            locked: true,
            slots: { children: [node("inner", "core/heading")] },
          })
        )}
      />
    );
    expect(action("box", "toggle-hidden")).toBeNull();
  });

  it("is out of the Tab order and hidden from assistive technology", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    const eye = action("a", "toggle-hidden");
    expect(eye?.tabIndex).toBe(-1);
    expect(eye?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a block inside a block hidden on the device", () => {
  it("is dimmed, says what it is hidden with, and offers no eye", () => {
    register();
    render(
      <Host
        document={page(
          node("box", "core/box", {
            name: "Hero",
            visibility: { devices: { tablet: false } },
            slots: { children: [node("in", "core/heading")] },
          })
        )}
      />
    );
    fireEvent.keyDown(row("box"), { key: "ArrowRight" });
    expect(row("in").textContent).toContain("Hidden with Hero");
    expect(
      row("in").querySelector(".nx-layer-row")?.hasAttribute("data-hidden")
    ).toBe(true);
    expect(action("in", "toggle-hidden")).toBeNull();
    // Its own block still offers it, to show both again.
    expect(action("box", "toggle-hidden")?.getAttribute("title")).toBe(
      "Show on Tablet"
    );
  });
});

describe("the row menu", () => {
  it("acts on the row it was opened on, though another is the primary", () => {
    register();
    render(
      <Host
        document={page(
          node("a", "core/heading", { name: "First" }),
          node("b", "core/heading", { name: "Second" })
        )}
      />
    );
    act(() => editor().select("b"));
    act(() => editor().select("a", "toggle"));
    expect(editor().selectedId).toBe("a");
    expect(editor().selection.ids).toContain("b");
    fireEvent.contextMenu(row("b"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Rename/ }));
    expect(screen.getByRole("textbox", { name: "Rename Second" })).toBeTruthy();
  });
});

describe("LayerRowMenu", () => {
  it("tells its host when it opens, so a held row drag gives the press up", () => {
    const opened = vi.fn();
    render(
      <LayerRowMenu
        rowOf={() => "a"}
        selectedIds={["a"]}
        select={() => undefined}
        items={() => []}
        verbs={undefined}
        apple={false}
        onOpen={opened}
      >
        <div data-testid="row">Row</div>
      </LayerRowMenu>
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe("a row's eye and padlock", () => {
  it("take no focus from the row on a press, so its keys keep working", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    const eye = action("a", "toggle-hidden");
    if (eye === null) throw new Error("no eye");
    // A cancelled mousedown is what keeps a browser from focusing the button.
    expect(fireEvent.mouseDown(eye)).toBe(false);
    const padlock = action("a", "toggle-lock");
    if (padlock === null) throw new Error("no padlock");
    expect(fireEvent.mouseDown(padlock)).toBe(false);
  });
});

describe("a hidden block inside a hidden block", () => {
  it("says both, and offers no eye that could only be refused", () => {
    register();
    render(
      <Host
        document={page(
          node("box", "core/box", {
            name: "Hero",
            visibility: { devices: { tablet: false } },
            slots: {
              children: [
                node("in", "core/heading", {
                  visibility: { devices: { tablet: false } },
                }),
              ],
            },
          })
        )}
      />
    );
    fireEvent.keyDown(row("box"), { key: "ArrowRight" });
    expect(row("in").textContent).toContain("Hidden");
    expect(action("in", "toggle-hidden")).toBeNull();
  });
});

describe("the lock", () => {
  it("locks and unlocks the block from its row", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    act(() => action("a", "toggle-lock")?.click());
    expect(findNode(editor().document.nodes, "a")?.locked).toBe(true);
    expect(row("a").textContent).toContain("Locked");
    act(() => action("a", "toggle-lock")?.click());
    expect(findNode(editor().document.nodes, "a")?.locked).toBeUndefined();
  });
});

describe("renaming", () => {
  it("renames by F2 and keeps the name on Enter", async () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    fireEvent.keyDown(row("a"), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Rename Heading" });
    fireEvent.change(field, { target: { value: "Hero title" } });
    // Home moves the caret: the tree must not take it, or it would move focus
    // to the first row and end the rename.
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Home" });
    await act(
      () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    );
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(findNode(editor().document.nodes, "a")?.name).toBe("Hero title");
    expect(screen.queryByRole("textbox", { name: /^Rename/ })).toBeNull();
  });

  it("starts from the author's own name, and writes nothing for an unnamed block left as it was", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    fireEvent.keyDown(row("a"), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Rename Heading" });
    // The type's name is the placeholder, never the value a blur stores.
    expect((field as HTMLInputElement).value).toBe("");
    expect(field.getAttribute("placeholder")).toBe("Heading");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(findNode(editor().document.nodes, "a")?.name).toBeUndefined();
    expect(editor().canUndo).toBe(false);
  });

  it("returns focus to its own panel's row, with a second editor beside it", async () => {
    register();
    render(
      <>
        <Host document={page(node("a", "core/heading"))} />
        <div data-testid="second">
          <Host document={page(node("a", "core/heading"))} />
        </div>
      </>
    );
    const second = screen.getByTestId("second");
    const secondRow = second.querySelector<HTMLElement>('[role="treeitem"]');
    if (secondRow === null) throw new Error("no second row");
    fireEvent.keyDown(secondRow, { key: "F2" });
    const field = second.querySelector("input[aria-label^='Rename']");
    if (field === null) throw new Error("no rename field");
    fireEvent.change(field, { target: { value: "Second" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await act(
      () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    );
    expect(second.contains(document.activeElement)).toBe(true);
  });

  it("renames by double-click and keeps the old name on Escape", () => {
    register();
    render(
      <Host document={page(node("a", "core/heading", { name: "Old" }))} />
    );
    fireEvent.doubleClick(row("a"));
    const field = screen.getByRole("textbox", { name: "Rename Old" });
    fireEvent.change(field, { target: { value: "New" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(findNode(editor().document.nodes, "a")?.name).toBe("Old");
  });

  it("goes back to the type's name when the name is emptied", () => {
    register();
    render(
      <Host document={page(node("a", "core/heading", { name: "Old" }))} />
    );
    fireEvent.keyDown(row("a"), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Rename Old" });
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(findNode(editor().document.nodes, "a")?.name).toBeUndefined();
  });

  it("refuses a locked block, and says why", () => {
    register();
    render(
      <Host document={page(node("a", "core/heading", { locked: true }))} />
    );
    fireEvent.keyDown(row("a"), { key: "F2" });
    expect(screen.queryByRole("textbox", { name: /^Rename/ })).toBeNull();
    expect(notice()).not.toBe("");
    expect(notice()).toMatch(/locked/i);
  });
});

describe("the row's keystrokes", () => {
  it("hide by mod+Shift+H and lock by mod+Shift+L", () => {
    register();
    render(<Host document={page(node("a", "core/heading"))} />);
    fireEvent.keyDown(row("a"), { key: "H", ctrlKey: true, shiftKey: true });
    expect(shown("a").tablet).toBe(false);
    fireEvent.keyDown(row("a"), { key: "L", ctrlKey: true, shiftKey: true });
    expect(findNode(editor().document.nodes, "a")?.locked).toBe(true);
  });

  it("are read for the platform's own modifier", () => {
    const press = { metaKey: true, ctrlKey: false, shiftKey: true };
    expect(rowKeyAction({ key: "h", altKey: false, ...press }, true)).toBe(
      "toggle-hidden"
    );
    // Command on a keyboard that is not Apple's is not the modifier.
    expect(rowKeyAction({ key: "h", altKey: false, ...press }, false)).toBe(
      null
    );
    expect(
      rowKeyAction(
        {
          key: "F2",
          altKey: false,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
        },
        false
      )
    ).toBe("rename");
  });
});

describe("pointing at a row", () => {
  it("names its block as the hovered one, and nothing once the pointer leaves", () => {
    register();
    // What the canvas marks read, read the same way.
    function Probe(): React.JSX.Element {
      return <output data-testid="hovered">{useHoveredBlock() ?? ""}</output>;
    }
    function Hovered(): React.JSX.Element {
      const editorState = useEditorState({
        initialDocument: page(node("a", "core/heading")),
      });
      return (
        <HoveredBlockProvider>
          <LayersPanel editor={editorState} />
          <Probe />
        </HoveredBlockProvider>
      );
    }
    render(<Hovered />);
    act(() => {
      fireEvent.pointerOver(row("a"));
    });
    expect(screen.getByTestId("hovered").textContent).toBe("a");
    const body = document.querySelector(".nx-layers-panel__body");
    act(() => {
      if (body !== null) fireEvent.pointerLeave(body);
    });
    expect(screen.getByTestId("hovered").textContent).toBe("");
  });
});

describe("choosing a row", () => {
  it("scrolls the canvas to its block", async () => {
    register();
    const canvas = document.createElement("div");
    const block = document.createElement("div");
    block.setAttribute("data-nx-node", "a");
    canvas.append(block);
    document.body.append(canvas);
    const scrolled = vi.spyOn(block, "scrollIntoView");
    function Chosen(): React.JSX.Element {
      const editorState = useEditorState({
        initialDocument: page(node("a", "core/heading")),
      });
      return <LayersPanel editor={editorState} canvasRoot={canvas} />;
    }
    render(<Chosen />);
    const frame = () =>
      act(
        () =>
          new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      );
    fireEvent.click(row("a"));
    await frame();
    expect(scrolled).toHaveBeenCalledTimes(1);
    // Chosen again, though the selection does not change: the author may
    // have scrolled the canvas away since.
    fireEvent.click(row("a"));
    await frame();
    expect(scrolled).toHaveBeenCalledTimes(2);
    canvas.remove();
  });
});

describe("with the editor's shortcut manager", () => {
  it("registers the row keys, so Help lists them, and runs them on the focused row", () => {
    register();
    let listed: readonly string[] = [];
    function Listed(): null {
      listed = useActiveShortcuts().map(binding => binding.keys);
      return null;
    }
    function Managed(): React.JSX.Element {
      const editorState = useEditorState({
        initialDocument: page(node("a", "core/heading")),
      });
      editorRef = editorState;
      return (
        <ShortcutProvider>
          <LayersPanel
            editor={editorState}
            device={{ breakpoints: SITE, id: "tablet" }}
            shortcuts
          />
          <Listed />
        </ShortcutProvider>
      );
    }
    render(<Managed />);
    expect(listed).toEqual(
      expect.arrayContaining(["F2", "mod+shift+h", "mod+shift+l"])
    );
    act(() => row("a").focus());
    fireEvent.keyDown(row("a"), { key: "H", ctrlKey: true, shiftKey: true });
    expect(shown("a").tablet).toBe(false);
  });
});

describe("toggleOnDeviceOp", () => {
  it("answers null for a block the document does not hold", () => {
    expect(
      toggleOnDeviceOp(page(), "absent", { breakpoints: SITE, id: "tablet" })
    ).toBeNull();
  });
});
