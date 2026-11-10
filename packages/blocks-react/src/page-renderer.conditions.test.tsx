/**
 * A page drawn with list data and no bindings still decides its list items'
 * conditions, and still serves the rules of the blocks an item shows: the
 * rules are held out of the page's sheet whether or not the page has
 * bindings to fill, so they have to reach the list either way.
 *
 * Drawn as its route draws it, prepared and gated for its entry: a render
 * the route has not prepared holds every conditioned block back, a list
 * item's among them, until something decides them.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { createStandaloneContext } from "./context";
import { PageRenderer } from "./page-renderer";
import { prepareDocument, regateDocument } from "./prepare-document";
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

const BASE_ONLY: StyleCompileContext = {
  breakpoints: { viewport: [{ id: "base", label: "Base" }], container: [] },
};

const POSTS: readonly BindingFieldShape[] = [
  { name: "title", type: "text" },
  { name: "featured", type: "checkbox" },
];

/** A list of posts whose heading shows only for a featured post, styled. */
const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "loop",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts", limit: 2 },
      slots: {
        children: [
          {
            id: "pill",
            type: "core/heading",
            version: 1,
            props: { text: "Featured", level: "h2" },
            styles: { base: { base: { color: "#c0ffee" } } },
            visibility: {
              conditions: [[{ field: "featured", op: "is_true" }]],
            },
          },
        ],
      },
    },
  ],
};

/** The page as its route prepares it, gated for a page with no entry. */
function routePrepared(page: BlockDocument) {
  const prepared = prepareDocument(page, { resolver });
  return prepared === null ? undefined : regateDocument(prepared, {})?.prepared;
}

async function renderWith(
  items: readonly Record<string, unknown>[]
): Promise<string> {
  const prepared = routePrepared(document);
  return await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      // With no compile context the page draws no sheet at all, and no rules
      // to serve beside an item.
      styleContext={BASE_ONLY}
      {...(prepared === undefined ? {} : { prepared })}
      context={createStandaloneContext({
        data: { find: () => Promise.resolve({ items: [...items] }) },
        fieldShapes: {
          fieldsOf: ref =>
            "collection" in ref && ref.collection === "posts"
              ? POSTS
              : undefined,
        },
      })}
    />
  );
}

describe("a page drawn with list data and no bindings", () => {
  it("serves the rules of a block an item shows, once, beside it", async () => {
    const html = await renderWith([
      { id: "1", title: "One", featured: true },
      { id: "2", title: "Two", featured: true },
    ]);
    // CONTROL: the item's conditions held, so the block is drawn for each.
    expect(html.match(/>Featured</g)).toHaveLength(2);
    expect(html.match(/data-nx-item-rules="pill"/g)).toHaveLength(1);
    expect(html).toContain("#c0ffee");
  });

  it("serves none of them when no item shows the block", async () => {
    const html = await renderWith([{ id: "1", title: "One", featured: false }]);
    expect(html).not.toContain(">Featured<");
    expect(html).not.toContain("#c0ffee");
  });
});

describe("a block its entry's conditions keep", () => {
  const conditioned: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "held",
        type: "core/heading",
        version: 1,
        props: { text: "Members", level: "h2" },
        styles: { base: { base: { color: "#c0ffee" } } },
        visibility: {
          conditions: [[{ field: "featured", op: "is_true" }]],
        },
      },
    ],
  };

  async function renderForEntry(featured: boolean): Promise<string> {
    const prepared = prepareDocument(conditioned, { resolver });
    const decided =
      prepared === null
        ? undefined
        : regateDocument(prepared, {
            entry: {
              fields: {
                declared: new Set(POSTS.map(field => field.name)),
                readable: POSTS,
              },
              values: { featured },
            },
          })?.prepared;
    return await renderToHtml(
      <PageRenderer
        document={conditioned}
        blocks={resolver}
        siteStyles={false}
        styleContext={BASE_ONLY}
        {...(decided === undefined ? {} : { prepared: decided })}
        context={createStandaloneContext()}
      />
    );
  }

  it("serves its rules in the page's sheet", async () => {
    const html = await renderForEntry(true);
    expect(html).toContain(">Members<");
    expect(html).toContain("#c0ffee");
  });

  it("serves none of them when the entry hides it", async () => {
    const html = await renderForEntry(false);
    expect(html).not.toContain(">Members<");
    expect(html).not.toContain("#c0ffee");
  });
});

describe("a list with no collection inside another list", () => {
  it("never judges its item conditions by the outer list's item", async () => {
    const nested: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "outer",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 1 },
          slots: {
            children: [
              {
                id: "outerTitle",
                type: "core/heading",
                version: 1,
                props: { text: "Outer drawn", level: "h2" },
              },
              {
                id: "inner",
                type: "core/collection-loop",
                version: 1,
                // No collection chosen yet: its template is drawn once.
                props: {},
                slots: {
                  children: [
                    {
                      id: "innerPill",
                      type: "core/heading",
                      version: 1,
                      props: { text: "Inner featured", level: "h3" },
                      visibility: {
                        conditions: [[{ field: "featured", op: "is_true" }]],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const html = await renderToHtml(
      <PageRenderer
        document={nested}
        blocks={resolver}
        siteStyles={false}
        context={createStandaloneContext({
          data: {
            find: () =>
              Promise.resolve({
                items: [{ id: "1", title: "One", featured: true }],
              }),
          },
          fieldShapes: {
            fieldsOf: ref =>
              "collection" in ref && ref.collection === "posts"
                ? POSTS
                : undefined,
          },
        })}
      />
    );
    // CONTROL: the outer list drew its featured post.
    expect(html).toContain("Outer drawn");
    // The inner list has no item of its own, so its condition fails closed.
    expect(html).not.toContain("Inner featured");
  });
});

describe("placement gates in a stored document", () => {
  it("are ignored, so stored data adds no gate an author didn't set", async () => {
    const stored = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "plain",
          type: "core/heading",
          version: 1,
          props: { text: "Shown to everyone", level: "h2" },
          // Only the resolver writes this, while a page is drawn.
          visibility: { within: ["hidden"] },
        },
      ],
    } as unknown as BlockDocument;
    const html = await renderToHtml(
      <PageRenderer document={stored} blocks={resolver} siteStyles={false} />
    );
    expect(html).toContain("Shown to everyone");
  });
});
