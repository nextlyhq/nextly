/**
 * What an editor draws in place of a block a list's item hides. A published
 * page is never told what to draw there, so it renders exactly as a page
 * without that block would; an editor told it draws its node in the block's
 * place, for the items that hide it and for no other.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ItemHiddenAs } from "./block-boundary";
import { coreBlocks } from "./blocks";
import { createStandaloneContext } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver(coreBlocks);

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "featured", type: "checkbox" },
];

const PILL: BlockNode = {
  id: "pill",
  type: "core/heading",
  version: 1,
  props: { text: "Featured", level: "h2" },
  styles: { base: { base: { color: "#c0ffee" } } },
  visibility: { conditions: [[{ field: "featured", op: "is_true" }]] },
};

const NAME: BlockNode = {
  id: "name",
  type: "core/text",
  version: 1,
  props: { text: "A post" },
};

/** A list of posts whose pill shows only for a featured post. */
function listOf(children: readonly BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "loop",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 3 },
        slots: { children: [...children] },
      },
    ],
  };
}

const MARKER: BlockNode = {
  id: "pill-hidden",
  type: "core/text",
  version: 1,
  props: { text: "Hidden for this entry" },
};

async function renderWith(
  document: BlockDocument,
  items: readonly Record<string, unknown>[],
  itemHiddenAs?: ItemHiddenAs
): Promise<string> {
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      context={createStandaloneContext({
        data: { find: () => Promise.resolve({ items: [...items] }) },
        fieldShapes: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? POSTS
              : undefined,
        },
      })}
      {...(itemHiddenAs === undefined ? {} : { itemHiddenAs })}
    />
  );
}

const PLAIN = [
  { id: "1", title: "One", featured: false },
  { id: "2", title: "Two", featured: false },
];

describe("a published page, never told what to draw for a hidden block", () => {
  it("renders byte for byte as the page without that block", async () => {
    const withPill = await renderWith(listOf([PILL, NAME]), PLAIN);
    const withoutPill = await renderWith(listOf([NAME]), PLAIN);
    // CONTROL: the list drew its items, so the comparison is of real output.
    expect(withoutPill.match(/>A post</g)).toHaveLength(2);
    expect(withPill).toBe(withoutPill);
  });
});

describe("an editor told what to draw for a hidden block", () => {
  it("draws it in the block's place for each item that hides it, and for no other", async () => {
    const hiddenAs = vi.fn<ItemHiddenAs>(() => MARKER);
    const html = await renderWith(
      listOf([PILL, NAME]),
      [
        { id: "1", title: "One", featured: true },
        { id: "2", title: "Two", featured: false },
        { id: "3", title: "Three", featured: false },
      ],
      hiddenAs
    );
    expect(html.match(/>Featured</g)).toHaveLength(1);
    expect(html.match(/>Hidden for this entry</g)).toHaveLength(2);
    // Asked about the hidden block only, once per item hiding it.
    expect(hiddenAs).toHaveBeenCalledTimes(2);
    // Told which item hides it, and where that item comes from.
    expect(
      hiddenAs.mock.calls.map(([node, item]) => [
        node.id,
        item.values.id,
        item.collection,
      ])
    ).toEqual([
      ["pill", "2", "posts"],
      ["pill", "3", "posts"],
    ]);
    // The marker sits where the pill would: before the item's name.
    expect(html.indexOf(">Hidden for this entry<")).toBeLessThan(
      html.indexOf(">A post<", html.indexOf(">Featured<") + 1)
    );
  });

  it("draws nothing where it is given nothing to draw", async () => {
    const html = await renderWith(listOf([PILL, NAME]), PLAIN, () => undefined);
    const published = await renderWith(listOf([PILL, NAME]), PLAIN);
    expect(html).toBe(published);
  });

  it("serves the hidden block's rules beside no marker", async () => {
    const html = await renderWith(listOf([PILL, NAME]), PLAIN, () => MARKER);
    expect(html).toContain(">Hidden for this entry<");
    expect(html).not.toContain("#c0ffee");
    expect(html).not.toContain('data-nx-item-rules="pill"');
  });

  it("is never asked about a conditioned block outside a list", async () => {
    const hiddenAs = vi.fn<ItemHiddenAs>(() => MARKER);
    const html = await renderWith(
      {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [PILL, NAME],
      },
      [],
      hiddenAs
    );
    expect(hiddenAs).not.toHaveBeenCalled();
    expect(html).not.toContain(">Featured<");
    expect(html).toContain(">A post<");
  });
});
