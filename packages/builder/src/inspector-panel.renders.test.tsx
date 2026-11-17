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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

const HOLDING = "acme/picture#inspector";

/** The `commit` a block's own inspector last held, as one awaiting a pick. */
const held = vi.hoisted(() => ({
  commit: undefined as ((name: string, value: unknown) => void) | undefined,
}));

/** A block's own inspector that keeps its `commit` for later. */
function HoldingInspector({ commit }: BlockInspectorProps): React.JSX.Element {
  held.commit = commit;
  return <p>Picture controls</p>;
}

const inspectors: BlockInspectorResolver = path =>
  path === INSPECTOR
    ? HeadingInspector
    : path === DRAFTING
      ? DraftingInspector
      : path === HOLDING
        ? HoldingInspector
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
        // An inspector of its own that commits after an await.
        name: "acme/picture",
        version: 1,
        description: "A picture.",
        example: { props: {} },
        editor: { label: "Picture", component: HOLDING },
        props: {
          alt: { type: "text", role: "content" },
          src: { type: "text", role: "content" },
        },
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
  nodes: [
    heading("first", "Intro", "20px"),
    heading("second", "Outro", "32px"),
  ],
} as BlockDocument;

let editorRef: EditorState | null = null;

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/** The real editor and its settings panel, as the page builder mounts them. */
function Host({ page = PAGE }: { page?: BlockDocument }): React.JSX.Element {
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
    const typography = screen.getByRole("button", {
      name: /^Text(has changes)?$/,
    });
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

  it("keeps a half-typed style value with its block, in the section kept open", () => {
    render(<Host />);
    act(() => editor().select("first"));
    openTab("Style");
    const typography = screen.getByRole("button", {
      name: /^Text(has changes)?$/,
    });
    if (typography.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(typography);
    }
    fireEvent.change(screen.getByLabelText("Line height"), {
      target: { value: "1.7" },
    });
    act(() => editor().select("second"));
    // The section stays open, with the second block's own (empty) value.
    expect(typography.getAttribute("aria-expanded")).toBe("true");
    expect(
      (screen.getByLabelText("Line height") as HTMLInputElement).value
    ).toBe("");
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

describe("what a Style section shows for the next block", () => {
  it("starts the next block's CSS properties without the rows added to the last", () => {
    render(<Host />);
    act(() => editor().select("first"));
    openTab("Style");
    openCssProperties();
    addCssProperty("font-style");
    // The control: added, it is a row and no longer offered.
    expect(
      document.querySelector('[data-css-property="fontStyle"]')
    ).not.toBeNull();
    openPicker();
    expect(screen.queryByRole("option", { name: /^font-style / })).toBeNull();
    act(() => editor().select("second"));
    // The second block starts from its own rows: font-style is offered again.
    expect(
      document.querySelector('[data-css-property="fontStyle"]')
    ).toBeNull();
    openCssProperties();
    openPicker();
    expect(screen.getByRole("option", { name: /^font-style / })).toBeTruthy();
  });

  it("draws a closed section's heading again when its dot goes", () => {
    const page: BlockDocument = {
      ...PAGE,
      nodes: [
        {
          ...heading("first", "Intro", "20px"),
          styles: {
            base: {
              [BASE_BREAKPOINT]: { fontSize: "20px", backgroundColor: "red" },
            },
          },
        } as BlockNode,
        heading("second", "Outro", "32px"),
      ],
    } as BlockDocument;
    render(<Host page={page} />);
    act(() => editor().select("first"));
    openTab("Style");
    const background = () =>
      screen.getByRole("button", { name: /^Background(has changes)?$/ });
    // A section holding a value opens; closed by the author, it stays closed
    // for the next block too.
    expect(background().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(background());
    // The control: closed, and marked as holding values.
    expect(background().getAttribute("aria-expanded")).toBe("false");
    expect(background().textContent).toContain("has changes");
    counted.sections.clear();
    act(() => editor().select("second"));
    expect(background().textContent).not.toContain("has changes");
    expect(counted.sections.get("background")).toBe(1);
  });
});

/** Opens "CSS properties", where it is closed. */
function openCssProperties(): void {
  const section = screen.getByRole("button", { name: /^CSS properties/ });
  if (section.getAttribute("aria-expanded") !== "true")
    fireEvent.click(section);
}

/** Opens "+ Add CSS property"'s list, where it is closed. */
function openPicker(): void {
  const add = screen.getByRole("button", { name: "+ Add CSS property" });
  if (add.getAttribute("aria-expanded") !== "true") fireEvent.click(add);
}

/** Adds a property by its CSS name from "+ Add CSS property". */
function addCssProperty(cssName: string): void {
  openPicker();
  fireEvent.click(
    screen.getByRole("option", { name: new RegExp(`^${cssName} `) })
  );
}

/** A page of a block with one attribute, then a block holding the id `hero`. */
const ATTRIBUTED: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "first",
      type: "acme/text",
      version: 1,
      props: { text: "first" },
      attributes: { "data-x": "1" },
    },
    {
      id: "second",
      type: "acme/text",
      version: 1,
      props: { text: "second" },
      cssId: "hero",
    },
  ],
} as unknown as BlockDocument;

/** The first block's attributes, as the editor's page holds them. */
function firstAttributes(): unknown {
  return (editor().document.nodes[0] as BlockNode & { attributes?: unknown })
    .attributes;
}

describe("what Advanced writes as it goes away", () => {
  it("writes nothing more once Style has settled it, so an undo made there holds", async () => {
    render(<Host page={ATTRIBUTED} />);
    act(() => editor().select("first"));
    openTab("Advanced");
    // An id another block holds, refused and kept in the field with its
    // reason, so what the panel holds stays apart from what is stored.
    const id = screen.getByLabelText("Anchor (ID)");
    fireEvent.change(id, { target: { value: "hero" } });
    fireEvent.blur(id);
    const value = screen.getByLabelText("Value of attribute 1");
    act(() => (value as HTMLInputElement).focus());
    fireEvent.change(value, { target: { value: "2" } });
    leaveForStyle();
    // The control: leaving for Style saved the attribute.
    expect(firstAttributes()).toEqual({ "data-x": "2" });
    await act(async () => {
      await editor().undo();
    });
    expect(firstAttributes()).toEqual({ "data-x": "1" });
    act(() => editor().select("second"));
    openTab("Content");
    expect(firstAttributes()).toEqual({ "data-x": "1" });
  });

  it("shows an undo made on Style when Advanced comes back, for the same block", async () => {
    render(<Host page={ATTRIBUTED} />);
    act(() => editor().select("first"));
    openTab("Advanced");
    const id = screen.getByLabelText("Anchor (ID)");
    act(() => (id as HTMLInputElement).focus());
    fireEvent.change(id, { target: { value: "intro" } });
    leaveForStyle();
    // The control: leaving for Style saved the id.
    expect(editor().document.nodes[0]?.cssId).toBe("intro");
    await act(async () => {
      await editor().undo();
    });
    expect(editor().document.nodes[0]?.cssId).toBeUndefined();
    openTab("Advanced");
    expect(
      (screen.getByLabelText("Anchor (ID)") as HTMLInputElement).value
    ).toBe("");
  });

  it("still writes a draft typed while it shows, when another block is selected straight away", () => {
    render(<Host page={ATTRIBUTED} />);
    act(() => editor().select("first"));
    openTab("Advanced");
    const value = screen.getByLabelText("Value of attribute 1");
    act(() => (value as HTMLInputElement).focus());
    fireEvent.change(value, { target: { value: "2" } });
    act(() => editor().select("second"));
    expect(firstAttributes()).toEqual({ "data-x": "2" });
  });
});

describe("a commit a hidden Content tab made after it hid", () => {
  it("builds on the block as it is now, so an undo made on Style holds", async () => {
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "first",
          type: "acme/picture",
          version: 1,
          props: { alt: "old", src: "a.png" },
        },
      ],
    } as BlockDocument;
    render(<Host page={page} />);
    act(() => editor().select("first"));
    act(() => held.commit?.("alt", "new"));
    // The control: the inspector's own edit landed.
    expect(editor().document.nodes[0]?.props).toEqual({
      alt: "new",
      src: "a.png",
    });
    openTab("Style");
    await act(async () => {
      await editor().undo();
    });
    expect(editor().document.nodes[0]?.props.alt).toBe("old");
    // The pick the inspector was waiting on arrives, Style still showing.
    act(() => held.commit?.("src", "b.png"));
    expect(editor().document.nodes[0]?.props).toEqual({
      alt: "old",
      src: "b.png",
    });
  });
});
