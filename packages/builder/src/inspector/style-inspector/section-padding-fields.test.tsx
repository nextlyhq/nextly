// @vitest-environment jsdom

/**
 * A Section's Padding in Style › Spacing: Compact, Normal or Roomy above the
 * spacing box, Normal by default and stored as nothing; "Custom" while a side
 * holds its own value; and a preset chosen again clearing those values in one
 * step that one undo brings back.
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { createBlockResolver, pageStyleTrace } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { useEditorState, type EditorState } from "../../editor-state";
import { InspectorPanel } from "../inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
});

const HINT = "Space inside the section, from the site's settings";

function nodeOf(id: string, type: string, extra: Partial<BlockNode> = {}) {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return {
    id,
    type,
    version: block.version,
    props: { ...(block.defaultProps as object) },
    slots: { children: [] },
    ...extra,
  } as BlockNode;
}

function pageOf(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** Styles at the base state and breakpoint. */
function at(values: Record<string, unknown>): NodeStyles {
  return { base: { [BASE_BREAKPOINT]: values } } as NodeStyles;
}

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;

const BLOCKS = createBlockResolver(coreBlocks as never);

/** The panel, over the cascade the canvas compiles for the page as it stands. */
function Host({ page }: { page: BlockDocument }): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  const cascade = React.useMemo(
    () =>
      pageStyleTrace({
        document: state.document,
        styleContext: {
          breakpoints: {
            viewport: [{ id: BASE_BREAKPOINT, label: "Desktop" }],
            container: [],
          },
        },
        site: undefined,
        blocks: BLOCKS,
      }),
    [state.document]
  );
  return (
    <InspectorPanel
      editor={state}
      breakpoint={BASE_BREAKPOINT}
      cascade={cascade}
    />
  );
}

/** The panel on a block's Style tab, with Spacing open. */
function mount(page: BlockDocument, id = "s"): void {
  render(<Host page={page} />);
  act(() => editor().select(id));
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Style/ }));
  const spacing = screen.getByRole("button", { name: /^Spacing/ });
  if (spacing.getAttribute("aria-expanded") !== "true")
    fireEvent.click(spacing);
}

function padding(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Padding" });
}

function choice(name: string): HTMLElement {
  return within(padding()).getByRole("radio", { name });
}

/** The radios that read as chosen. */
function chosen(): string[] {
  return within(padding())
    .getAllByRole("radio")
    .filter(radio => radio.getAttribute("aria-checked") === "true")
    .map(radio => radio.textContent ?? "");
}

function stored(id = "s"): BlockNode | undefined {
  return findNode(editor().document.nodes, id);
}

describe("a Section's Padding", () => {
  it("offers Compact, Normal and Roomy above the spacing box, at Normal, with its hint", () => {
    mount(pageOf(nodeOf("s", "core/section")));
    expect(
      within(padding())
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["Compact", "Normal", "Roomy"]);
    expect(chosen()).toEqual(["Normal"]);
    const hint = screen.getByText(HINT);
    // The spacing box, or its sides as fields where the panel has no
    // writing direction to draw a box in.
    const box = document.querySelector('[data-property="padding"]');
    expect(box).not.toBeNull();
    // Above the box: the choices, then the hint, then the box.
    expect(
      padding().compareDocumentPosition(box as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      hint.compareDocumentPosition(box as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("stores the preset chosen, and nothing for Normal", () => {
    mount(pageOf(nodeOf("s", "core/section")));
    fireEvent.click(choice("Roomy"));
    expect(stored()?.props.paddingPreset).toBe("roomy");
    expect(chosen()).toEqual(["Roomy"]);
    fireEvent.click(choice("Normal"));
    expect(stored()?.props).not.toHaveProperty("paddingPreset");
    expect(chosen()).toEqual(["Normal"]);
  });

  it("is chosen with the arrow keys, from one tab stop", () => {
    mount(pageOf(nodeOf("s", "core/section")));
    const normal = choice("Normal");
    expect(normal.tabIndex).toBe(0);
    expect(choice("Compact").tabIndex).toBe(-1);
    normal.focus();
    fireEvent.keyDown(normal, { key: "ArrowRight" });
    expect(stored()?.props.paddingPreset).toBe("roomy");
    expect(document.activeElement).toBe(choice("Roomy"));
  });

  it("is not offered on a Box, whose padding is 0", () => {
    mount(pageOf(nodeOf("b", "core/box")), "b");
    expect(screen.queryByRole("radiogroup", { name: "Padding" })).toBeNull();
  });
});

describe("a side's own value", () => {
  it('reads as "Custom" and keeps the value', () => {
    const own = at({ padding: { blockStart: "10px" } });
    mount(pageOf(nodeOf("s", "core/section", { styles: own })));
    expect(chosen()).toEqual([]);
    expect(screen.getByText(/^Custom:/)).toBeDefined();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(stored()?.styles).toEqual(own);
  });

  it("set in the spacing box turns the preset to Custom; a preset again clears it in one step that one undo restores", async () => {
    mount(
      pageOf(
        nodeOf("s", "core/section", {
          props: { as: "section", contained: true, paddingPreset: "compact" },
        })
      )
    );
    expect(chosen()).toEqual(["Compact"]);

    // The author's own top padding, as the spacing box writes it.
    const own = at({ padding: { blockStart: "10px" }, color: "red" });
    act(() => {
      editor().apply({ kind: "update", id: "s", patch: { styles: own } });
    });
    expect(chosen()).toEqual([]);
    expect(screen.getByText(/^Custom:/)).toBeDefined();
    expect(stored()?.props.paddingPreset).toBe("compact");

    fireEvent.click(choice("Roomy"));
    expect(stored()?.props.paddingPreset).toBe("roomy");
    // Only the padding goes; another value the author set stays.
    expect(stored()?.styles).toEqual(at({ color: "red" }));
    expect(chosen()).toEqual(["Roomy"]);

    await act(async () => {
      await editor().undo();
    });
    expect(stored()?.styles).toEqual(own);
    expect(stored()?.props.paddingPreset).toBe("compact");
    expect(chosen()).toEqual([]);

    await act(async () => {
      await editor().redo();
    });
    expect(stored()?.styles).toEqual(at({ color: "red" }));
    expect(stored()?.props.paddingPreset).toBe("roomy");
  });

  it("is cleared on every device and state by a preset, and the styles go when nothing is left", async () => {
    const own = {
      base: {
        [BASE_BREAKPOINT]: { padding: { inlineStart: "4px" } },
        tablet: { padding: { blockEnd: "8px" } },
      },
      hover: { [BASE_BREAKPOINT]: { padding: { blockStart: "2px" } } },
    } as unknown as NodeStyles;
    mount(pageOf(nodeOf("s", "core/section", { styles: own })));
    fireEvent.click(choice("Normal"));
    expect(stored()).not.toHaveProperty("styles");
    // Still open: Spacing opened for holding values, and the author is in it.
    expect(chosen()).toEqual(["Normal"]);
    await act(async () => {
      await editor().undo();
    });
    expect(stored()?.styles).toEqual(own);
  });
});

describe("a Section the author may not restyle", () => {
  it("shows its Padding held, and a choice changes nothing", () => {
    mount(pageOf(nodeOf("s", "core/section", { locked: true })));
    for (const radio of within(padding()).getAllByRole("radio")) {
      expect(radio.matches(":disabled")).toBe(true);
    }
    fireEvent.click(choice("Roomy"));
    expect(stored()?.props).not.toHaveProperty("paddingPreset");
  });
});
