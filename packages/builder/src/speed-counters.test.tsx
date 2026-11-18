// @vitest-environment jsdom

/**
 * How much work the editor does for one author action, counted rather than
 * timed, so the count cannot flake on a slow machine. Each budget is none:
 *
 * - the Layout's header and footer drawn again, per selection, hover,
 *   the pointer on them, and insert;
 * - the site's stylesheet compiled again, per selection, hover and insert;
 * - the page drawn again, per selection and hover;
 * - the whole document walked by the engine's safety measurement, per
 *   selection;
 * - a trial insert run to decide the Add panel's tiles, when it opens.
 *
 * The editor is the real one (`useEditorState`) driving the real canvas,
 * keyboard layer and Add panel; only what is counted is wrapped, and passed
 * through. A count the builder still spends today is a known miss
 * (`expectKnownMiss`): it is held above its budget, so the case turns red the
 * day the work is gone, and the fix swaps it for `expectWithinBudget`, which
 * holds the budget from then on. Unlike `it.fails`, a case that throws for
 * any other reason (an insert that never drew, a harness that broke) fails
 * here rather than passing as "still slow". Each counter is also shown to see
 * the work at all, so a count of none cannot come from a wrapper that never
 * runs.
 *
 * @module speed-counters.test
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  documentWork,
  measureBytes,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

/*
 * The work counted, wrapped and passed through: the renderer's page and
 * region draws (by the document each is drawn from), and the engine's two
 * site-sheet compilers, which the renderer calls on every draw it makes.
 */
const counted = vi.hoisted(() => ({
  pageDraws: 0,
  regionDraws: 0,
  sheetCompiles: 0,
}));

vi.mock("@nextlyhq/blocks-react", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/blocks-react")>();
  const PageRenderer: typeof real.PageRenderer = props => {
    const first = props.document.nodes[0]?.id ?? "";
    if (first.startsWith("nextly-region-")) counted.regionDraws += 1;
    else counted.pageDraws += 1;
    return real.PageRenderer(props);
  };
  return { ...real, PageRenderer };
});

vi.mock("@nextlyhq/blocks-engine", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/blocks-engine")>();
  return {
    ...real,
    compileSiteSheet: (...args: Parameters<typeof real.compileSiteSheet>) => {
      counted.sheetCompiles += 1;
      return real.compileSiteSheet(...args);
    },
    compileSiteTokenSheet: (
      ...args: Parameters<typeof real.compileSiteTokenSheet>
    ) => {
      counted.sheetCompiles += 1;
      return real.compileSiteTokenSheet(...args);
    },
  };
});

import { Canvas } from "./canvas/canvas";
import { type CanvasRegion } from "./canvas/canvas-regions";
import { useEditorState, type EditorState } from "./editor-state";
import { HoveredBlockProvider, useHoveredBlock } from "./canvas/hovered-block";
import { PageInserters } from "./canvas/page-inserters";
import { InsertPanel } from "./panels/add/insert-panel";
import { InspectorPanel } from "./inspector-panel";
import { BlockKeyboardActions } from "./keyboard-actions";
import { ShortcutProvider } from "@nextlyhq/ui";

afterEach(cleanup);

/**
 * A count the editor still spends beyond its budget today, held there: the
 * day the work is gone this fails, and the fix replaces it with
 * `expectWithinBudget`, which holds the budget from then on.
 */
function expectKnownMiss(count: number, budget = 0): void {
  expect(
    count,
    `now within its budget of ${String(budget)}: replace expectKnownMiss with expectWithinBudget`
  ).toBeGreaterThan(budget);
}

/** A count held to its budget. */
function expectWithinBudget(count: number, budget = 0): void {
  expect(count).toBeLessThanOrEqual(budget);
}

beforeAll(() => {
  // The Add panel's list scrolls its active tile into view; jsdom draws
  // nothing to scroll.
  Element.prototype.scrollIntoView ??= () => {};
  registerBlocks(
    [
      {
        name: "acme/text",
        version: 1,
        description: "A block.",
        editor: { label: "Text" },
        example: { props: {} },
        render: ({
          className,
          props,
        }: {
          className: string;
          props: { text?: string };
        }) => createElement("p", { className }, props.text),
      },
    ] as never,
    { source: "speed-counters-test" }
  );
});

afterAll(clearBlocks);

function text(id: string, value: string): BlockNode {
  return { id, type: "acme/text", version: 1, props: { text: value } };
}

/** A page of twelve blocks: enough that a walk of it is not a walk of one. */
const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: Array.from({ length: 12 }, (_, i) =>
    text(`block-${String(i + 1)}`, `Block ${String(i + 1)}`)
  ),
} as BlockDocument;

function region(area: "header" | "footer"): CanvasRegion {
  const componentId = `${area}-component`;
  return {
    area,
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: `nextly-region-${area}`,
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId },
        },
      ],
    } as BlockDocument,
    definitions: new Map([
      [
        componentId,
        {
          formatVersion: 1,
          kind: "component",
          nodes: [text(`${area}-text`, area)],
        } as unknown as BlockDocument,
      ],
    ]),
    label: `${area === "header" ? "Header" : "Footer"}, from Layout Main`,
    badge: `${area === "header" ? "Header" : "Footer"} · from Layout`,
    name: area === "header" ? "Header" : "Footer",
    edit: {
      href: "/admin/collections/layouts/main",
      text: "Edit Layout ↗",
      name: "Edit Layout Main (opens in a new tab)",
    },
  };
}

/*
 * Everything the canvas is handed that the editor holds steady, held steady
 * here too, so a count is the canvas's own work and not this harness's.
 */
const REGIONS = [region("header"), region("footer")];
const SHEET = { breakpoints: { viewport: [], container: [] } };
const RENDER = { styleContext: SHEET };

let editorRef: EditorState | null = null;

function editor(): EditorState {
  if (editorRef === null) throw new Error("no editor rendered");
  return editorRef;
}

/** The hovered block, as the canvas's marks read it: the hover cases' control. */
function HoverReader(): React.JSX.Element {
  return <output data-hovered={useHoveredBlock() ?? ""} />;
}

/** Hovers two blocks, and shows the hover reached the editor's hover store. */
function hoverTwoBlocks(): void {
  fireEvent.pointerMove(canvasBlock("block-5"));
  fireEvent.pointerMove(canvasBlock("block-9"));
  expect(
    document.querySelector("output[data-hovered]")?.getAttribute("data-hovered")
  ).toBe("block-9");
}

/** The editor and its canvas, wired as the page builder wires them. */
function CanvasHost({
  sheet = SHEET,
  inserters = false,
}: {
  /** The site sheet; a new one is compiled once, then kept. */
  sheet?: typeof SHEET;
  /** The "+" in the page's gaps drawn over the canvas, as the editor draws it. */
  inserters?: boolean;
}): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  return (
    <HoveredBlockProvider>
      <HoverReader />
      <Canvas
        document={state.document}
        siteStyles={sheet as never}
        regions={REGIONS}
        render={RENDER as never}
        selectedId={state.selectedId}
        selectedIds={state.selection.ids}
        onSelect={state.select}
        {...(inserters
          ? {
              overlay: (
                <PageInserters
                  document={state.document}
                  selectedId={state.selectedId}
                  start={{ onStart: () => undefined }}
                  onAddAfter={() => undefined}
                />
              ),
            }
          : {})}
      />
    </HoveredBlockProvider>
  );
}

function resetCounts(): void {
  counted.pageDraws = 0;
  counted.regionDraws = 0;
  counted.sheetCompiles = 0;
}

function canvasBlock(id: string): Element {
  const element = document.querySelector(`[data-nx-node="${id}"]`);
  if (element === null) throw new Error(`block ${id} is not drawn`);
  return element;
}

describe("the work one selection, hover or insert costs on the canvas", () => {
  beforeEach(() => {
    render(<CanvasHost />);
    act(() => editor().select("block-1"));
    resetCounts();
  });

  it("the counters see the canvas's work: drawing it draws the page, both regions and the sheet", () => {
    cleanup();
    resetCounts();
    // A site sheet not drawn before, since a drawn one is kept.
    render(<CanvasHost sheet={{ ...SHEET }} />);
    expect(counted.pageDraws).toBeGreaterThan(0);
    expect(counted.regionDraws).toBeGreaterThanOrEqual(2);
    expect(counted.sheetCompiles).toBeGreaterThan(0);
  });

  it("a selection draws the header and footer again: budget none", () => {
    act(() => editor().select("block-7"));
    // The control: the selection reached the editor the canvas draws from.
    expect(editor().selectedId).toBe("block-7");
    expectWithinBudget(counted.regionDraws);
  });

  it("a selection compiles the site's stylesheet: budget none", () => {
    act(() => editor().select("block-7"));
    expect(editor().selectedId).toBe("block-7");
    expectWithinBudget(counted.sheetCompiles);
  });

  it("a selection draws the page again: budget none, with the canvas's inputs held steady", () => {
    act(() => editor().select("block-7"));
    // The control: the selection reached the editor the canvas draws from.
    expect(editor().selectedId).toBe("block-7");
    expectWithinBudget(counted.pageDraws);
  });

  it("a hover draws the header and footer again: budget none", () => {
    hoverTwoBlocks();
    expectWithinBudget(counted.regionDraws);
  });

  it("a hover compiles the site's stylesheet: budget none", () => {
    hoverTwoBlocks();
    expectWithinBudget(counted.sheetCompiles);
  });

  it("a hover draws the page again: budget none", () => {
    hoverTwoBlocks();
    expectWithinBudget(counted.pageDraws);
  });

  it("the pointer resting on and leaving the header and footer draws them again: budget none", () => {
    for (const area of ["header", "footer"]) {
      const region = document.querySelector(`[data-nx-region="${area}"]`);
      if (region === null) throw new Error(`no ${area} drawn`);
      fireEvent.mouseEnter(region);
      fireEvent.pointerMove(region);
      fireEvent.mouseLeave(region);
    }
    expectWithinBudget(counted.regionDraws);
    expectWithinBudget(counted.sheetCompiles);
  });

  it("an insert compiles the site's stylesheet: budget none", () => {
    act(() => {
      editor().apply({
        kind: "insert",
        node: text("inserted", "Inserted"),
        at: { index: 3 },
      });
    });
    expect(document.querySelector('[data-nx-node="inserted"]')).not.toBeNull();
    expectWithinBudget(counted.sheetCompiles);
  });

  it("an insert draws the header and footer again: budget none", () => {
    act(() => {
      editor().apply({
        kind: "insert",
        node: text("inserted", "Inserted"),
        at: { index: 3 },
      });
    });
    // The control: the insert reached the canvas.
    expect(document.querySelector('[data-nx-node="inserted"]')).not.toBeNull();
    expectWithinBudget(counted.regionDraws);
  });
});

/**
 * The editor, its canvas and its settings panel, wired as the page builder
 * wires them: the panel's interaction state held by the editor, which a
 * change of tab sets. Each set re-renders the editor around the canvas.
 */
/** How many times the editor around the canvas rendered. */
let hostRenders = 0;

function InspectorHost(): React.JSX.Element {
  hostRenders += 1;
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  // A new holder on every set, so each tab change re-renders this editor
  // even when the state it carries is the same.
  const [styleState, setStyleState] = useState<{ value: StyleState }>({
    value: "base",
  });
  return (
    <HoveredBlockProvider>
      <InspectorPanel
        editor={state}
        styleState={{
          state: styleState.value,
          onChange: value => setStyleState({ value }),
        }}
      />
      <Canvas
        document={state.document}
        siteStyles={SHEET as never}
        regions={REGIONS}
        render={RENDER as never}
        forcedState={styleState.value}
        selectedId={state.selectedId}
        selectedIds={state.selection.ids}
        onSelect={state.select}
      />
    </HoveredBlockProvider>
  );
}

describe("the + in a gap the pointer comes near", () => {
  it("showing it draws the page again: budget none", () => {
    // jsdom generates no layout boxes; each block is given one, so the gaps
    // between them are measured.
    const boxes = vi
      .spyOn(Element.prototype, "getClientRects")
      .mockImplementation(() =>
        Object.assign([new DOMRect()], { item: () => new DOMRect() })
      );
    onTestFinished(() => boxes.mockRestore());
    render(<CanvasHost inserters />);
    resetCounts();
    const root = document.querySelector(".nx-canvas");
    if (root === null) throw new Error("no canvas");
    // jsdom lays nothing out, so every gap is at the canvas's corner, where
    // the pointer is put.
    fireEvent.pointerMove(root, { clientX: 0, clientY: 0 });
    // The control: a "+" did show.
    expect(
      document.querySelector(".nx-page-inserters__gap[data-near]")
    ).not.toBe(null);
    expectWithinBudget(counted.pageDraws);
    expectWithinBudget(counted.regionDraws);
  });
});

describe("the page drawn again while the editor around it re-renders", () => {
  it("switching the settings panel's tab draws no block", () => {
    const view = render(<InspectorHost />);
    act(() => editor().select("block-3"));
    resetCounts();
    hostRenders = 0;
    // Every tab the block has: it declares no settings, so no Content.
    for (const name of ["Style", "Advanced", "Style", "Advanced"]) {
      fireEvent.mouseDown(view.getByRole("tab", { name }));
      // The control: the tab opened.
      expect(
        view.getByRole("tab", { name }).getAttribute("aria-selected")
      ).toBe("true");
    }
    // The control: the editor around the canvas rendered again.
    expect(hostRenders).toBeGreaterThan(0);
    expectWithinBudget(counted.pageDraws);
  });
});

/**
 * Whole-document walks: the engine counts each full safety measurement of a
 * document (`documentWork`), the walk that probes every object for a value
 * the writer refuses. A reading before and after an action costs it.
 */
function walksDuring(action: () => void): number {
  const before = documentWork().walks;
  action();
  return documentWork().walks - before;
}

/** The editor and its keyboard layer, which answers what a selection may do. */
function KeyboardHost(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  return (
    <ShortcutProvider>
      <BlockKeyboardActions editor={state} onSaveAsPattern={() => undefined} />
    </ShortcutProvider>
  );
}

describe("the whole-document walks one selection costs", () => {
  it("the counter sees a walk: a full measurement of the page is one", () => {
    expect(walksDuring(() => measureBytes(PAGE, 1_000_000))).toBe(1);
  });

  it("a selection walks the whole document: budget none", () => {
    render(<KeyboardHost />);
    act(() => editor().select("block-1"));
    const walks = walksDuring(() => {
      act(() => editor().select("block-7"));
    });
    // The control: the selection reached the keyboard layer's editor.
    expect(editor().selectedId).toBe("block-7");
    expectWithinBudget(walks);
  });
});

/**
 * The editor and its Add panel, with every trial insert it asks for counted:
 * each insert among the operations it asks the editor to try, or hands the
 * editor to apply, since an apply tries its edit before it keeps it. The
 * panel opens on `open`, after the author has selected a block, as it does in
 * the editor.
 */
function AddPanelHost({
  trials,
  open,
}: {
  trials: { count: number };
  open: boolean;
}): React.JSX.Element | null {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  if (!open) return null;
  const inserts = (ops: readonly { kind: string }[]): number =>
    ops.filter(op => op.kind === "insert").length;
  const counting: EditorState = {
    ...state,
    lockRefusalFor: ops => {
      trials.count += inserts(ops);
      return state.lockRefusalFor(ops);
    },
    apply: op => {
      trials.count += inserts([op]);
      return state.apply(op);
    },
    applyAll: ops => {
      trials.count += inserts(ops);
      return state.applyAll(ops);
    },
  };
  return <InsertPanel editor={counting} onInsert={() => undefined} />;
}

/** Opens the Add panel with a block selected; returns its view. */
function openAddPanel(trials: { count: number }) {
  const view = render(<AddPanelHost trials={trials} open={false} />);
  act(() => editor().select("block-4"));
  trials.count = 0;
  view.rerender(<AddPanelHost trials={trials} open />);
  return view;
}

describe("the trial inserts the Add panel costs", () => {
  it("adding a tile's block tries its insert once: the counter sees it", () => {
    const trials = { count: 0 };
    const view = openAddPanel(trials);
    trials.count = 0;
    fireEvent.click(view.getByRole("option", { name: "Text" }));
    // The control: the block went in.
    expect(editor().document.nodes).toHaveLength(PAGE.nodes.length + 1);
    expect(trials.count).toBe(1);
  });

  it("opening the Add panel runs trial inserts: budget none", () => {
    const trials = { count: 0 };
    const view = openAddPanel(trials);
    // The control: the panel is open, offering the registered block.
    expect(view.getByRole("option", { name: "Text" })).toBeTruthy();
    expectWithinBudget(trials.count);
  });

  it("an insert while the Add panel is open runs no trial insert for the other tiles", () => {
    const trials = { count: 0 };
    const view = openAddPanel(trials);
    act(() => {
      editor().apply({
        kind: "insert",
        node: text("elsewhere", "Elsewhere"),
        at: { index: 0 },
      });
    });
    trials.count = 0;
    view.rerender(<AddPanelHost trials={trials} open />);
    // The control: the panel drew the page after the insert.
    expect(editor().document.nodes[0]?.id).toBe("elsewhere");
    expect(view.getByRole("option", { name: "Text" })).toBeTruthy();
    expectWithinBudget(trials.count);
  });
});
