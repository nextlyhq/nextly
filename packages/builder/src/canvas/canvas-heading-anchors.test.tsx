// @vitest-environment jsdom

/**
 * The page outline on the canvas: the canvas draws the page being edited
 * through the same renderer and the same outline as the published page, so
 * each heading's anchor, and a block reading the outline (as a table of
 * contents does), follow the page as a heading is added, renamed or moved.
 * And the other blocks are not drawn again for it: typing in a heading
 * changes the outline, and an image or a list beside it must not blink.
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
  defineBlock,
  type PageContext,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { Canvas } from "./canvas";

/** How many times the async block below ran. */
const runs = { count: 0 };

/** Lists the outline it is drawn with, as a table of contents would. */
const contents = defineBlock<Record<string, never>>({
  name: "test/contents",
  version: 1,
  description: "Lists the page outline.",
  example: { props: {} },
  render: ({ ctx, className }) => (
    <ol className={className} data-testid="contents">
      {(ctx.outline?.headings ?? []).map(heading => (
        <li key={heading.anchor}>
          <a href={`#${heading.anchor}`}>{heading.text}</a>
        </li>
      ))}
    </ol>
  ),
});

/** A block that draws after a promise, as an image or a list does. */
const late = defineBlock<Record<string, never>>({
  name: "test/late",
  version: 1,
  description: "Draws after a promise.",
  example: { props: {} },
  render: async ({ className }) => {
    runs.count += 1;
    await Promise.resolve();
    return <p className={className}>Late</p>;
  },
});

beforeAll(() =>
  registerBlocks(
    [...coreBlocks, contents, late] as unknown as AnyBlockDefinition[],
    { source: "canvas-heading-anchors-test" }
  )
);
afterAll(clearBlocks);
afterEach(cleanup);

const heading = (id: string, text: string): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    ...nodes,
    { id: "toc", type: "test/contents", version: 1, props: {} },
    { id: "late", type: "test/late", version: 1, props: {} },
  ],
});

/**
 * The canvas over `document`, drawn with one context for the editor's life,
 * as the page builder hands it: what the editor keeps per context lives as
 * long as it does.
 */
function canvas(
  document: BlockDocument,
  context: PageContext = editorContext
): React.JSX.Element {
  return (
    <Canvas
      document={document}
      siteStyles={{ css: "", classes: {} } as never}
      selectedId={null}
      render={{ context }}
    />
  );
}

let editorContext: PageContext = createStandaloneContext();

/** Each heading's id on the canvas, in page order. */
function headingIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(
    element => element.getAttribute("id")
  );
}

/** What the outline-reading block lists: each entry's words and link. */
function listed(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid="contents"] a')].map(
    link => `${link.textContent} ${link.getAttribute("href")}`
  );
}

describe("the outline on the canvas", () => {
  it("follows the page as a heading is added, renamed and moved", async () => {
    editorContext = createStandaloneContext();
    const { container, rerender } = await act(async () =>
      render(canvas(page(heading("a", "Notes"))))
    );
    expect(headingIds(container)).toEqual(["notes"]);
    expect(listed(container)).toEqual(["Notes #notes"]);

    // Added: a second "Notes" is numbered, not repeated.
    await act(async () => {
      rerender(canvas(page(heading("a", "Notes"), heading("b", "Notes"))));
    });
    expect(headingIds(container)).toEqual(["notes", "notes-2"]);
    expect(listed(container)).toEqual(["Notes #notes", "Notes #notes-2"]);

    // Renamed: the first takes its new words, and the second its own.
    await act(async () => {
      rerender(canvas(page(heading("a", "Intro"), heading("b", "Notes"))));
    });
    expect(headingIds(container)).toEqual(["intro", "notes"]);
    expect(listed(container)).toEqual(["Intro #intro", "Notes #notes"]);

    // Moved: page order decides the list and which repeat is numbered.
    await act(async () => {
      rerender(
        canvas(
          page(
            heading("b", "Notes"),
            heading("a", "Intro"),
            heading("c", "Notes")
          )
        )
      );
    });
    expect(headingIds(container)).toEqual(["notes", "intro", "notes-2"]);
    expect(listed(container)).toEqual([
      "Notes #notes",
      "Intro #intro",
      "Notes #notes-2",
    ]);
  });

  it("does not draw the page's other blocks again as a heading's words change", async () => {
    runs.count = 0;
    editorContext = createStandaloneContext();
    const { container, rerender } = await act(async () =>
      render(canvas(page(heading("a", "Note"))))
    );
    const before = runs.count;
    expect(before).toBeGreaterThan(0);
    for (const words of ["Note", "Notes", "Notes!"]) {
      await act(async () => {
        rerender(canvas(page(heading("a", words))));
      });
    }
    expect(headingIds(container)).toEqual(["notes"]);
    expect(runs.count).toBe(before);
  });
});
