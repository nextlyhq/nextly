// @vitest-environment jsdom

/**
 * What the settings panel builds again when the author selects another
 * block, counted rather than timed:
 *
 * - none of the Content tab while the Style tab is showing;
 * - only the Style sections whose inputs changed: two Headings that differ
 *   in their type and share their (empty) background re-render Typography
 *   once and Background not at all.
 *
 * And what the work saved never costs: a half-typed name stays with the
 * block it was typed on.
 *
 * The editor is the real one (`useEditorState`), selecting as the canvas
 * does. Each Style section is counted by the accordion item it draws, and
 * the Content tab by the block's own inspector, one of its fields.
 *
 * @module inspector-panel.renders.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockInspectorProps,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/** Renders of each accordion item, by the section it draws. */
const counted = vi.hoisted(() => ({
  sections: new Map<string, number>(),
  content: 0,
}));

vi.mock("@nextlyhq/ui", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/ui")>();
  const AccordionItem = (
    props: React.ComponentProps<typeof real.AccordionItem>
  ): React.JSX.Element => {
    counted.sections.set(
      props.value,
      (counted.sections.get(props.value) ?? 0) + 1
    );
    return <real.AccordionItem {...props} />;
  };
  return { ...real, AccordionItem };
});

import { useEditorState, type EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { BlockInspectorResolver } from "./inspector-panel";

const INSPECTOR = "acme/heading#inspector";

/** The heading's own Content field, counted on every render. */
function HeadingInspector(props: BlockInspectorProps): React.JSX.Element {
  counted.content += 1;
  return <p>Heading controls for {props.node.id}</p>;
}

const DRAFTING = "acme/quote#inspector";

/** A block's own inspector holding a draft, committed when it is left. */
function DraftingInspector({
  props,
  commit,
}: BlockInspectorProps): React.JSX.Element {
  const [draft, setDraft] = React.useState(String(props.text ?? ""));
  return (
    <label>
      Quote text
      <input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => commit("text", draft)}
      />
    </label>
  );
}

const inspectors: BlockInspectorResolver = path =>
  path === INSPECTOR
    ? HeadingInspector
    : path === DRAFTING
      ? DraftingInspector
      : undefined;

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  Element.prototype.scrollIntoView ??= () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver ??=
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(cleanup);
afterAll(clearBlocks);

beforeEach(() => {
  clearBlocks();
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        editor: { label: "Heading", component: INSPECTOR },
        props: { text: { type: "text", role: "content" } },
        supports: { typography: true, background: true },
        render: () => null,
      },
      {
        // Drawn with the generated Content fields: no inspector of its own.
        name: "acme/text",
        version: 1,
        description: "A text.",
        example: { props: {} },
        editor: { label: "Text block" },
        props: { text: { type: "text", role: "content" } },
        render: () => null,
      },
      {
        // An inspector of its own that holds what is typed until it is left.
        name: "acme/quote",
        version: 1,
        description: "A quote.",
        example: { props: {} },
        editor: { label: "Quote", component: DRAFTING },
        props: { text: { type: "text", role: "content" } },
        render: () => null,
      },
    ] as never,
    { source: "inspector-renders-test" }
  );
  counted.sections.clear();
  counted.content = 0;
});

/** A heading of `size`, named `name`, with no background. */
function heading(id: string, name: string, size: string): BlockNode {
  return {
    id,
    type: "acme/heading",
    version: 1,
    name,
    props: { text: id },
    styles: { base: { [BASE_BREAKPOINT]: { fontSize: size } } },
  } as BlockNode;
}

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [heading("first", "Intro", "20px"), heading("second", "Outro", "32px")],
} as BlockDocument;

let editorRef: EditorState | null = null;

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/** The real editor and its settings panel, as the page builder mounts them. */
function Host({
  page = PAGE,
}: {
  page?: BlockDocument;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: page });
  editorRef = state;
  return <InspectorPanel editor={state} inspectors={inspectors} />;
}

function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
  // The control: the tab is the one showing.
  expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe(
    "true"
  );
}

describe("the settings panel's work for a selection", () => {
  it("builds the Content tab for a selection while it shows: the counter's control", () => {
    render(<Host />);
    act(() => editor().select("first"));
    counted.content = 0;
    act(() => editor().select("second"));
    expect(screen.getByText("Heading controls for second")).toBeTruthy();
    expect(counted.content).toBeGreaterThan(0);
  });

  it("builds nothing of the Content tab for a selection while Style shows", () => {
    render(<Host />);
    act(() => editor().select("first"));
    openTab("Style");
    counted.content = 0;
    act(() => editor().select("second"));
    // The control: the Style tab followed the selection.
    expect(editor().selectedId).toBe("second");
    expect(counted.content).toBe(0);
    // And the Content tab is built for the block when it shows again.
    openTab("Content");
    expect(screen.getByText("Heading controls for second")).toBeTruthy();
  });

  it("rebuilds Typography once and Background not at all between two Headings", () => {
    render(<Host />);
    act(() => editor().select("first"));
    openTab("Style");
    const typography = screen.getByRole("button", { name: /Typography/ });
    if (typography.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(typography);
    }
    // The control: both sections are drawn, Typography open.
    expect(typography.getAttribute("aria-expanded")).toBe("true");
    expect(counted.sections.get("typography")).toBeGreaterThan(0);
    expect(counted.sections.get("background")).toBeGreaterThan(0);
    counted.sections.clear();
    act(() => editor().select("second"));
    expect({
      typography: counted.sections.get("typography") ?? 0,
      background: counted.sections.get("background") ?? 0,
    }).toEqual({ typography: 1, background: 0 });
  });

  it("keeps a half-typed name with its block, and shows the next block's own", () => {
    render(<Host />);
    act(() => editor().select("first"));
    fireEvent.doubleClick(screen.getByRole("heading", { name: /Intro/ }));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Intr" },
    });
    act(() => editor().select("second"));
    expect(screen.queryByDisplayValue("Intr")).toBeNull();
    expect(screen.getByRole("heading", { name: /Outro/ })).toBeTruthy();
    act(() => editor().select("first"));
    // What the first block keeps is what was committed: its name as it was.
    expect(screen.getByRole("heading", { name: /Intro/ })).toBeTruthy();
  });
});

/** A page of two blocks of `type`, each holding its own id as its text. */
function pageOf(type: string): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: ["first", "second"].map(id => ({
      id,
      type,
      version: 1,
      props: { text: id },
    })),
  } as BlockDocument;
}

/** The text each block of the editor's page holds, by id. */
function texts(): Record<string, unknown> {
  return Object.fromEntries(
    editor().document.nodes.map(node => [node.id, node.props.text])
  );
}

/**
 * Leaves the Content tab for Style as a pointer does: the tab opens on the
 * press, and the field typed in loses focus to the tab after it.
 */
function leaveForStyle(): void {
  const style = screen.getByRole("tab", { name: "Style" });
  fireEvent.mouseDown(style);
  act(() => style.focus());
}

describe("what is typed on the Content tab, while Style shows another block", () => {
  it("lands a typed value on the block it was typed on, never on the next", () => {
    render(<Host page={pageOf("acme/text")} />);
    act(() => editor().select("first"));
    const field = screen.getByLabelText("Text");
    act(() => (field as HTMLInputElement).focus());
    fireEvent.change(field, { target: { value: "Typed on first" } });
    leaveForStyle();
    act(() => editor().select("second"));
    openTab("Content");
    expect(texts()).toEqual({ first: "Typed on first", second: "second" });
    // The second block's own value shows, not what was typed on the first.
    expect((screen.getByLabelText("Text") as HTMLInputElement).value).toBe(
      "second"
    );
  });

  it("lands a value left behind in a hidden field on its own block, even once another is selected", () => {
    render(<Host page={pageOf("acme/text")} />);
    act(() => editor().select("first"));
    const field = screen.getByLabelText("Text");
    act(() => (field as HTMLInputElement).focus());
    fireEvent.change(field, { target: { value: "Typed on first" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
    act(() => editor().select("second"));
    // Focus leaves the hidden field only now, with the second block selected.
    act(() => (field as HTMLInputElement).blur());
    openTab("Content");
    expect(texts()).toEqual({ first: "Typed on first", second: "second" });
  });

  it("keeps a block inspector's own draft to its block, and shows the next block's own", () => {
    render(<Host page={pageOf("acme/quote")} />);
    act(() => editor().select("first"));
    const field = screen.getByLabelText("Quote text");
    act(() => (field as HTMLInputElement).focus());
    fireEvent.change(field, { target: { value: "Drafted on first" } });
    leaveForStyle();
    act(() => editor().select("second"));
    openTab("Content");
    expect(texts()).toEqual({ first: "Drafted on first", second: "second" });
    expect(
      (screen.getByLabelText("Quote text") as HTMLInputElement).value
    ).toBe("second");
  });
});
