// @vitest-environment jsdom

/**
 * How much work the editor does for one author action, counted rather than
 * timed, so the count cannot flake on a slow machine. Each budget is none:
 *
 * - the Layout's header and footer drawn again, per selection, hover and
 *   insert;
 * - the site's stylesheet compiled again, per selection and hover;
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
} from "@nextlyhq/blocks-engine";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
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

import { Canvas } from "./canvas";
import { type CanvasRegion } from "./canvas-regions";
import { useEditorState, type EditorState } from "./editor-state";
import { HoveredBlockProvider, useHoveredBlock } from "./hovered-block";
import { InsertPanel } from "./insert-panel";
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
function CanvasHost(): React.JSX.Element {
  const state = useEditorState({ initialDocument: PAGE });
  editorRef = state;
  return (
    <HoveredBlockProvider>
      <HoverReader />
      <Canvas
        document={state.document}
        siteStyles={SHEET as never}
        regions={REGIONS}
        render={RENDER as never}
        selectedId={state.selectedId}
        selectedIds={state.selection.ids}
        onSelect={state.select}
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
    render(<CanvasHost />);
    expect(counted.pageDraws).toBeGreaterThan(0);
    expect(counted.regionDraws).toBeGreaterThanOrEqual(2);
    expect(counted.sheetCompiles).toBeGreaterThan(0);
  });

  it("a selection draws the header and footer again: budget none (known miss)", () => {
    act(() => editor().select("block-7"));
    expectKnownMiss(counted.regionDraws);
  });

  it("a selection compiles the site's stylesheet: budget none (known miss)", () => {
    act(() => editor().select("block-7"));
    expectKnownMiss(counted.sheetCompiles);
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

  it("an insert draws the header and footer again: budget none (known miss)", () => {
    act(() => {
      editor().apply({
        kind: "insert",
        node: text("inserted", "Inserted"),
        at: { index: 3 },
      });
    });
    // The control: the insert reached the canvas.
    expect(document.querySelector('[data-nx-node="inserted"]')).not.toBeNull();
    expectKnownMiss(counted.regionDraws);
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

  it("a selection walks the whole document: budget none (known miss)", () => {
    render(<KeyboardHost />);
    act(() => editor().select("block-1"));
    const walks = walksDuring(() => {
      act(() => editor().select("block-7"));
    });
    // The control: the selection reached the keyboard layer's editor.
    expect(editor().selectedId).toBe("block-7");
    expectKnownMiss(walks);
  });
});

/**
 * The editor and its Add panel, with every trial insert it asks for counted:
 * each insert among the operations it asks the editor to try. The panel opens
 * on `open`, after the author has selected a block, as it does in the editor.
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
  const counting: EditorState = {
    ...state,
    lockRefusalFor: ops => {
      trials.count += ops.filter(op => op.kind === "insert").length;
      return state.lockRefusalFor(ops);
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

describe("the trial inserts opening the Add panel costs", () => {
  it("the counter sees a trial insert: a click on a tile asks for one", () => {
    const trials = { count: 0 };
    const view = openAddPanel(trials);
    trials.count = 0;
    fireEvent.click(view.getByRole("option", { name: "Text" }));
    expect(trials.count).toBeGreaterThan(0);
  });

  it("opening the Add panel runs trial inserts: budget none (known miss)", () => {
    const trials = { count: 0 };
    const view = openAddPanel(trials);
    // The control: the panel is open, offering the registered block.
    expect(view.getByRole("option", { name: "Text" })).toBeTruthy();
    expectKnownMiss(trials.count);
  });
});
