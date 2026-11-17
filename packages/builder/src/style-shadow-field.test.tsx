// @vitest-environment jsdom

/**
 * The shadow field in a block's Style tab draws the shadow control a shadow
 * variable in Design draws, and writes the block's shadow through it.
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

import type { EditorState } from "./editor-state";
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

/**
 * A box that offers a shadow. No core block turns shadow support on yet, and
 * the field drawn is the same whichever block offers it.
 */
const SHADOWED = (() => {
  const box = coreBlocks.find(each => each.name === "core/box");
  if (box === undefined) throw new Error("core/box is not a core block");
  return {
    ...box,
    name: "test/shadowed-box",
    supports: { ...box.supports, shadow: true },
  };
})();

beforeEach(() =>
  registerBlocks([...coreBlocks, SHADOWED] as never, { source: "core" })
);
afterEach(() => {
  cleanup();
  clearBlocks();
});

function nodeOf(id: string, type: string, extra: Partial<BlockNode> = {}) {
  const block = [...coreBlocks, SHADOWED].find(each => each.name === type);
  if (block === undefined) throw new Error(`${type} is not a core block`);
  return { id, type, version: block.version, props: {}, ...extra } as BlockNode;
}

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    nodeOf("section", "test/shadowed-box", {
      styles: {
        base: { base: { boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)" } },
      },
    }),
  ],
} as BlockDocument;

function mount(): EditorState {
  const editor = {
    document: PAGE,
    selectedId: "section",
    selection: { ids: ["section"], primary: "section" },
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
  render(<InspectorPanel editor={editor} />);
  return editor;
}

function openTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

/** Open a section of the shown tab unless it is open. */
function openSection(key: string): void {
  const header = document.querySelector<HTMLElement>(
    `[role="tabpanel"]:not([hidden]) [data-section="${key}"] [data-slot="accordion-trigger"]`
  );
  if (header !== null && header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
  }
}

describe("a block's shadow field", () => {
  it("draws the shadow control, and writes the block's shadow through it", () => {
    const editor = mount();
    openTab("Style");
    openSection("effects");
    const layer = screen.getByRole("group", { name: "Layer 1" });
    expect(within(layer).getByRole("switch", { name: "Inside" })).toBeDefined();
    const blur = within(layer).getByLabelText("Blur");
    fireEvent.change(blur, { target: { value: "20" } });
    fireEvent.blur(blur);
    const writes = [
      ...vi.mocked(editor.apply).mock.calls,
      ...vi.mocked(editor.applyAll).mock.calls,
    ];
    expect(JSON.stringify(writes)).toContain("0 4px 20px rgba(0, 0, 0, 0.2)");
  });
});
