// @vitest-environment jsdom
/**
 * A List's four kinds as a page draws them: Bullets and Numbers as before,
 * Checks with a tick in the text's colour, None with no marker and still a
 * list to a screen reader.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageRenderer } from "../page-renderer";
import type { BlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};

async function markup(props: Record<string, unknown>): Promise<string> {
  const document = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "l",
        type: "core/list",
        version: 1,
        props: { items: ["One", "Two"], ...props },
      },
    ],
  } as BlockDocument;
  const stream = await renderToReadableStream(
    <PageRenderer document={document} blocks={resolver} />
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("a List's kinds", () => {
  it("draws Bullets as a plain list, as it always did", async () => {
    const html = await markup({ kind: "unordered" });
    expect(html).toMatch(/<ul class="[^"]*"><li>One<\/li>/);
    expect(html).not.toContain("data-nx-list");
  });

  it("draws Numbers from where they start", async () => {
    const html = await markup({ kind: "ordered", start: 3 });
    expect(html).toMatch(/<ol class="[^"]*" start="3"><li>One<\/li>/);
  });

  it("draws Checks as ticks, in the text's colour", async () => {
    const html = await markup({ kind: "checks" });
    expect(html).toMatch(/<ul class="[^"]*" data-nx-list="checks">/);
    // A marker string: `::marker` takes the item's colour, the text's.
    expect(html).toContain(
      '.nx-pb-page [data-nx-list="checks"]{list-style-type:"\\2713\\00a0"}'
    );
    expect(html).not.toMatch(/data-nx-list="checks"[^>]*role=/);
  });

  it("draws None with no marker, and keeps it a list to a screen reader", async () => {
    const html = await markup({ kind: "none" });
    expect(html).toMatch(/<ul class="[^"]*" data-nx-list="none" role="list">/);
    expect(html).toContain(
      '.nx-pb-page [data-nx-list="none"]{list-style-type:none}'
    );
    expect(html).toMatch(/<li>One<\/li><li>Two<\/li>/);
  });

  it("reads a kind it does not know as Bullets", async () => {
    const html = await markup({ kind: "stars" });
    expect(html).toMatch(/<ul class="[^"]*"><li>One<\/li>/);
  });
});
