/**
 * A Table of contents saved before it listed the page's own headings
 * (version 1, which listed one bound passage's): read as version 2, with the
 * passage gone and every other setting kept, on a page and inside a
 * component the page places. It then lists the page's headings.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  isComponentDocument,
  migrateDocument,
  type BlockDocument,
  type ComponentDocument,
  type DefinitionsById,
  type ExposedProperty,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver, migrationSourceFor } from "../resolver";

import { coreBlocks } from "./index";

const resolver = createBlockResolver(coreBlocks);

/** A version 1 Table of contents, its passage bound to the entry's body. */
const v1 = {
  id: "toc",
  type: "core/table-of-contents",
  version: 1,
  props: {
    title: "In this post",
    depth: "h2-h4",
    collapsible: false,
    content: {
      root: {
        type: "root",
        children: [
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "From the passage", format: 0 }],
          },
        ],
      },
    },
  },
  bindings: { content: { $bind: "body" } },
};

const heading = {
  id: "h",
  type: "core/heading",
  version: 1,
  props: { text: "On the page", level: "h2" },
};

const page = (nodes: unknown[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

async function markup(
  document: BlockDocument,
  definitions?: DefinitionsById
): Promise<string> {
  const stream = await renderToReadableStream(
    <PageRenderer
      document={document}
      blocks={resolver}
      siteStyles={false}
      context={createStandaloneContext({})}
      {...(definitions === undefined ? {} : { definitions })}
    />
  );
  await stream.allReady;
  return await new Response(stream).text();
}

/** The contents block's links, as `#id words`. */
function links(html: string): string[] {
  const nav = /<nav[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return [...nav.matchAll(/<a href="(#[^"]*)"[^>]*>([^<]*)<\/a>/g)].map(
    match => `${match[1]} ${match[2]}`
  );
}

describe("a Table of contents saved as version 1", () => {
  it("is read as version 2: its passage dropped, its other settings kept", () => {
    const { doc, failures } = migrateDocument(
      page([v1]),
      migrationSourceFor(resolver)
    );
    expect(failures).toEqual([]);
    const [node] = doc.nodes;
    expect(node?.version).toBe(2);
    expect(node?.props).toEqual({
      title: "In this post",
      depth: "h2-h4",
      collapsible: false,
    });
    // No marker is written: unset reads as bullets, as version 1 drew none.
    expect(node?.props).not.toHaveProperty("marker");
    // Its passage's binding goes with the passage: nothing is left bound to
    // a prop the block no longer has.
    expect(node).not.toHaveProperty("bindings");
  });

  it("keeps its other bindings while its passage's goes", () => {
    const title = { $bind: "title" };
    const { doc } = migrateDocument(
      page([{ ...v1, bindings: { ...v1.bindings, title } }]),
      migrationSourceFor(resolver)
    );
    expect(doc.nodes[0]?.bindings).toEqual({ title });
  });

  it("drops a component's setting that exposed its passage", () => {
    const exposure = (id: string, propPath: string): ExposedProperty => ({
      id,
      label: id,
      nodeId: "toc",
      propPath,
      type: "richText",
    });
    const component: ComponentDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [v1],
      exposed: [exposure("passage", "content"), exposure("name", "title")],
    };
    const { doc } = migrateDocument(component, migrationSourceFor(resolver));
    const exposed = isComponentDocument(doc) ? doc.exposed : undefined;
    expect(exposed?.map(each => each.id)).toEqual(["name"]);
  });

  it("lists the page's own headings, as bullets, never the passage it held", async () => {
    const html = await markup(page([v1, heading]));
    expect(links(html)).toEqual(["#on-the-page On the page"]);
    expect(html).not.toContain("From the passage");
    // Read off the list itself: the page's rules name both markers.
    expect(html).toMatch(/<ol role="list" class="[^"]*" data-nx-toc="bullets"/);
    // Its settings carried over: its own title, not folded.
    expect(html).toContain('aria-label="In this post"');
    expect(html).not.toContain("<details");
  });

  it("is upgraded the same way inside a component the page places", async () => {
    const definitions: DefinitionsById = new Map([
      [
        "c1",
        {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [v1],
        } as unknown as BlockDocument,
      ],
    ]);
    const html = await markup(
      page([
        {
          id: "p1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "c1" },
        },
        heading,
      ]),
      definitions
    );
    expect(links(html)).toEqual(["#on-the-page On the page"]);
    expect(html).not.toContain("From the passage");
    expect(html).toContain('aria-label="In this post"');
  });
});
