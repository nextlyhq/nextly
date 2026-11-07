/**
 * The Entry content block, drawn through the page renderer as a published
 * route draws it: the template with the entry's blocks composed into it
 * (`composeEntryContent`), from the entry as the route read it.
 *
 * Every "draws nothing" case is beside one that draws, and asserted on the
 * entry's own words and the block's own class, so an Entry content block
 * that never draws anything fails the control rather than passing the rest.
 */
import {
  blockTypeClassName,
  composeEntryContent,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext, type PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

/** The block's type class, which its element carries when it is drawn. */
const BLOCK_CLASS = blockTypeClassName("core/entry-content");

/**
 * How many elements carry the block's class: counted on class attributes,
 * so a stylesheet naming the class is not taken for an element.
 */
function blockElements(html: string): number {
  return [...html.matchAll(/class="([^"]*)"/g)].filter(([, names]) =>
    (names ?? "").split(/\s+/).includes(BLOCK_CLASS)
  ).length;
}

const template: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "title",
      type: "core/heading",
      version: 1,
      props: { text: "Template title", level: "h1" },
    },
    {
      id: "ec",
      type: "core/entry-content",
      version: 1,
      props: { field: "body" },
    },
  ],
};

/** A post's Body: two paragraphs, the second inside a box. */
const body: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "p1",
      type: "core/text",
      version: 1,
      props: { text: "Body first paragraph" },
    },
    {
      id: "inner",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          {
            id: "p2",
            type: "core/text",
            version: 1,
            props: { text: "Body second paragraph" },
          },
        ],
      },
    },
  ],
};

/** The page a route serves an entry with: composed, then drawn. */
function drawn(
  entry: Record<string, unknown>,
  context: PageContext = createStandaloneContext()
): Promise<string> {
  return renderToHtml(
    <PageRenderer
      document={composeEntryContent(template, {
        valueOf: field => entry[field],
      })}
      context={context}
      blocks={createBlockResolver(coreBlocks as AnyBlockDefinition[])}
    />
  );
}

describe("Entry content on a published page", () => {
  it("draws the entry's Body nodes inside the template", async () => {
    const html = await drawn({ body });
    expect(html).toContain("Template title");
    expect(html).toContain("Body first paragraph");
    expect(html).toContain("Body second paragraph");
    expect(blockElements(html)).toBe(1);
    // In the template's place: after its title.
    expect(html.indexOf("Template title")).toBeLessThan(
      html.indexOf("Body first paragraph")
    );
  });

  it.each([
    ["an empty field", { body: { formatVersion: 1, kind: "page", nodes: [] } }],
    // The field is gone from the collection, or the public may not read it:
    // either way the route's entry has no value for it.
    ["a field the entry does not have", {}],
    ["a field the public may not read", { title: "Readable" }],
    ["a value that is no document", { body: "not a document" }],
  ])(
    "draws nothing for %s: no element, and the template around it",
    async (_case, entry) => {
      const html = await drawn(entry);
      // The control: the template itself is drawn.
      expect(html).toContain("Template title");
      expect(blockElements(html)).toBe(0);
      expect(html).not.toContain("Body first paragraph");
    }
  );

  it("draws nothing of a field other than the one it names", async () => {
    const html = await drawn({ sidebar: body });
    expect(html).not.toContain("Body first paragraph");
    expect(blockElements(html)).toBe(0);
  });

  it("never draws an Entry content block the entry's content holds", async () => {
    // A body holding an Entry content block of its own, which validation
    // refuses but stored data may still hold: drawn without it.
    const holding: BlockDocument = {
      ...body,
      nodes: [
        ...body.nodes,
        {
          id: "nested",
          type: "core/entry-content",
          version: 1,
          props: { field: "body" },
        },
      ],
    };
    const html = await drawn({ body: holding });
    // The control: the rest of the body is drawn.
    expect(html).toContain("Body first paragraph");
    // One Entry content element, the template's own.
    expect(blockElements(html)).toBe(1);
  });
});

describe("Entry content on the editor's canvas", () => {
  const canvas: PageContext = {
    ...createStandaloneContext(),
    entryContentCanvas: {
      noteFor: () => ({
        tone: "muted",
        lead: "Writing alt text that helps",
        words: "has no Body content yet.",
      }),
    },
  };

  it("draws its note where there is none of the entry's content to draw", async () => {
    const html = await drawn({}, canvas);
    expect(html).toContain('data-nx-entry-content-note="muted"');
    expect(html).toContain("<b>Writing alt text that helps</b>");
    expect(html).toContain("has no Body content yet.");
  });

  it("draws the entry's content, marked as drawn, and no note (the control)", async () => {
    const html = await drawn({ body }, canvas);
    expect(html).toContain("Body first paragraph");
    expect(html).toContain("data-nx-entry-content-drawn");
    expect(html).not.toContain("data-nx-entry-content-note");
  });

  it("marks nothing for the canvas on a published page", async () => {
    const html = await drawn({ body });
    expect(html).not.toContain("data-nx-entry-content-drawn");
  });
});
