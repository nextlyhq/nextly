// @vitest-environment jsdom

/**
 * The Layers row of a block with custom CSS of its own: a "{ }" mark, its
 * tooltip and its accessible name "Has custom CSS", on that row only. Layers
 * is drawn alike for everyone, so it says only that the block has some.
 *
 * @module layers-custom-css.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useEditorState } from "../../editor-state";

import { LayersPanel } from "./layers-panel";

beforeAll(() => {
  // The tree virtualizes: without a measured viewport it draws no rows.
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
  for (const size of ["clientHeight", "offsetHeight"]) {
    Object.defineProperty(window.HTMLElement.prototype, size, {
      configurable: true,
      value: 800,
    });
  }
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "styled",
      type: "acme/note",
      version: 1,
      props: {},
      name: "Styled",
      customCss: "selector { padding: 1px; }",
    },
    { id: "plain", type: "acme/note", version: 1, props: {}, name: "Plain" },
  ] as BlockNode[],
} as BlockDocument;

function Host(): React.JSX.Element {
  const editor = useEditorState({ initialDocument: PAGE });
  return <LayersPanel editor={editor} />;
}

/** A row by the name it shows. */
const row = (name: string): HTMLElement =>
  screen
    .getAllByRole("treeitem")
    .find(item => item.querySelector(`[data-nx-layer]`)?.textContent === name)!;

describe("a Layers row", () => {
  it("marks a block with custom CSS, by tooltip and by name", () => {
    registerBlocks(
      [
        {
          name: "acme/note",
          version: 1,
          description: "A note.",
          example: { props: {} },
          editor: { label: "Note" },
          render: () => null,
        },
      ] as never,
      { source: "layers-custom-css-test" }
    );
    render(<Host />);
    const styled = row("Styled");
    expect(within(styled).getByTitle("Has custom CSS")).toBeTruthy();
    expect(within(styled).getByText("Has custom CSS")).toBeTruthy();
    expect(within(row("Plain")).queryByText("Has custom CSS")).toBeNull();
    expect(within(row("Plain")).queryByTitle("Has custom CSS")).toBeNull();
  });
});
