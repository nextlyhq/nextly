// @vitest-environment jsdom

/**
 * The Style tab's "Block style" section, drawn for core blocks with the looks
 * they ship: first in the tab, one picture tile per style, the block's own
 * style marked as the default, the worn one chosen, and the line under the
 * tiles that says what a block style is and opens Design's Block styles at
 * the block's type.
 *
 * @module look-tiles-view.test
 */
import {
  blockLooks,
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
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

import type { EditorState } from "./editor-state";
import { InspectorPanel } from "./inspector-panel";

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

/** The looks the core blocks ship, as a site's library holds them. */
const LIBRARY: readonly NamedClass[] = blockLooks(coreBlocks as never);

/** A core block's look id by its name: `look:core/section:hero`. */
function lookId(type: string, name: string): string {
  const found = LIBRARY.find(
    entry => entry.blockType === type && entry.id.endsWith(`:${name}`)
  );
  if (found === undefined) throw new Error(`${type} has no ${name} look`);
  return found.id;
}

/** A block as a page holds it, at the version its definition is at. */
function nodeOf(type: string, classes?: string[]): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return {
    id: "a",
    type,
    version: block.version,
    props: type === "core/button" ? { label: "Get a quote" } : {},
    ...(classes === undefined ? {} : { classes }),
  } as BlockNode;
}

/** An editor with the one block selected. */
function editorFor(node: BlockNode): EditorState {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  } as BlockDocument;
  return {
    document,
    selectedId: node.id,
    selection: { ids: [node.id], primary: node.id },
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

/** The panel on the Style tab, with the block selected. */
function mountStyle(
  node: BlockNode,
  onEditBlockStyles?: (blockType: string) => void
): HTMLElement {
  render(
    <InspectorPanel
      editor={editorFor(node)}
      classLibrary={LIBRARY}
      {...(onEditBlockStyles === undefined ? {} : { onEditBlockStyles })}
    />
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Style" }));
  return screen.getByRole("tabpanel", { name: "Style" });
}

const tiles = () => screen.getByRole("radiogroup", { name: "Block style" });

/** Each tile's name and tag, as the tile reads them. */
const tileNames = (): string[] =>
  within(tiles())
    .getAllByRole("radio")
    .map(
      radio => radio.querySelector(".nx-look-tile__name")?.textContent ?? ""
    );

/** The section headings of the Style tab, in the page's order. */
const headings = (tab: HTMLElement): string[] =>
  [...tab.querySelectorAll(".nx-style-inspector__section-label")].map(
    label => label.firstChild?.textContent ?? ""
  );

describe("the Block style section", () => {
  it("is the Style tab's first section on a Section: Plain, marked the default, and Hero", () => {
    const tab = mountStyle(nodeOf("core/section"));
    expect(headings(tab)[0]).toBe("Block style");
    // The tiles sit in the section, and the section is above the editing
    // bar, which is above every other section.
    const section = tab.querySelector('[data-section="block-style"]');
    expect(section?.contains(tiles())).toBe(true);
    const bar = within(tab).getByRole("region", {
      name: "What you're editing",
    });
    expect(
      section !== null &&
        (section.compareDocumentPosition(bar) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0
    ).toBe(true);
    expect(tileNames()).toEqual(["PlainDefault", "Hero"]);
    // Wearing no style is wearing the default.
    expect(
      within(tiles()).getByRole("radio", { checked: true }).textContent
    ).toContain("Plain");
  });

  it("chooses the style a Section wears", () => {
    mountStyle(nodeOf("core/section", [lookId("core/section", "hero")]));
    const chosen = within(tiles()).getByRole("radio", { checked: true });
    expect(chosen.querySelector(".nx-look-tile__name")?.textContent).toBe(
      "Hero"
    );
    expect(chosen.querySelector(".nx-look-tile__check")).not.toBeNull();
  });

  it("draws one tile for each of a Button's four styles, its own first", () => {
    mountStyle(nodeOf("core/button", [lookId("core/button", "outline")]));
    expect(tileNames()).toEqual([
      "PrimaryDefault",
      "Secondary",
      "Outline",
      "Text",
    ]);
    expect(
      within(tiles())
        .getByRole("radio", { checked: true })
        .querySelector(".nx-look-tile__name")?.textContent
    ).toBe("Outline");
  });

  it("says what a block style is, under the tiles, by the block's own name", () => {
    const tab = mountStyle(nodeOf("core/section"), () => {});
    const line = tab.querySelector(".nx-block-style__line");
    expect(line?.textContent).toBe(
      "A saved style for every Section. Edit block styles"
    );
    // After the tiles, in the same section.
    expect(
      (tiles().compareDocumentPosition(line as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0
    ).toBe(true);
  });

  it("opens the block's type in Design's Block styles from Edit block styles", () => {
    const onEdit = vi.fn();
    const tab = mountStyle(nodeOf("core/button"), onEdit);
    fireEvent.click(
      within(tab).getByRole("button", { name: "Edit block styles" })
    );
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("core/button");
  });

  it("offers no way to edit block styles where the host has none", () => {
    const tab = mountStyle(nodeOf("core/section"));
    expect(
      within(tab).queryByRole("button", { name: "Edit block styles" })
    ).toBeNull();
    expect(tab.querySelector(".nx-block-style__line")?.textContent).toBe(
      "A saved style for every Section."
    );
  });

  it("draws no section for a block whose type has no block styles", () => {
    const tab = mountStyle(nodeOf("core/spacer"));
    expect(headings(tab)).not.toContain("Block style");
    expect(
      screen.queryByRole("radiogroup", { name: "Block style" })
    ).toBeNull();
  });
});

describe("the Style tab's words", () => {
  // A block style is never called a Look, nor a shared style a Class, in the
  // panel: the words an author meets are "Block style" and "Shared style".
  it.each(["core/section", "core/button", "core/image"])(
    "never says Look or Classes on %s",
    type => {
      const tab = mountStyle(nodeOf(type), () => {});
      const words = tab.textContent ?? "";
      expect(words).toContain("Block style");
      expect(words).not.toMatch(/\bLooks?\b/);
      expect(words).not.toMatch(/\bClasses\b/i);
      // Nor in what a reader hears for each control.
      const names = [...tab.querySelectorAll("[aria-label]")].map(
        each => each.getAttribute("aria-label") ?? ""
      );
      expect(names.join(" ")).not.toMatch(/\bLooks?\b|\bClasses\b/i);
    }
  );
});
