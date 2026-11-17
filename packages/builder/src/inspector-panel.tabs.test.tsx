// @vitest-environment jsdom

/**
 * The block panel's three tabs, drawn for core blocks: which tabs a block
 * has, which tab shows as the selection moves, and the shared settings the
 * builder draws in Advanced for every block.
 *
 * @module inspector-panel.tabs.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import type { StyleStateBinding } from "./inspector-panel-types";

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

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A block as a page holds it, at the version its definition is at. */
function nodeOf(id: string, type: string, props = {}): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props } as BlockNode;
}

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("button", "core/button", { label: "Get a quote" }),
    nodeOf("spacer", "core/spacer"),
    nodeOf("section", "core/section"),
  ],
} as BlockDocument;

/** An editor with `id` selected on `document`. */
function editorFor(id: string, document: BlockDocument = PAGE): EditorState {
  return {
    document,
    selectedId: id,
    selection: { ids: [id], primary: id },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
}

/** The panel with `id` selected, re-selectable as an author clicks blocks. */
/**
 * Open Advanced's HTML section unless it is open: it starts closed on a block
 * whose HTML holds nothing.
 */
function openHtmlSection(): void {
  const header = document.querySelector<HTMLElement>(
    '[data-section="html"] [data-slot="accordion-trigger"]'
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
}

function mount(id: string, styleState?: StyleStateBinding) {
  const view = render(
    <InspectorPanel editor={editorFor(id)} styleState={styleState} />
  );
  return {
    select: (next: string) =>
      view.rerender(
        <InspectorPanel editor={editorFor(next)} styleState={styleState} />
      ),
  };
}

const tabNames = (): string[] =>
  screen.getAllByRole("tab").map(tab => tab.textContent ?? "");

const shownTabName = (): string | null =>
  screen
    .getAllByRole("tab")
    .find(tab => tab.getAttribute("aria-selected") === "true")?.textContent ??
  null;

const choose = (name: string): void => {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
};

describe("the tabs a selected block has", () => {
  it("are Content, Style and Advanced, in that order, for a Button", () => {
    mount("button");
    expect(tabNames()).toEqual(["Content", "Style", "Advanced"]);
  });

  it("are only Style and Advanced for a Spacer, which has nothing in Content", () => {
    mount("spacer");
    expect(tabNames()).toEqual(["Style", "Advanced"]);
    expect(screen.queryByRole("tabpanel", { name: "Content" })).toBeNull();
  });

  it("are only Style and Advanced for a Section, which says nothing itself", () => {
    // Its HTML tag is in Advanced › HTML and its content width in Style ›
    // Layout, so Content would hold nothing.
    mount("section");
    expect(tabNames()).toEqual(["Style", "Advanced"]);
    choose("Advanced");
    openHtmlSection();
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    const html = within(advanced).getByRole("region", { name: /^HTML/ });
    expect(within(html).getByText("HTML tag")).toBeTruthy();
  });
});

describe("a Columns block's layout", () => {
  const ROW: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        ...nodeOf("row", "core/columns"),
        slots: {
          children: [nodeOf("c1", "core/column"), nodeOf("c2", "core/column")],
        },
      },
    ],
  } as BlockDocument;
  const BREAKPOINTS = {
    viewport: [
      { id: "md", label: "Tablet", maxWidth: 1024 },
      { id: "sm", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  };

  it("is in Content, in a Columns section, and no longer in Style", () => {
    render(
      <InspectorPanel
        editor={editorFor("row", ROW)}
        breakpoints={BREAKPOINTS}
      />
    );
    expect(tabNames()).toContain("Content");
    const content = screen.getByRole("tabpanel", { name: "Content" });
    expect(within(content).getByText("Columns")).toBeTruthy();
    expect(
      within(content).getByRole("radiogroup", { name: "Layout" })
    ).toBeTruthy();
    expect(
      within(content).getByRole("radiogroup", { name: "Stack on" })
    ).toBeTruthy();
    choose("Style");
    // Folded sections included: the tiles are drawn in no Style section.
    const style = screen.getByRole("tabpanel", { name: "Style" });
    expect(
      within(style).queryByRole("radiogroup", { name: "Layout", hidden: true })
    ).toBeNull();
    expect(
      within(style).queryByRole("radiogroup", {
        name: "Stack on",
        hidden: true,
      })
    ).toBeNull();
  });

  it("writes the row's own layout while the panel edits Mobile", () => {
    const editor = editorFor("row", ROW);
    render(
      <InspectorPanel
        editor={editor}
        breakpoints={BREAKPOINTS}
        breakpoint="sm"
      />
    );
    const content = screen.getByRole("tabpanel", { name: "Content" });
    fireEvent.click(within(content).getByRole("radio", { name: "3 equal" }));
    expect(
      JSON.stringify(vi.mocked(editor.applyAll).mock.calls[0]?.[0])
    ).toContain('"base":{"base":{"gridTemplateColumns":"repeat(3, 1fr)"}}');
  });

  /**
   * Every Layout tile, Stack on choice and the reverse switch is held, with
   * the lock's reason as its description, and choosing any writes nothing.
   */
  function expectHeld(editor: EditorState): void {
    const content = screen.getByRole("tabpanel", { name: "Content" });
    const controls = [
      ...within(
        within(content).getByRole("radiogroup", { name: "Layout" })
      ).getAllByRole("radio"),
      ...within(
        within(content).getByRole("radiogroup", { name: "Stack on" })
      ).getAllByRole("radio"),
      within(content).getByRole("switch", { name: "Reverse when stacked" }),
    ];
    for (const control of controls) {
      const held = control.closest("fieldset");
      expect(held?.disabled).toBe(true);
      const reason = held?.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(reason)?.textContent).toMatch(/lock/i);
      fireEvent.click(control);
    }
    expect(vi.mocked(editor.applyAll)).not.toHaveBeenCalled();
    expect(vi.mocked(editor.apply)).not.toHaveBeenCalled();
  }

  it("is held, writing nothing, while the row is locked in Layers", () => {
    const [row] = ROW.nodes;
    const locked = {
      ...ROW,
      nodes: [{ ...row, locked: true }],
    } as BlockDocument;
    const editor = editorFor("row", locked);
    render(<InspectorPanel editor={editor} breakpoints={BREAKPOINTS} />);
    expectHeld(editor);
  });

  it("is held, writing nothing, inside an area locked to its content", () => {
    registerBlocks(
      [
        {
          name: "acme/frame",
          version: 1,
          description: "A frame whose children keep their design.",
          example: { props: {} },
          editor: { label: "Frame" },
          props: {},
          slots: { children: { lock: "contentOnly" } },
          render: () => null,
        },
      ] as never,
      { source: "columns-lock-test" }
    );
    const framed = {
      ...ROW,
      nodes: [
        {
          id: "frame",
          type: "acme/frame",
          version: 1,
          props: {},
          slots: { children: ROW.nodes },
        },
      ],
    } as BlockDocument;
    const editor = editorFor("row", framed);
    render(<InspectorPanel editor={editor} breakpoints={BREAKPOINTS} />);
    expectHeld(editor);
  });
});

describe("the tab that shows as the selection moves", () => {
  it("stays on Style from a Button through a Spacer and back", () => {
    const panel = mount("button");
    choose("Style");
    expect(shownTabName()).toBe("Style");

    panel.select("spacer");
    expect(shownTabName()).toBe("Style");

    panel.select("button");
    expect(shownTabName()).toBe("Style");
  });

  it("stays on Advanced from a Button to a Spacer", () => {
    const panel = mount("button");
    choose("Advanced");

    panel.select("spacer");
    expect(shownTabName()).toBe("Advanced");
  });

  it("shows a Spacer's first tab for an author on Content, and Content again on the next Button", () => {
    const panel = mount("button");
    expect(shownTabName()).toBe("Content");

    panel.select("spacer");
    expect(shownTabName()).toBe("Style");
    // Its panel is the one on screen, not merely its tab marked.
    expect(screen.getByRole("tabpanel", { name: "Style" })).toBeTruthy();

    panel.select("button");
    expect(shownTabName()).toBe("Content");
  });

  it("returns the canvas to Normal when a block's first tab took the author off Style", () => {
    // On a Spacer, an author on Content sees Style and picks Hover there; the
    // next Button shows Content, so the state control goes off screen and the
    // forced state must go with it.
    const onChange = vi.fn();
    const at = (state: "base" | "hover") => ({ state, onChange });
    const view = render(
      <InspectorPanel editor={editorFor("button")} styleState={at("base")} />
    );
    view.rerender(
      <InspectorPanel editor={editorFor("spacer")} styleState={at("base")} />
    );
    expect(shownTabName()).toBe("Style");
    fireEvent.pointerDown(screen.getByRole("button", { name: /^State: / }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hover" }));
    expect(onChange).toHaveBeenLastCalledWith("hover");
    // The host holds the state the author picked.
    view.rerender(
      <InspectorPanel editor={editorFor("spacer")} styleState={at("hover")} />
    );

    view.rerender(
      <InspectorPanel editor={editorFor("button")} styleState={at("hover")} />
    );
    expect(shownTabName()).toBe("Content");
    expect(onChange).toHaveBeenLastCalledWith("base");
  });

  it("keeps a forced state while the tab shown stays Style", () => {
    // The control: passing through a Spacer on Style is no leaving.
    const onChange = vi.fn();
    const hovering = { state: "hover" as const, onChange };
    const view = render(
      <InspectorPanel editor={editorFor("button")} styleState={hovering} />
    );
    expect(shownTabName()).toBe("Style");
    view.rerender(
      <InspectorPanel editor={editorFor("spacer")} styleState={hovering} />
    );
    view.rerender(
      <InspectorPanel editor={editorFor("button")} styleState={hovering} />
    );
    expect(onChange).not.toHaveBeenCalledWith("base");
  });
});

describe("the tab list by keyboard", () => {
  it("is one Tab stop, with arrows, Home and End moving between the tabs", async () => {
    // The list moves focus a task after the key, as Radix's roving focus
    // does, so each press waits for it.
    const press = async (on: HTMLElement, key: string): Promise<void> => {
      fireEvent.keyDown(on, { key });
      await act(() => new Promise(resolve => setTimeout(resolve, 0)));
    };
    mount("button");
    const [content, style, advanced] = screen.getAllByRole("tab") as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    // One stop: the list itself is the only one of them in the Tab order,
    // and Tab onto it lands on the tab shown.
    const list = screen.getByRole("tablist");
    expect(
      [list, ...screen.getAllByRole("tab")].filter(
        element => element.getAttribute("tabindex") === "0"
      )
    ).toEqual([list]);
    act(() => list.focus());
    expect(document.activeElement).toBe(content);

    await press(content, "ArrowRight");
    expect(document.activeElement).toBe(style);
    expect(shownTabName()).toBe("Style");

    await press(style, "End");
    expect(document.activeElement).toBe(advanced);
    expect(shownTabName()).toBe("Advanced");

    await press(advanced, "Home");
    expect(document.activeElement).toBe(content);
    expect(shownTabName()).toBe("Content");
  });
});

describe("the shared settings in Advanced", () => {
  it("are drawn by the builder for a block that declares no settings", () => {
    mount("spacer");
    choose("Advanced");
    openHtmlSection();
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });

    expect(within(advanced).getByText("Hide on")).toBeTruthy();
    expect(within(advanced).getByText("Show when")).toBeTruthy();
    expect(within(advanced).getByLabelText("Anchor (ID)")).toBeTruthy();
    expect(
      within(advanced).getByRole("button", { name: /Add attribute/ })
    ).toBeTruthy();
  });

  it("put Visibility before HTML, and the anchor under HTML", () => {
    mount("button");
    choose("Advanced");
    openHtmlSection();
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });

    // The tab's own section headers, in order; a control's own title (Show
    // when names itself) is not one.
    expect(
      [
        ...advanced.querySelectorAll(
          "[data-section] > h3 .nx-style-inspector__section-label"
        ),
      ].map(label => label.firstChild?.textContent)
    ).toEqual(["Visibility", "HTML"]);
    const html = within(advanced).getByRole("region", { name: "HTML" });
    expect(within(html).getByLabelText("Anchor (ID)")).toBeTruthy();
    const visibility = within(advanced).getByRole("region", {
      name: "Visibility",
    });
    expect(within(visibility).getByText("Hide on")).toBeTruthy();
    expect(within(visibility).getByText("Show when")).toBeTruthy();
  });

  it("offer a Section's Keep out of search previews in Advanced", () => {
    mount("section");
    choose("Advanced");
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    expect(
      within(advanced).getByText("Keep out of search previews")
    ).toBeTruthy();
  });

  it("are no longer in Content, which has no folded Advanced section", () => {
    mount("button");
    const content = screen.getByRole("tabpanel", { name: "Content" });

    expect(within(content).getByText("Label")).toBeTruthy();
    expect(within(content).queryByText("Advanced")).toBeNull();
    expect(content.querySelector("details")).toBeNull();
    expect(within(content).queryByText("Hide on")).toBeNull();
    expect(within(content).queryByText("Show when")).toBeNull();
    expect(within(content).queryByLabelText("Anchor (ID)")).toBeNull();
  });
});

describe("where the block is hidden, at the top of every tab", () => {
  const SITE = {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 1023 },
      { id: "mobile", label: "Mobile", maxWidth: 767 },
    ],
    container: [],
  };
  const LINE = "Hidden on Mobile. Visitors on that device won't see it.";

  function mountHidden(): void {
    const page = {
      ...PAGE,
      nodes: [
        {
          ...nodeOf("button", "core/button", { label: "Get a quote" }),
          visibility: { devices: { mobile: false } },
        },
      ],
    } as BlockDocument;
    render(
      <InspectorPanel editor={editorFor("button", page)} breakpoints={SITE} />
    );
  }

  const shownPanel = (name: string): HTMLElement =>
    screen.getByRole("tabpanel", { name });

  it("is said on Content, Style and Advanced alike", () => {
    mountHidden();
    for (const tab of ["Content", "Style", "Advanced"]) {
      choose(tab);
      const panel = shownPanel(tab);
      expect(panel.textContent, tab).toContain(LINE);
      // At the top of the tab, before any of its settings.
      expect(panel.querySelector(".nx-hidden-status"), tab).toBe(
        panel.firstElementChild
      );
    }
  });

  it("is not said for a block shown on every device", () => {
    render(<InspectorPanel editor={editorFor("button")} breakpoints={SITE} />);
    for (const tab of ["Content", "Style", "Advanced"]) {
      choose(tab);
      expect(
        shownPanel(tab).querySelector(".nx-hidden-status"),
        tab
      ).toBeNull();
    }
  });

  it.each(["Content", "Style"])(
    'goes from %s to Hide on with "Change"',
    async tab => {
      mountHidden();
      choose(tab);
      fireEvent.click(
        within(shownPanel(tab)).getByRole("button", { name: "Change" })
      );
      expect(shownTabName()).toBe("Advanced");
      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(shownPanel("Advanced")).getByRole("button", {
            name: "Hide on Desktop",
          })
        )
      );
    }
  );

  it('offers no "Change" on Advanced, where Hide on is', () => {
    mountHidden();
    choose("Advanced");
    expect(
      within(shownPanel("Advanced")).queryByRole("button", { name: "Change" })
    ).toBeNull();
  });
});
