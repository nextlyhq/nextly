// @vitest-environment jsdom

/**
 * A container's Arrange in Style › Layout: Stack, Row or Grid in plain words,
 * the rows each offers in order, what each writes, and the values a change
 * leaves unused. The editor is the real one, so what Arrange writes is what
 * it reads back, and undo is the store's own.
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
    { id: "sm", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
} as BreakpointSet;

function nodeOf(styles?: BlockNode["styles"]): BlockNode {
  const block = coreBlocks.find(each => each.name === "core/box");
  if (block === undefined) throw new Error("core/box is not a core block");
  return {
    id: "box",
    type: "core/box",
    version: block.version,
    props: {},
    ...(styles === undefined ? {} : { styles }),
  } as BlockNode;
}

function pageOf(styles?: BlockNode["styles"]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [nodeOf(styles)],
  } as BlockDocument;
}

let editorRef: EditorState | null = null;
const editor = (): EditorState => editorRef!;

function Host({
  page,
  device,
}: {
  page: BlockDocument;
  device: string;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  return (
    <InspectorPanel
      editor={state}
      breakpoints={BREAKPOINTS}
      breakpoint={device}
    />
  );
}

/** The Box selected, its Style tab open on Layout, at a device. */
function mount(
  styles?: BlockNode["styles"],
  device: string = BASE_BREAKPOINT
): { at: (device: string) => void } {
  const page = pageOf(styles);
  const { rerender } = render(<Host page={page} device={device} />);
  act(() => editor().select("box"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  openLayout();
  return {
    at: next => {
      rerender(<Host page={page} device={next} />);
      openLayout();
    },
  };
}

function openLayout(): void {
  const header = document.querySelector<HTMLElement>(
    '[role="tabpanel"]:not([hidden]) [data-section="layout"] [data-slot="accordion-trigger"]'
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
}

/** What the Box stores at a device, base state. */
function stored(device: string = BASE_BREAKPOINT): Record<string, unknown> {
  const node = findNode(editor().document.nodes, "box");
  const styles = node?.styles as
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;
  return styles?.base?.[device] ?? {};
}

function arrange(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-control="arrange"]');
  if (found === null) throw new Error("no Arrange");
  return found;
}

function group(name: string): HTMLElement {
  return within(arrange()).getByRole("radiogroup", { name });
}

function choose(name: string, option: string): void {
  fireEvent.click(within(group(name)).getByRole("radio", { name: option }));
}

function marked(name: string, option: string): string | null {
  return within(group(name))
    .getByRole("radio", { name: option })
    .getAttribute("aria-checked");
}

/** The names of Arrange's rows, in order. */
function rowNames(): string[] {
  return [
    ...arrange().querySelectorAll<HTMLElement>(
      ".nx-inspector__field-name, .nx-style-inspector__field-label-text"
    ),
  ].map(each => each.textContent?.trim() ?? "");
}

function cssLine(): string | null | undefined {
  return arrange().querySelector(".nx-arrange__css")?.textContent;
}

describe("Arrange on a new Box", () => {
  it("marks Stack, with what it writes under it", () => {
    mount();
    expect(marked("Arrange", "Stack")).toBe("true");
    expect(cssLine()).toBe("display: block");
  });

  it("takes Display, Direction and Justify out of the raw rows", () => {
    mount();
    const section = document.querySelector<HTMLElement>(
      '[data-section="layout"]'
    )!;
    const raw = [
      ...section.querySelectorAll(".nx-style-inspector__field-label-text"),
    ]
      .filter(label => label.closest('[data-control="arrange"]') === null)
      .map(label => label.textContent);
    expect(raw).not.toContain("Display");
    expect(raw).not.toContain("Flex direction");
    expect(raw).not.toContain("Justify");
  });
});

describe("Row", () => {
  it("writes a flex row and shows its rows in order", () => {
    mount();
    choose("Arrange", "Row");
    expect(stored()).toMatchObject({ display: "flex" });
    expect(cssLine()).toBe("display: flex · flex-direction: row");
    expect(rowNames()).toEqual([
      "Arrange",
      "Stack on",
      "Align",
      "Spread",
      "Space between",
      "Wrap onto new lines",
      "Reverse order",
    ]);
  });

  it("writes Spread, Wrap and Reverse order", () => {
    mount({ base: { base: { display: "flex" } } });
    choose("Spread", "Space between");
    expect(stored().justifyContent).toBe("space-between");
    fireEvent.click(
      within(arrange()).getByRole("switch", { name: "Wrap onto new lines" })
    );
    expect(stored().flexWrap).toBe("wrap");
    fireEvent.click(
      within(arrange()).getByRole("switch", { name: "Reverse order" })
    );
    expect(stored().flexDirection).toBe("row-reverse");
  });

  it("stacks on a device, and still reads as Row there, without Wrap", () => {
    const panel = mount({ base: { base: { display: "flex" } } });
    fireEvent.change(within(arrange()).getByLabelText("Stack on"), {
      target: { value: "sm" },
    });
    expect(stored("sm").flexDirection).toBe("column");
    panel.at("sm");
    expect(marked("Arrange", "Row")).toBe("true");
    expect(rowNames()).not.toContain("Wrap onto new lines");
    // Top right at the stacked device goes by the column there.
    choose("Align", "Top right");
    expect(stored("sm")).toMatchObject({
      alignItems: "end",
      justifyContent: "start",
    });
  });
});

describe("Stack", () => {
  it("offers Align, Space between and Reverse order", () => {
    mount();
    expect(rowNames()).toEqual([
      "Arrange",
      "Align",
      "Space between",
      "Reverse order",
    ]);
  });

  it("becomes a flex column for its Align, and still reads as Stack", () => {
    mount();
    choose("Align", "Centre");
    expect(stored()).toMatchObject({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    });
    expect(marked("Arrange", "Stack")).toBe("true");
    expect(cssLine()).toBe("display: flex · flex-direction: column");
  });

  it("names the nine points and moves between them with the arrows", () => {
    mount();
    const points = within(group("Align")).getAllByRole("radio");
    expect(points.map(point => point.getAttribute("aria-label"))).toEqual([
      "Top left",
      "Top centre",
      "Top right",
      "Middle left",
      "Centre",
      "Middle right",
      "Bottom left",
      "Bottom centre",
      "Bottom right",
    ]);
    expect(arrange().textContent).toContain("Fills the width");
    fireEvent.keyDown(points[0]!, { key: "ArrowDown" });
    expect(stored()).toMatchObject({
      alignItems: "start",
      justifyContent: "center",
    });
  });
});

describe("Grid", () => {
  it("offers columns by number or as many as fit, and rows apart", () => {
    mount();
    choose("Arrange", "Grid");
    expect(stored().display).toBe("grid");
    expect(rowNames().slice(0, 3)).toEqual(["Arrange", "Columns", "How many"]);
    const count = within(arrange()).getByLabelText("How many");
    fireEvent.change(count, { target: { value: "3" } });
    fireEvent.blur(count);
    expect(stored().gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    choose("Columns", "As many as fit");
    expect(stored().gridTemplateColumns).toBe(
      "repeat(auto-fill, minmax(12rem, 1fr))"
    );
    expect(
      (within(arrange()).getByLabelText("Minimum width") as HTMLInputElement)
        .value
    ).toBe("12rem");
    fireEvent.click(
      within(arrange()).getByRole("button", {
        name: "Set rows and columns apart",
      })
    );
    expect(rowNames()).toContain("Between rows");
    expect(rowNames()).toContain("Between columns");
    expect(rowNames()).not.toContain("Space between");
  });
});

describe("settings a change leaves unused", () => {
  it("are kept and said, and Clear removes them in one undoable step", () => {
    mount({ base: { base: { display: "flex", flexWrap: "wrap" } } });
    choose("Arrange", "Grid");
    expect(
      arrange().querySelector(".nx-arrange__unused")?.textContent
    ).toContain("1 setting from Row isn't used");
    // Kept, and not listed as if it applied.
    expect(stored().flexWrap).toBe("wrap");
    expect(rowNames()).not.toContain("Wrap onto new lines");
    fireEvent.click(within(arrange()).getByRole("button", { name: "Clear" }));
    expect(stored().flexWrap).toBeUndefined();
    expect(arrange().querySelector(".nx-arrange__unused")).toBeNull();
    act(() => editor().undo());
    expect(stored().flexWrap).toBe("wrap");
    expect(arrange().querySelector(".nx-arrange__unused")).not.toBeNull();
  });
});

describe("a combination with no plain words", () => {
  it("reads as Custom with its raw rows, and Use plain controls rewrites it", () => {
    mount({ base: { base: { display: "inline-flex" } } });
    for (const radio of within(group("Arrange")).getAllByRole("radio")) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
    expect(arrange().textContent).toContain("Arrange: Custom");
    const section = document.querySelector<HTMLElement>(
      '[data-section="layout"]'
    )!;
    expect(section.textContent).toContain("Display");
    fireEvent.click(
      within(arrange()).getByRole("button", { name: "Use plain controls" })
    );
    expect(stored().display).toBe("flex");
    expect(marked("Arrange", "Row")).toBe("true");
  });
});
