// @vitest-environment jsdom

/**
 * The block panel's sections fold on their own, and stay as the author left
 * them across selections and visits: the rules, and the panel inside the
 * shell that keeps them.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { BuilderShell } from "./shell/builder-shell";
import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import {
  MAX_SECTION_FOLDS,
  readSectionFolds,
  sectionOpens,
  withSectionFold,
  withTabFold,
} from "./panel-folds";
import type { PreferenceStore } from "./shell-state";

describe("whether a section is open", () => {
  const nothing = {};
  it("opens the tab's first section and one holding a value, and closes the rest", () => {
    expect(
      sectionOpens(nothing, "style", "Layout", {
        holdsValue: false,
        first: true,
      })
    ).toBe(true);
    expect(
      sectionOpens(nothing, "style", "Spacing", {
        holdsValue: true,
        first: false,
      })
    ).toBe(true);
    expect(
      sectionOpens(nothing, "style", "Effects", {
        holdsValue: false,
        first: false,
      })
    ).toBe(false);
  });

  it("follows what the author left over that, per tab and section", () => {
    const folds = withSectionFold(nothing, "style", "Spacing", false);
    expect(
      sectionOpens(folds, "style", "Spacing", { holdsValue: true, first: true })
    ).toBe(false);
    // Another tab's section of the same name is its own.
    expect(
      sectionOpens(folds, "content", "Spacing", {
        holdsValue: true,
        first: false,
      })
    ).toBe(true);
  });

  it("follows Expand all and Collapse all for the tab, then a section folded after", () => {
    const collapsed = withTabFold(
      withSectionFold(nothing, "style", "Spacing", true),
      "style",
      false
    );
    // The tab's own entries give way to the whole tab's.
    expect(collapsed).toEqual({ "style:*": false });
    expect(
      sectionOpens(collapsed, "style", "Layout", {
        holdsValue: true,
        first: true,
      })
    ).toBe(false);
    const reopened = withSectionFold(collapsed, "style", "Layout", true);
    expect(
      sectionOpens(reopened, "style", "Layout", {
        holdsValue: false,
        first: false,
      })
    ).toBe(true);
    // Another tab is untouched.
    expect(
      sectionOpens(collapsed, "advanced", "HTML", {
        holdsValue: false,
        first: true,
      })
    ).toBe(true);
  });

  it("remembers at most a bounded number, dropping the oldest", () => {
    let folds = {};
    for (let index = 0; index <= MAX_SECTION_FOLDS; index += 1) {
      folds = withSectionFold(folds, "content", `Section ${index}`, false);
    }
    expect(Object.keys(folds)).toHaveLength(MAX_SECTION_FOLDS);
    expect(folds).not.toHaveProperty("content:Section 0");
    expect(folds).toHaveProperty(`content:Section ${MAX_SECTION_FOLDS}`);
  });

  it("reads back only what a fold can be", () => {
    expect(
      readSectionFolds({
        "style:Spacing": false,
        "style:*": true,
        "no colon": true,
        "style:Size": "yes",
        [`style:${"x".repeat(200)}`]: true,
      })
    ).toEqual({ "style:Spacing": false, "style:*": true });
    expect(readSectionFolds([true])).toEqual({});
    expect(readSectionFolds(null)).toEqual({});
  });
});

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

function nodeOf(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props: {}, ...extra } as BlockNode;
}

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("section", "core/section", {
      styles: { base: { base: { padding: { blockStart: "40px" } } } },
    }),
    nodeOf("heading", "core/heading", { props: { text: "Hello" } }),
    nodeOf("button", "core/button", { props: { label: "Go" } }),
  ],
} as BlockDocument;

function editorFor(id: string): EditorState {
  return {
    document: PAGE,
    selectedId: id,
    selection: { ids: [id], primary: id },
    applyAll: vi.fn(() => PAGE),
    select: vi.fn(),
    apply: vi.fn(() => PAGE),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
}

function memoryStore(): PreferenceStore & { value: string | null } {
  return {
    value: null,
    read() {
      return this.value;
    },
    write(next: string) {
      this.value = next;
    },
  };
}

/** The panel inside the shell, with `id` selected. */
function shellWith(id: string, store: PreferenceStore): React.JSX.Element {
  return (
    <BuilderShell
      onExit={vi.fn()}
      store={store}
      inspector={<InspectorPanel editor={editorFor(id)} />}
    />
  );
}

function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

function header(name: string): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^${name}(has changes)?$`),
  });
}

describe("the panel's sections inside the shell", () => {
  it("keeps a closed Spacing closed for the next block and after a reload", () => {
    const store = memoryStore();
    const view = render(shellWith("section", store));
    openTab("Style");
    // Spacing holds the Section's padding, so it starts open.
    expect(header("Spacing").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header("Spacing"));
    expect(header("Spacing").getAttribute("aria-expanded")).toBe("false");

    // Another block, then the Section again: still closed.
    view.rerender(shellWith("heading", store));
    view.rerender(shellWith("section", store));
    expect(header("Spacing").getAttribute("aria-expanded")).toBe("false");

    // A reload: a new shell reading the same store.
    view.unmount();
    render(shellWith("section", store));
    openTab("Style");
    expect(header("Spacing").getAttribute("aria-expanded")).toBe("false");
    // CONTROL: what was stored is the fold, by tab and section name.
    expect(JSON.parse(store.value ?? "{}").sectionFolds).toEqual({
      "style:Spacing": false,
    });
  });

  it("opens and closes every section of the tab from the panel's options menu", () => {
    render(shellWith("section", memoryStore()));
    openTab("Style");
    const options = screen.getByRole("button", { name: "Panel options" });

    fireEvent.keyDown(options, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    for (const section of ["Layout", "Spacing", "Background"]) {
      expect(header(section).getAttribute("aria-expanded")).toBe("false");
    }

    fireEvent.keyDown(options, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand all" }));
    for (const section of ["Layout", "Spacing", "Background"]) {
      expect(header(section).getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("draws every section header as a button with its expanded state", () => {
    render(shellWith("button", memoryStore()));
    openTab("Advanced");
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    const headers = within(advanced).getAllByRole("button", {
      expanded: true,
    });
    expect(headers.length).toBeGreaterThan(0);
  });

  it("lists a Button's Advanced sections Visibility, then HTML", () => {
    render(shellWith("button", memoryStore()));
    openTab("Advanced");
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    expect(
      [
        ...advanced.querySelectorAll(
          "[data-section] > h3 .nx-style-inspector__section-label"
        ),
      ].map(label => label.firstChild?.textContent)
    ).toEqual(["Visibility", "HTML"]);
  });

  it("marks a section that holds a value with a dot and the words has changes", () => {
    render(shellWith("section", memoryStore()));
    openTab("Style");
    const spacing = header("Spacing");
    expect(spacing.querySelector(".nx-style-inspector__dot")).not.toBe(null);
    expect(spacing.textContent).toContain("has changes");
    expect(header("Layout").textContent).not.toContain("has changes");
  });

  it("hides a collapsed section's controls while keeping them mounted", () => {
    render(shellWith("button", memoryStore()));
    openTab("Advanced");
    // HTML starts closed on a Button, so its CSS id is hidden already.
    expect(screen.queryByRole("textbox", { name: "CSS id" })).toBe(null);
    const options = screen.getByRole("button", { name: "Panel options" });
    fireEvent.keyDown(options, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Expand all" }));
    expect(screen.getByRole("textbox", { name: "CSS id" })).toBeDefined();
    fireEvent.keyDown(options, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Collapse all" }));
    // Out of sight and out of the Tab order, though still in the page.
    expect(screen.queryByRole("textbox", { name: "CSS id" })).toBe(null);
    const field = document.querySelector<HTMLInputElement>(
      '[data-section="html"] input'
    );
    expect(field).not.toBe(null);
    expect(field?.closest("[hidden]")).not.toBe(null);
  });
});

describe("a block's own Advanced settings named after a built-in section", () => {
  it("joins the built-in Visibility section rather than a second one", () => {
    clearBlocks();
    registerBlocks(
      [
        ...coreBlocks,
        {
          name: "test/tracked",
          version: 1,
          description: "A tracked block.",
          editor: { label: "Tracked" },
          example: { props: {} },
          props: {
            track: {
              type: "checkbox",
              label: "Count views",
              group: "advanced",
              section: "Visibility",
            },
          },
          defaultProps: {},
          render: () => null,
        },
      ] as never,
      { source: "core" }
    );
    const page = {
      ...PAGE,
      nodes: [...PAGE.nodes, nodeOf2("tracked", "test/tracked")],
    } as BlockDocument;
    render(
      <BuilderShell
        onExit={vi.fn()}
        store={memoryStore()}
        inspector={
          <InspectorPanel
            editor={{ ...editorFor("tracked"), document: page } as EditorState}
          />
        }
      />
    );
    openTab("Advanced");
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    expect(
      [
        ...advanced.querySelectorAll(
          "[data-section] > h3 .nx-style-inspector__section-label"
        ),
      ].map(label => label.firstChild?.textContent)
    ).toEqual(["Visibility", "HTML"]);
    const visibility = advanced.querySelector<HTMLElement>(
      '[data-section="visibility"]'
    );
    if (visibility === null) throw new Error("no Visibility section");
    expect(within(visibility).getByText("Count views")).toBeDefined();
  });
});

/** A block of a type registered here, at version 1. */
function nodeOf2(id: string, type: string): BlockNode {
  return { id, type, version: 1, props: {} } as BlockNode;
}
