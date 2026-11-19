// @vitest-environment jsdom

/**
 * Leaving a heading out of a table of contents, as an author meets it in the
 * block panel: the setting on every Heading in Advanced, off until they turn
 * it on, and the note on a selected Table of contents that says where it is.
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { EditorState } from "../../editor-state";
import { InspectorPanel } from "../inspector-panel";
import { TOC_LEFT_OUT_HINT } from "./toc-left-out-note";

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
function nodeOf(
  id: string,
  type: string,
  props: Record<string, unknown> = {}
): BlockNode {
  const block = coreBlocks.find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props } as BlockNode;
}

/** The panel with `node` selected on a page holding it. */
function mount(node: BlockNode) {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [node],
  } as BlockDocument;
  const apply = vi.fn(() => document);
  render(
    <InspectorPanel
      editor={
        {
          document,
          selectedId: node.id,
          selection: { ids: [node.id], primary: node.id },
          applyAll: vi.fn(() => document),
          select: vi.fn(),
          apply,
          undo: vi.fn(),
          redo: vi.fn(),
          canUndo: false,
          canRedo: false,
          undoDepth: 0,
          lockRefusalFor: () => undefined,
          composed: () => undefined,
        } as unknown as EditorState
      }
    />
  );
  return apply;
}

const choose = (name: string): void => {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
};

describe("a selected Table of contents", () => {
  it("says any heading can be left out, and where, under Headings", () => {
    mount(nodeOf("toc", "core/table-of-contents", { depth: "h2-h3" }));
    const content = screen.getByRole("tabpanel", { name: "Content" });
    const note = within(content).getByText(TOC_LEFT_OUT_HINT);
    expect(note.textContent).toBe(
      "Any heading can be left out: Heading → Advanced → Leave out of table of contents"
    );
    // After the setting it speaks of, in the panel's order.
    const headings = within(content).getByText("Headings");
    expect(
      headings.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("is the only block that says it", () => {
    mount(nodeOf("list", "core/list"));
    expect(screen.queryByText(TOC_LEFT_OUT_HINT)).toBeNull();
  });
});

describe("a selected Heading", () => {
  /** The setting's switch, in Advanced › Visibility. */
  function leaveOut(): HTMLElement {
    choose("Advanced");
    const advanced = screen.getByRole("tabpanel", { name: "Advanced" });
    const visibility = within(advanced).getByRole("region", {
      name: "Visibility",
    });
    return within(visibility).getByRole("switch", {
      name: "Leave out of table of contents",
    });
  }

  it("offers Leave out of table of contents in Advanced, off by default", () => {
    mount(nodeOf("h", "core/heading", { text: "Notes", level: "h2" }));
    expect(leaveOut().getAttribute("aria-checked")).toBe("false");
    // Not in Content: a heading's words and level are there, this is not.
    choose("Content");
    expect(
      within(screen.getByRole("tabpanel", { name: "Content" })).queryByRole(
        "switch",
        { name: "Leave out of table of contents" }
      )
    ).toBeNull();
  });

  it("writes the setting when it is turned on", () => {
    const apply = mount(
      nodeOf("h", "core/heading", { text: "Notes", level: "h2" })
    );
    fireEvent.click(leaveOut());
    expect(JSON.stringify(apply.mock.calls)).toContain('"tocExclude":true');
  });
});
