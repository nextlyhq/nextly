// @vitest-environment jsdom

/**
 * A block's own inspector (`editor.component`), drawn by the real panel
 * against a real document.
 *
 * The properties, each against the wrong version it rules out:
 *
 * - A block naming an inspector the host resolved gets it IN PLACE of the
 *   generated content controls, and still gets the identity fields, the
 *   Advanced tab's CSS id and the Style tab. A panel that drew both, or that
 *   replaced the whole inspector, fails.
 * - A block naming one the host did not load keeps the generated controls,
 *   so an unloaded component never leaves a block uneditable.
 * - An edit made through it reaches the document through the same write the
 *   generated controls make: one `update` op on that node, keeping its other
 *   props.
 * - While the block is read-only (locked, or inside a `contentOnly` area),
 *   it is told so, and a commit it makes ANYWAY writes nothing. The component
 *   below ignores the flag on purpose: the refusal must be the host's.
 * - A component that throws costs its controls, not the editor.
 *
 * @module inspector-panel.custom.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as React from "react";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockInspectorProps,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import type { EditorState } from "./editor-state";
import { InspectorPanel, type BlockInspectorResolver } from "./inspector-panel";
import { applyOp, type BuilderOp } from "./ops";

const INSPECTOR = "acme-blocks/editor#HeroInspector";

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
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
});

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/hero",
        version: 1,
        description: "A hero.",
        example: { props: {} },
        editor: { label: "Hero", component: INSPECTOR },
        props: {
          title: { type: "text", role: "content" },
          tone: { type: "text" },
        },
        render: () => null,
      },
      {
        name: "acme/frame",
        version: 1,
        description: "A frame whose children keep their design.",
        example: { props: {} },
        props: {},
        slots: {
          children: {
            lock: "contentOnly",
            defaultBlock: [{ type: "acme/hero" }],
          },
        },
        render: () => null,
      },
    ] as never,
    { source: "inspector-custom-test" }
  );
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const hero = (extra: Partial<BlockNode> = {}): BlockNode =>
  ({
    id: "hero",
    type: "acme/hero",
    version: 1,
    props: { title: "Hello", tone: "warm" },
    ...extra,
  }) as BlockNode;

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function editorFor(
  document: BlockDocument
): EditorState & { apply: ReturnType<typeof vi.fn> } {
  return {
    document,
    selectedId: "hero",
    selection: { ids: ["hero"], primary: "hero" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
}

/** What the custom inspector was last given. */
let given: BlockInspectorProps | undefined;

/** An inspector that ignores `readOnly`, as a careless plugin might. */
function HeroInspector(props: BlockInspectorProps): React.JSX.Element {
  given = props;
  return <p>Custom hero controls</p>;
}

const resolving: BlockInspectorResolver = path =>
  path === INSPECTOR ? HeroInspector : undefined;

beforeEach(() => {
  given = undefined;
});

describe("a block's own inspector", () => {
  it("replaces the generated content controls, keeping identity, Advanced and Style", () => {
    render(
      <InspectorPanel
        editor={editorFor(documentOf([hero()]))}
        inspectors={resolving}
      />
    );

    expect(screen.getByText("Custom hero controls")).toBeTruthy();
    // The generated field for the block's own prop is gone.
    expect(screen.queryByLabelText("Title")).toBeNull();
    // What every block keeps.
    expect(screen.getByRole("tab", { name: "Style" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeTruthy();
    expect(document.getElementById("nx-block-css-id")).not.toBeNull();
    expect(given?.node.id).toBe("hero");
    expect(given?.props).toEqual({ title: "Hello", tone: "warm" });
    expect(given?.readOnly).toBe(false);
  });

  it("falls back to the generated controls when the host did not load it", () => {
    render(
      <InspectorPanel
        editor={editorFor(documentOf([hero()]))}
        inspectors={() => undefined}
      />
    );

    expect(screen.queryByText("Custom hero controls")).toBeNull();
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  it("writes an edit through the generated controls' path, keeping the other props", () => {
    const editor = editorFor(documentOf([hero()]));
    render(<InspectorPanel editor={editor} inspectors={resolving} />);

    given?.commit("title", "Welcome");

    expect(editor.apply).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({
      kind: "update",
      id: "hero",
      patch: { props: { title: "Welcome", tone: "warm" } },
    });
  });

  it("keeps both of two commits made in one handler", () => {
    /*
     * An editor whose `apply` really applies, as `useEditorState` does: the
     * document it holds moves at once, before the panel re-renders. A commit
     * built from the render's own snapshot would carry the old title into the
     * second patch and undo the first edit.
     */
    let live = documentOf([hero()]);
    const editor = editorFor(live);
    editor.apply.mockImplementation((op: BuilderOp) => {
      live = applyOp(live, op).document;
      return live;
    });
    render(<InspectorPanel editor={editor} inspectors={resolving} />);

    given?.commit("title", "Welcome");
    given?.commit("tone", "cool");

    expect(editor.apply).toHaveBeenCalledTimes(2);
    expect(live.nodes[0]?.props).toEqual({ title: "Welcome", tone: "cool" });
  });

  it("refuses every write while the block is locked, whatever the component does", () => {
    const editor = editorFor(documentOf([hero({ locked: true })]));
    render(<InspectorPanel editor={editor} inspectors={resolving} />);

    expect(given?.readOnly).toBe(true);
    given?.commit("title", "Welcome");

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("refuses every write inside a contentOnly area", () => {
    const frame = {
      id: "frame",
      type: "acme/frame",
      version: 1,
      props: {},
      slots: { children: [hero()] },
    } as unknown as BlockNode;
    const editor = editorFor(documentOf([frame]));
    render(<InspectorPanel editor={editor} inspectors={resolving} />);

    expect(given?.readOnly).toBe(true);
    given?.commit("tone", "cool");

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("shows the generated controls when the component throws", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): React.JSX.Element {
      throw new Error("plugin bug");
    }
    render(
      <InspectorPanel
        editor={editorFor(documentOf([hero()]))}
        inspectors={() => Broken}
      />
    );

    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "could not be shown"
    );
    quiet.mockRestore();
  });
});
