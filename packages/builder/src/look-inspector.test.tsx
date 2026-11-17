// @vitest-environment jsdom

import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";
import { siteOrientationOf } from "./side-orientation";
import type { SharedStyleChange } from "./shared-style-target";
import type { SharedStylesHost } from "./style-target";

/*
 * The inspector while a look is edited on its own, from the Design panel:
 * no block selected, the look's bar, and the Style controls writing the look.
 */

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: {},
        supports: { effects: true },
        render: () => null,
      },
      {
        name: "acme/panel",
        version: 1,
        description: "A panel with spacing and a border.",
        example: { props: {} },
        editor: { label: "Panel" },
        props: {},
        supports: { spacing: true, border: true },
        render: () => null,
      },
    ] as never,
    { source: "look-inspector-test" }
  );
});
afterAll(clearBlocks);
afterEach(cleanup);

const own: NamedClass = {
  id: "look:acme/box:plain",
  slug: "box-plain",
  label: "Plain",
  orderIndex: 0,
  blockType: "acme/box",
  isDefault: true,
  styles: {},
};
const raised: NamedClass = {
  id: "look:acme/box:raised",
  slug: "box-raised",
  label: "Raised",
  orderIndex: 1,
  blockType: "acme/box",
  styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.5 } } } as NodeStyles,
};

const page = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "acme/box", version: 1, props: {} }],
} as unknown as BlockDocument;

function editorFor(selectedId: string | null): EditorState & {
  applyAll: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
} {
  return {
    document: page,
    selectedId,
    selection: {
      ids: selectedId === null ? [] : [selectedId],
      primary: selectedId,
    },
    applyAll: vi.fn(() => page),
    select: vi.fn(),
    apply: vi.fn(() => page),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & {
    applyAll: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
  };
}

function mount(lookId: string, selectedId: string | null = null) {
  const editor = editorFor(selectedId);
  const writeStyles = vi.fn(
    async (_id: string, _change: SharedStyleChange) =>
      undefined as string | undefined
  );
  const onExit = vi.fn();
  render(
    <InspectorPanel
      editor={editor}
      classLibrary={[own, raised]}
      sharedStyles={{
        mayChange: true,
        writeStyles: writeStyles as unknown as SharedStylesHost["writeStyles"],
      }}
      lookEditing={{ look: { id: lookId, blockType: "acme/box" }, onExit }}
    />
  );
  return { editor, writeStyles, onExit };
}

/** Set the Opacity field, under Effects, and leave it. */
function setOpacity(percent: string): void {
  // Open unless it already is, as it is when the look sets a value there.
  const effects = screen.getByRole("button", { name: /^Effects/ });
  if (effects.getAttribute("aria-expanded") !== "true")
    fireEvent.click(effects);
  const field = screen.getByRole("textbox", { name: "Opacity" });
  fireEvent.change(field, { target: { value: percent } });
  fireEvent.blur(field);
}

describe("editing a look with no block selected", () => {
  it("names the block's own look and who an edit reaches, in the bar's exact words", () => {
    mount(own.id);
    expect(screen.getByText("A look for Box blocks")).toBeDefined();
    const bar = screen.getByRole("group", { name: "Editing Plain" });
    expect(bar.querySelector(".nx-look-bar__line")?.textContent).toBe(
      "Editing Plain · every Box"
    );
  });

  it("says a worn look reaches every block that wears it", () => {
    mount(raised.id);
    const bar = screen.getByRole("group", { name: "Editing Raised" });
    expect(bar.querySelector(".nx-look-bar__line")?.textContent).toBe(
      "Editing Raised · every Box that wears it"
    );
  });

  it("writes an edit to the look, and never to the page", async () => {
    const { editor, writeStyles } = mount(raised.id);
    setOpacity("80");
    await Promise.resolve();
    expect(writeStyles).toHaveBeenCalledTimes(1);
    const [id, change] = writeStyles.mock.calls[0] ?? [];
    expect(id).toBe(raised.id);
    expect((change as SharedStyleChange)(raised.styles)).toMatchObject({
      kind: "write",
      styles: { base: { [BASE_BREAKPOINT]: { opacity: 0.8 } } },
    });
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("goes back to block editing from the bar's button or Esc", () => {
    const { onExit } = mount(own.id);
    fireEvent.click(
      screen.getByRole("button", { name: /Back to block editing/ })
    );
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("group", { name: "Editing Plain" }), {
      key: "Escape",
    });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("marks on the canvas the blocks the edit reaches, and clears them after", () => {
    const canvas = window.document.createElement("div");
    canvas.innerHTML = '<div data-nx-node="a"></div>';
    const view = render(
      <InspectorPanel
        editor={editorFor(null)}
        canvasRoot={canvas}
        classLibrary={[own, raised]}
        sharedStyles={{
          mayChange: true,
          writeStyles: async () => undefined,
        }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    // The page's box wears no look, so the box's own look reaches it.
    expect(canvas.querySelector("[data-nx-look-reach]")).not.toBeNull();
    view.unmount();
    expect(canvas.querySelector("[data-nx-look-reach]")).toBeNull();
  });

  it("says why the look's values can't be changed when the author may not", () => {
    render(
      <InspectorPanel
        editor={editorFor(null)}
        classLibrary={[own, raised]}
        sharedStyles={{ mayChange: false, writeStyles: async () => undefined }}
        lookEditing={{
          look: { id: raised.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    const bar = screen.getByRole("group", { name: "Editing Raised" });
    const held = bar.querySelector(".nx-look-bar__held");
    expect(held?.textContent).not.toBe("");
    expect(held).not.toBeNull();
  });

  it("marks the blocks a component draws, read from the composed page, whatever their ids", () => {
    const composed = {
      ...page,
      nodes: [
        ...page.nodes,
        { id: "inner\nbox", type: "acme/box", version: 1, props: {} },
      ],
    } as unknown as BlockDocument;
    const editor = { ...editorFor(null), composed: () => composed };
    const canvas = window.document.createElement("div");
    const inner = window.document.createElement("div");
    inner.setAttribute("data-nx-node", "inner\nbox");
    canvas.append(inner);
    render(
      <InspectorPanel
        editor={editor}
        canvasRoot={canvas}
        classLibrary={[own, raised]}
        sharedStyles={{ mayChange: true, writeStyles: async () => undefined }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    expect(inner.hasAttribute("data-nx-look-reach")).toBe(true);
  });

  it("holds a look whose id another block type's own look shares, and writes nothing", () => {
    const twin: NamedClass = { ...own, blockType: "acme/other", orderIndex: 2 };
    const writeStyles = vi.fn(async () => undefined);
    render(
      <InspectorPanel
        editor={editorFor(null)}
        classLibrary={[own, twin, raised]}
        sharedStyles={{ mayChange: true, writeStyles }}
        lookEditing={{
          look: { id: own.id, blockType: "acme/box" },
          onExit: () => {},
        }}
      />
    );
    const bar = screen.getByRole("group", { name: "Editing Plain" });
    expect(bar.querySelector(".nx-look-bar__held")?.textContent).toMatch(
      /same id/
    );
    expect(writeStyles).not.toHaveBeenCalled();
  });

  it("edits the selected block instead while one is selected", () => {
    mount(own.id, "a");
    expect(screen.queryByRole("group", { name: "Editing Plain" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Style" })).toBeDefined();
  });

  it("shows the panel for nothing selected when the look is no longer on the site", () => {
    mount("look:acme/box:gone");
    expect(screen.queryByRole("group", { name: /^Editing/ })).toBeNull();
    expect(
      document.querySelector('[data-empty="no-selection"]')
    ).not.toBeNull();
  });
});

/*
 * A look has no element of its own on the canvas, so its sides are named by
 * the site's direction, read from the canvas root: the same box a block of
 * that site shows, mirrored on a right-to-left site.
 */
describe("a look's sides, named by the site's direction", () => {
  const panelLook: NamedClass = {
    id: "look:acme/panel:plain",
    slug: "panel-plain",
    label: "Plain panel",
    orderIndex: 0,
    blockType: "acme/panel",
    isDefault: true,
    // A radius set per corner, so the corners are drawn and named.
    styles: {
      base: {
        [BASE_BREAKPOINT]: {
          borderRadius: {
            startStart: "1px",
            startEnd: "2px",
            endStart: "3px",
            endEnd: "4px",
          },
        },
      },
    } as NodeStyles,
  };

  /**
   * The look editor over a canvas root whose computed direction is the one
   * given. jsdom computes neither writing mode nor direction, so the canvas
   * root's are stubbed; every other element reads as jsdom computes it.
   */
  function mountOnSite(
    direction: "ltr" | "rtl" | undefined | (() => "ltr" | "rtl")
  ): HTMLElement {
    const canvas = window.document.createElement("div");
    if (direction !== undefined) {
      const directionNow =
        typeof direction === "function" ? direction : () => direction;
      const real = window.getComputedStyle.bind(window);
      vi.spyOn(window, "getComputedStyle").mockImplementation(((
        element: Element,
        pseudo?: string | null
      ) =>
        element === canvas
          ? ({
              writingMode: "horizontal-tb",
              direction: directionNow(),
              display: "flex",
              flexDirection: "column",
            } as CSSStyleDeclaration)
          : real(element, pseudo)) as typeof window.getComputedStyle);
    }
    render(
      <InspectorPanel
        editor={editorFor(null)}
        canvasRoot={canvas}
        classLibrary={[panelLook]}
        sharedStyles={{ mayChange: true, writeStyles: async () => undefined }}
        lookEditing={{
          look: { id: panelLook.id, blockType: "acme/panel" },
          onExit: () => {},
        }}
      />
    );
    return canvas;
  }

  /** Open the Border section, which is folded while Spacing is open. */
  function openBorder(): void {
    const border = screen.getByRole("button", { name: /^Border/ });
    if (border.getAttribute("aria-expanded") !== "true")
      fireEvent.click(border);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The visible names of one property's sides or corners, in order. */
  function labelsOf(property: string): (string | null)[] {
    return Array.from(
      window.document.querySelectorAll(
        `[data-property="${property}"] .nx-style-inspector__field-label-text`
      )
    ).map(label => label.textContent);
  }

  /** The spacing box's field for one side, and which logical side it writes. */
  function sideOf(name: string): string | null | undefined {
    const box = window.document.querySelector(".nx-spacing-box");
    expect(box).not.toBeNull();
    return within(box as HTMLElement)
      .getByLabelText(name)
      .closest("[data-side]")
      ?.getAttribute("data-side");
  }

  it("draws the spacing box with Top, Right, Bottom, Left on a left-to-right site", () => {
    mountOnSite("ltr");
    expect(sideOf("Padding top")).toBe("blockStart");
    expect(sideOf("Padding right")).toBe("inlineEnd");
    expect(sideOf("Margin bottom")).toBe("blockEnd");
    expect(sideOf("Margin left")).toBe("inlineStart");
    openBorder();
    expect(labelsOf("border").slice(0, 4)).toEqual([
      "Top",
      "Bottom",
      "Left",
      "Right",
    ]);
    expect(labelsOf("borderRadius")).toEqual([
      "Top left",
      "Top right",
      "Bottom left",
      "Bottom right",
    ]);
    expect(screen.queryByText("Block start")).toBeNull();
    expect(screen.queryByText("Inline end")).toBeNull();
  });

  it("mirrors the box on a right-to-left site, as a block's box does", () => {
    mountOnSite("rtl");
    // Inline start is the right edge on a right-to-left site.
    expect(sideOf("Padding right")).toBe("inlineStart");
    expect(sideOf("Margin left")).toBe("inlineEnd");
    expect(sideOf("Padding top")).toBe("blockStart");
    openBorder();
    expect(labelsOf("border").slice(0, 4)).toEqual([
      "Top",
      "Bottom",
      "Right",
      "Left",
    ]);
    expect(labelsOf("borderRadius")).toEqual([
      "Top right",
      "Top left",
      "Bottom right",
      "Bottom left",
    ]);
  });

  it("mirrors the box when the site's direction changes while the look is open", async () => {
    // The canvas is watched, as it is for a block: a page drawn again in the
    // other direction re-reads the site's direction.
    let direction: "ltr" | "rtl" = "ltr";
    const canvas = mountOnSite(() => direction);
    expect(sideOf("Padding left")).toBe("inlineStart");
    direction = "rtl";
    const block = window.document.createElement("div");
    block.setAttribute("data-nx-node", "a");
    canvas.append(block);
    await waitFor(() => expect(sideOf("Padding right")).toBe("inlineStart"));
  });

  it("takes only the site's axes, never the page root's layout", () => {
    // The root lays out the page, not the block a look styles: its display
    // and flex direction would turn the look's alignment icons with the page.
    const canvas = mountOnSite("rtl");
    expect(siteOrientationOf(canvas)).toEqual({
      writingMode: "horizontal-tb",
      direction: "rtl",
    });
  });

  it("draws a right-to-left site's box mirrored from the first paint", () => {
    // Read on the first render, before any effect runs: an effect-only read
    // would paint a left-to-right box first and mirror it a frame later.
    const canvas = window.document.createElement("div");
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((
      element: Element,
      pseudo?: string | null
    ) =>
      element === canvas
        ? ({
            writingMode: "horizontal-tb",
            direction: "rtl",
          } as CSSStyleDeclaration)
        : real(element, pseudo)) as typeof window.getComputedStyle);
    const seen: (string | null | undefined)[] = [];
    function FirstPaint(): null {
      // Runs after React's commit and before passive effects re-render.
      React.useLayoutEffect(() => {
        const box = window.document.querySelector(".nx-spacing-box");
        seen.push(
          box === null
            ? undefined
            : within(box as HTMLElement)
                .getByLabelText("Padding right")
                .closest("[data-side]")
                ?.getAttribute("data-side")
        );
      }, []);
      return null;
    }
    render(
      <>
        <InspectorPanel
          editor={editorFor(null)}
          canvasRoot={canvas}
          classLibrary={[panelLook]}
          sharedStyles={{ mayChange: true, writeStyles: async () => undefined }}
          lookEditing={{
            look: { id: panelLook.id, blockType: "acme/panel" },
            onExit: () => {},
          }}
        />
        <FirstPaint />
      </>
    );
    expect(seen).toEqual(["inlineStart"]);
  });

  it("names the sides left to right while the canvas can't say", () => {
    // The canvas root unreadable (jsdom computes no direction): a look takes
    // the left-to-right site, never the logical rows.
    mountOnSite(undefined);
    expect(sideOf("Padding left")).toBe("inlineStart");
    expect(screen.queryByText("Block start")).toBeNull();
  });
});
