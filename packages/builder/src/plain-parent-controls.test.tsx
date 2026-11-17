// @vitest-environment jsdom

/**
 * "Inside its parent" in the Style tab, with the real editor: Width (and
 * Height under a Row or a Grid) in plain words, the line under each choice,
 * and what each writes.
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
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

import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

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

const BREAKPOINTS: BreakpointSet = {
  viewport: [
    { id: BASE_BREAKPOINT, label: "Desktop" },
    { id: "md", label: "Tablet", maxWidth: 1024 },
  ],
  container: [],
} as BreakpointSet;

function versionOf(type: string): number {
  return coreBlocks.find(each => each.name === type)?.version ?? 1;
}

/** A Box arranged as given, holding one Button. */
function pageOf(parentStyles: Record<string, string>): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "box",
        type: "core/box",
        version: versionOf("core/box"),
        props: { as: "div" },
        styles: { base: { base: parentStyles } },
        slots: {
          children: [
            {
              id: "button",
              type: "core/button",
              version: versionOf("core/button"),
              props: { label: "Go", type: "button" },
            } as BlockNode,
          ],
        },
      } as BlockNode,
    ],
  } as BlockDocument;
}

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;

function Host({ page }: { page: BlockDocument }): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  return (
    <InspectorPanel
      editor={state}
      breakpoints={BREAKPOINTS}
      breakpoint={BASE_BREAKPOINT}
    />
  );
}

/** The Button selected under a parent so arranged, Inside its parent open. */
function mount(parentStyles: Record<string, string>): void {
  render(<Host page={pageOf(parentStyles)} />);
  act(() => editor().select("button"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  const header = document.querySelector<HTMLElement>(
    '[data-section="inside-parent"] [data-slot="accordion-trigger"]'
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
}

function fields(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    '[data-control="inside-parent"]'
  );
  if (found === null) throw new Error("no Inside its parent");
  return found;
}

function choose(axis: string, choice: string): void {
  fireEvent.click(
    within(within(fields()).getByRole("radiogroup", { name: axis })).getByRole(
      "radio",
      { name: choice }
    )
  );
}

function stored(): Record<string, unknown> {
  const node = findNode(editor().document.nodes, "button");
  const styles = node?.styles as
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;
  return styles?.base?.base ?? {};
}

describe("Inside its parent", () => {
  it("says what each Width choice does", () => {
    mount({ display: "flex" });
    expect(fields().textContent).toContain("As wide as its content.");
    choose("Width", "Fill");
    expect(fields().textContent).toContain("Takes the space it's given.");
    choose("Width", "Fixed");
    expect(fields().textContent).toContain("A width you set.");
  });

  it("offers Height in a Row and a Grid, not in a Stack", () => {
    mount({ display: "flex" });
    expect(
      within(fields()).queryByRole("radiogroup", { name: "Height" })
    ).not.toBeNull();
    cleanup();
    mount({ display: "grid" });
    expect(
      within(fields()).queryByRole("radiogroup", { name: "Height" })
    ).not.toBeNull();
    cleanup();
    mount({});
    expect(
      within(fields()).queryByRole("radiogroup", { name: "Height" })
    ).toBeNull();
  });

  it("writes Fill in a Row as a share of the rest of the row", () => {
    mount({ display: "flex" });
    choose("Width", "Fill");
    // Grow and shrink are stored as the numbers the catalog holds.
    expect(stored()).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "0",
      minWidth: "0",
    });
  });

  it("shows a width field for Fixed, and writes what is typed", () => {
    mount({});
    choose("Width", "Fixed");
    const field = within(fields()).getByLabelText("Width set");
    fireEvent.change(field, { target: { value: "18rem" } });
    fireEvent.blur(field);
    expect(stored().width).toBe("18rem");
  });

  it("reads values no choice writes as Custom", () => {
    mount({ display: "flex" });
    choose("Width", "Fill");
    act(() => {
      const node = findNode(editor().document.nodes, "button")!;
      editor().apply({
        kind: "update",
        id: "button",
        patch: {
          styles: {
            ...(node.styles ?? {}),
            base: { base: { flexGrow: "3" } },
          },
        },
      } as never);
    });
    const group = within(fields()).getByRole("radiogroup", { name: "Width" });
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
    expect(fields().textContent).toContain("Custom");
  });
});
