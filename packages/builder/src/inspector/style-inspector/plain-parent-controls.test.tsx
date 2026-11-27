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

/** A Box (or another container) arranged as given, holding one Button. */
function pageOf(
  parentStyles: Record<string, string>,
  parentType = "core/box"
): BlockDocument {
  const example = coreBlocks.find(each => each.name === parentType)?.example;
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "box",
        type: parentType,
        version: versionOf(parentType),
        props:
          parentType === "core/box" ? { as: "div" } : (example?.props ?? {}),
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
function mount(
  parentStyles: Record<string, string>,
  parentType?: string
): void {
  render(<Host page={pageOf(parentStyles, parentType)} />);
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

describe("Inside its parent, by the settings search", () => {
  it("finds Height by its name, leaving Width out", () => {
    mount({ display: "flex" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find a setting" }),
      {
        target: { value: "height" },
      }
    );
    const axis = (name: string) =>
      within(fields())
        .getByRole("radiogroup", { name, hidden: true })
        .closest("[hidden]");
    expect(axis("Height")).toBeNull();
    expect(axis("Width")).not.toBeNull();
  });
});

describe("a block taken out of the flow", () => {
  it("gets no Fill, Fit or Fixed, its parent not laying it out", () => {
    render(
      <Host
        page={
          {
            ...pageOf({ display: "flex" }),
            nodes: [
              {
                ...pageOf({ display: "flex" }).nodes[0]!,
                slots: {
                  children: [
                    {
                      id: "button",
                      type: "core/button",
                      version: versionOf("core/button"),
                      props: { label: "Go", type: "button" },
                      styles: {
                        base: { base: { position: { type: "absolute" } } },
                      },
                    } as BlockNode,
                  ],
                },
              } as BlockNode,
            ],
          } as BlockDocument
        }
      />
    );
    act(() => editor().select("button"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    expect(document.querySelector('[data-control="inside-parent"]')).toBeNull();
  });
});

/** Closes an open tooltip, so the next hover opens its own. */
function cleanupTooltip(): void {
  fireEvent.keyDown(document.body, { key: "Escape" });
}

describe("Align, for a Fit or Fixed block", () => {
  const CENTRED_COLUMN = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  };
  const align = () =>
    within(fields()).queryByRole("radiogroup", { name: "Align" });
  const choices = () =>
    within(align()!)
      .getAllByRole("radio")
      .map(radio => ({
        name: radio.textContent,
        on: radio.getAttribute("aria-checked") === "true",
      }));

  it("offers the parent's place, chosen, then Left, Center and Right", () => {
    mount(CENTRED_COLUMN);
    choose("Width", "Fit");
    expect(choices()).toEqual([
      { name: "Box's", on: true },
      { name: "Left", on: false },
      { name: "Center", on: false },
      { name: "Right", on: false },
    ]);
    // The parent keeps the block centred: no place of its own is written.
    expect(stored()).toEqual({ width: "fit-content" });
  });

  it("names the first choice after the parent", () => {
    for (const [type, name] of [
      ["core/section", "Section's"],
      ["core/column", "Column's"],
      ["core/card", "Card's"],
    ] as const) {
      mount(CENTRED_COLUMN, type);
      choose("Width", "Fixed");
      expect(choices()[0]?.name).toBe(name);
      cleanup();
    }
    mount({ display: "grid" }, "core/box");
    choose("Width", "Fit");
    expect(choices()[0]).toEqual({ name: "Box's", on: true });
  });

  it("places this block only with Left, Center or Right, and gives it back with the first", () => {
    mount(CENTRED_COLUMN);
    choose("Width", "Fit");
    choose("Align", "Left");
    expect(stored()).toEqual({ width: "fit-content", alignSelf: "flex-start" });
    expect(choices()[1]).toEqual({ name: "Left", on: true });
    choose("Align", "Right");
    expect(stored().alignSelf).toBe("flex-end");
    choose("Align", "Box's");
    expect(stored()).toEqual({ width: "fit-content" });
  });

  it("shows the CSS each choice writes on hover, the parent's as the clear it is", async () => {
    mount(CENTRED_COLUMN);
    choose("Width", "Fit");
    const hintOf = async (name: string): Promise<string> => {
      fireEvent.pointerMove(within(align()!).getByRole("radio", { name }));
      const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
      const text = tip.textContent ?? "";
      fireEvent.pointerLeave(within(align()!).getByRole("radio", { name }));
      cleanupTooltip();
      return text;
    };
    expect(await hintOf("Box's")).toBe("align-self: auto");
    expect(await hintOf("Left")).toBe("align-self: flex-start");
    expect(await hintOf("Center")).toBe("align-self: center");
    expect(await hintOf("Right")).toBe("align-self: flex-end");
  });

  it("isn't offered while the width is Fill, nor under a Row", () => {
    mount(CENTRED_COLUMN);
    choose("Width", "Fill");
    expect(align()).toBeNull();
    cleanup();
    mount({ display: "flex" });
    choose("Width", "Fit");
    expect(align()).toBeNull();
  });

  it("reads a block stored with the old left pin as Align: Left", () => {
    mount(CENTRED_COLUMN);
    act(() => {
      const node = findNode(editor().document.nodes, "button")!;
      editor().apply({
        kind: "update",
        id: "button",
        patch: {
          styles: {
            ...(node.styles ?? {}),
            base: { base: { alignSelf: "flex-start" } },
          },
        },
      } as never);
    });
    expect(
      within(within(fields()).getByRole("radiogroup", { name: "Width" }))
        .getByRole("radio", { name: "Fit" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(choices()[1]).toEqual({ name: "Left", on: true });
  });
});
