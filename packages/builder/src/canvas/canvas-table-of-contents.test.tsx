// @vitest-environment jsdom

/**
 * The Table of contents on the canvas: drawn through the same renderer and
 * page outline as the published page, so its list follows the page as a
 * heading is added, renamed or moved, with no field to fill. On a page with
 * no heading to list, the author is told what to add.
 */
import {
  clearBlocks,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  createStandaloneContext,
  type PageContext,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { Canvas } from "./canvas";

beforeAll(() =>
  registerBlocks(coreBlocks as unknown as AnyBlockDefinition[], {
    source: "canvas-table-of-contents-test",
  })
);
afterAll(clearBlocks);
afterEach(cleanup);

const heading = (id: string, text: string, level = "h2"): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level },
});

/** The contents block as a new one is placed. */
const CONTENTS: BlockNode = {
  id: "toc",
  type: "core/table-of-contents",
  version: 2,
  props: {
    title: "On this page",
    depth: "h2-h3",
    marker: "numbered",
    collapsible: true,
    highlight: true,
  },
};

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [CONTENTS, ...nodes],
});

/** The editor's context: the author is looking, as the editor says. */
let editorContext: PageContext = createStandaloneContext({ diagnostics: true });

function canvas(document: BlockDocument): React.JSX.Element {
  return (
    <Canvas
      document={document}
      siteStyles={{ css: "", classes: {} } as never}
      selectedId={null}
      render={{ context: editorContext }}
    />
  );
}

/** The contents' entries, each as its words and link, nested ones indented. */
function listed(container: HTMLElement): string[] {
  const nav = container.querySelector('nav[aria-label="On this page"]');
  return [...(nav?.querySelectorAll("a") ?? [])].map(link => {
    const depth = link.closest("ol")?.parentElement?.closest("ol") ? "  " : "";
    return `${depth}${link.textContent} ${link.getAttribute("href")}`;
  });
}

describe("a table of contents on the canvas", () => {
  it("follows the page as a heading is added, renamed and moved", async () => {
    editorContext = createStandaloneContext({ diagnostics: true });
    const { container, rerender } = await act(async () =>
      render(canvas(page(heading("a", "Intro"))))
    );
    expect(listed(container)).toEqual(["Intro #intro"]);

    // Added: an H3 nests under the H2 before it, and an H2 follows.
    await act(async () => {
      rerender(
        canvas(
          page(
            heading("a", "Intro"),
            heading("b", "Details", "h3"),
            heading("c", "Pricing")
          )
        )
      );
    });
    expect(listed(container)).toEqual([
      "Intro #intro",
      "  Details #details",
      "Pricing #pricing",
    ]);

    // Renamed: the entry takes the heading's new words and anchor.
    await act(async () => {
      rerender(
        canvas(
          page(
            heading("a", "Overview"),
            heading("b", "Details", "h3"),
            heading("c", "Pricing")
          )
        )
      );
    });
    expect(listed(container)).toEqual([
      "Overview #overview",
      "  Details #details",
      "Pricing #pricing",
    ]);

    // Moved: page order decides the list, and the nesting with it.
    await act(async () => {
      rerender(
        canvas(
          page(
            heading("c", "Pricing"),
            heading("b", "Details", "h3"),
            heading("a", "Overview")
          )
        )
      );
    });
    expect(listed(container)).toEqual([
      "Pricing #pricing",
      "  Details #details",
      "Overview #overview",
    ]);
  });

  it("tells the author to add H2 headings while the page has none to list", async () => {
    editorContext = createStandaloneContext({ diagnostics: true });
    const { container, rerender } = await act(async () =>
      render(canvas(page(heading("t", "The page's title", "h1"))))
    );
    const nav = container.querySelector('nav[aria-label="On this page"]');
    expect(nav?.textContent).toContain(
      "Add H2 headings to this page and they'll be listed here."
    );
    expect(nav?.querySelectorAll("a")).toHaveLength(0);

    // The first H2 replaces the message with the list.
    await act(async () => {
      rerender(
        canvas(
          page(heading("t", "The page's title", "h1"), heading("a", "Intro"))
        )
      );
    });
    expect(listed(container)).toEqual(["Intro #intro"]);
    expect(container.textContent).not.toContain("Add H2 headings");
  });
});
