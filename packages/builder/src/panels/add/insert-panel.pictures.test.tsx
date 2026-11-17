// @vitest-environment jsdom

/**
 * The Saved sections tab draws a picture of each saved section, through the
 * host's `renderPicture`, with the real picture part behind it.
 *
 * Each case names the broken version it rules out:
 *
 * - Every saved section's tile carries its picture in place of the tier's
 *   mark. A panel that dropped the host's picture, or kept the mark beside it,
 *   fails the first case.
 * - The tab the panel opens on (Blocks) draws no picture and never asks the
 *   host for one: a panel that built every picture up front would hold its
 *   opening up for sections nobody looked at.
 * - A picture on an open tab draws nothing until its tile is on screen, so
 *   the tab opens at once and a long list draws only what is scrolled to.
 * - The tiles sit two to a row while they carry pictures, and three without.
 *
 * @module insert-panel.pictures.test
 */
import {
  clearBlocks,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditorState } from "../../editor-state";
import { EMPTY_SELECTION } from "../../selection";
import {
  DocumentMiniature,
  type MiniatureRender,
} from "../../shared/document-miniature";
import { createMiniatureSession } from "../../shared/miniature-surface";

import { InsertPanel } from "./insert-panel";
import type { PatternInsertEntry } from "./inserter";

beforeAll(() => {
  // The command list sizes itself with a ResizeObserver and scrolls its
  // active row into view; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  clearBlocks();
  vi.unstubAllGlobals();
});

const TEXT = {
  name: "acme/text",
  version: 1,
  description: "Text.",
  example: { props: {} },
  editor: { label: "Text" },
  render: ({ props }: { props: { text?: string } }) =>
    createElement("p", { "data-testid": "drawn" }, props.text ?? ""),
} as unknown as AnyBlockDefinition;

const RENDER: MiniatureRender = {
  blocks: { get: type => (type === TEXT.name ? TEXT : undefined) },
  siteStyles: false,
};

function editor(): EditorState {
  return {
    document: { formatVersion: 1, kind: "page", nodes: [] } as BlockDocument,
    selectedId: null,
    selection: EMPTY_SELECTION,
    select: vi.fn(),
    apply: vi.fn(),
    applyAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
  } as unknown as EditorState;
}

function section(id: string, title: string) {
  return {
    id,
    title,
    category: "Sections",
    document: {
      formatVersion: 1,
      kind: "pattern",
      nodes: [
        {
          id: `00000000-0000-4000-8000-0000000000${id}`,
          type: TEXT.name,
          version: 1,
          props: { text: `${title} text` },
        },
      ],
    } as unknown as BlockDocument,
  };
}

const SECTIONS = [section("a1", "Hero"), section("a2", "Pricing")];

/** An observer the test shows on screen when it says so. */
function stubObserver(): { show: () => void } {
  const callbacks: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      disconnect(): void {}
    }
  );
  return {
    show: () => {
      for (const callback of callbacks) {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      }
    },
  };
}

/** The host's `renderPicture`: the real part, as the plugin hands it. */
function pictures() {
  const session = createMiniatureSession();
  return vi.fn(
    (entry: PatternInsertEntry): ReactNode => (
      <DocumentMiniature
        documents={[entry.document]}
        render={RENDER}
        icon="section"
        session={session}
      />
    )
  );
}

function openTab(name: "Blocks" | "Saved sections"): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function tile(name: string): HTMLElement {
  return screen.getByRole("option", { name });
}

/** The columns the open tab's grid is laid out in. */
function columns(): string | undefined {
  return document
    .querySelector<HTMLElement>("[style*='--nx-insert-columns']")
    ?.style.getPropertyValue("--nx-insert-columns");
}

describe("the Saved sections tab's pictures", () => {
  it("puts each saved section's picture in its tile, in place of the mark", () => {
    registerBlocks([TEXT], { source: "acme" });
    const { show } = stubObserver();
    render(
      <InsertPanel
        editor={editor()}
        patterns={SECTIONS}
        renderPicture={pictures()}
      />
    );

    openTab("Saved sections");
    act(() => show());

    for (const title of ["Hero", "Pricing"]) {
      const row = tile(title);
      const picture = row.querySelector(".nx-picture");
      expect(picture, title).not.toBeNull();
      expect(picture?.getAttribute("data-state")).toBe("drawn");
      // Its own section, drawn by the renderer.
      expect(picture?.textContent).toBe(`${title} text`);
      // The picture stands in for the mark rather than beside it.
      expect(row.querySelector(".nx-block-icon")).toBeNull();
    }
    expect(columns()).toBe("2");
  });

  it("draws no picture on the Blocks tab it opens on, and asks for none", () => {
    registerBlocks([TEXT], { source: "acme" });
    stubObserver();
    const renderPicture = pictures();
    render(
      <InsertPanel
        editor={editor()}
        patterns={SECTIONS}
        renderPicture={renderPicture}
      />
    );

    expect(tile("Text")).toBeTruthy();
    expect(document.querySelector(".nx-picture")).toBeNull();
    expect(renderPicture).not.toHaveBeenCalled();
    expect(columns()).toBe("3");
  });

  it("draws nothing in a picture until its tile is on screen", () => {
    registerBlocks([TEXT], { source: "acme" });
    const { show } = stubObserver();
    render(
      <InsertPanel
        editor={editor()}
        patterns={SECTIONS}
        renderPicture={pictures()}
      />
    );

    openTab("Saved sections");
    // The tab is open with every tile and its picture's frame, and no page
    // drawn in any of them yet.
    expect(tile("Hero").querySelector(".nx-picture")).not.toBeNull();
    expect(screen.queryAllByTestId("drawn")).toHaveLength(0);

    act(() => show());
    expect(screen.queryAllByTestId("drawn")).toHaveLength(2);
  });

  it("keeps the mark, three to a row, for a host with no pictures", () => {
    registerBlocks([TEXT], { source: "acme" });
    render(<InsertPanel editor={editor()} patterns={SECTIONS} />);

    openTab("Saved sections");
    expect(tile("Hero").querySelector(".nx-picture")).toBeNull();
    expect(tile("Hero").querySelector(".nx-block-icon")).not.toBeNull();
    expect(columns()).toBe("3");
  });
});
