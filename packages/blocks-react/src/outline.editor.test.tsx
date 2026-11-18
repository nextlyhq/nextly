// @vitest-environment jsdom

/**
 * The page outline in an editor: the canvas keeps the outputs of its async
 * blocks per context, so drawing the page again does not run each one again.
 * The outline is put on a copy of that context, and changes as an author
 * types in a heading, so what is kept must be kept by the context the
 * outline was added to, or every image on the page blinks per keystroke. A
 * heading whose own anchor changed is drawn again.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import {
  createStandaloneContext,
  defineBlock,
  type PageContext,
} from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

afterEach(cleanup);

const runs = { count: 0 };

/** The shape of `core/image` and `core/button`: an `async` render. */
const late = defineBlock<Record<string, never>>({
  name: "test/late",
  version: 1,
  description: "Renders after a promise settles.",
  example: { props: {} },
  render: async ({ className }) => {
    runs.count += 1;
    await Promise.resolve();
    return <p className={className}>Late</p>;
  },
}) as AnyBlockDefinition;

const blocks = createBlockResolver([...coreBlocks, late]);

const page = (...headings: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    ...headings,
    { id: "late", type: "test/late", version: 1, props: {} },
  ],
});

const heading = (id: string, text: string): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h2" },
});

/** The page as the canvas draws it, under the editor's one context. */
const canvas = (
  document: BlockDocument,
  context: PageContext
): ReactElement => (
  <PageRenderer
    document={document}
    blocks={blocks}
    context={context}
    nodeAttribute
  />
);

const ids = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll("h2")].map(element => element.id || null);

describe("an editor drawing the page as a heading changes", () => {
  it("runs the page's other async blocks once, while the outline changes", async () => {
    runs.count = 0;
    const context = createStandaloneContext();
    const view = await act(async () =>
      render(canvas(page(heading("a", "Note")), context))
    );
    expect(runs.count).toBe(1);
    for (const words of ["Notes", "Notes!", "Notes again"]) {
      await act(async () => {
        view.rerender(canvas(page(heading("a", words)), context));
      });
    }
    // CONTROL: the outline did change, each heading drawn with its new id.
    expect(ids(view.container)).toEqual(["notes-again"]);
    expect(runs.count).toBe(1);
  });

  it("draws a heading again when its own anchor changes because another heading moved", async () => {
    // A heading linked to an entry renders after a promise, so its output is
    // one an editor keeps; its words stay, while a heading put before it
    // takes its anchor.
    const linked = (id: string): BlockNode => ({
      ...heading(id, "Notes"),
      props: {
        text: "Notes",
        level: "h2",
        entryCollection: "posts",
        entryId: "1",
      },
    });
    const context = createStandaloneContext({
      resolveEntryPath: () => Promise.resolve("/posts/1"),
    });
    const view = await act(async () =>
      render(canvas(page(linked("b")), context))
    );
    expect(ids(view.container)).toEqual(["notes"]);
    await act(async () => {
      view.rerender(canvas(page(heading("a", "Notes"), linked("b")), context));
    });
    expect(ids(view.container)).toEqual(["notes", "notes-2"]);
  });
});
