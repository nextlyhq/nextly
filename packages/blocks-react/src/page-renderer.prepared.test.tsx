/**
 * A document prepared once by this package's route, and reused by the
 * renderer only when it is genuinely that: one this package made, for the very
 * document object and caps the renderer is given. Anything else runs the
 * whole pipeline, so no caller can hand the renderer stages that skipped
 * repair, gating or the caps.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The pipeline's migration pass, counted: it runs once per preparation and
// nowhere else.
const runs = vi.hoisted(() => ({ count: 0 }));
vi.mock("@nextlyhq/blocks-engine", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@nextlyhq/blocks-engine")>();
  return {
    ...actual,
    migrateDocument: (...args: Parameters<typeof actual.migrateDocument>) => {
      runs.count += 1;
      return actual.migrateDocument(...args);
    },
  };
});

import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import { prepareDocument, type PreparedDocument } from "./prepare-document";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks);

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

function page(text: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text, level: "h1" },
      },
    ],
  };
}

/** Prepare a document as the route does, and count only the render's runs. */
function prepared(document: BlockDocument): PreparedDocument {
  const result = prepareDocument(document, { resolver: blocks });
  if (result === null) throw new Error("the document did not prepare");
  runs.count = 0;
  return result;
}

beforeEach(() => {
  runs.count = 0;
});

describe("a prepared document handed to the renderer", () => {
  it("is reused when it was made for this document under these caps", async () => {
    const document = page("Reused");
    const html = await renderToHtml(
      <PageRenderer
        document={document}
        blocks={blocks}
        siteStyles={false}
        prepared={prepared(document)}
      />
    );
    expect(html).toContain("Reused");
    expect(runs.count).toBe(0);
  });

  it("is ignored when it was built by hand, or copied from a real one", async () => {
    const document = page("Rendered");
    const forged: PreparedDocument = { presented: page("Forged") };
    const copied: PreparedDocument = { ...prepared(document) };
    for (const candidate of [forged, copied]) {
      runs.count = 0;
      const html = await renderToHtml(
        <PageRenderer
          document={document}
          blocks={blocks}
          siteStyles={false}
          prepared={candidate}
        />
      );
      expect(html).toContain("Rendered");
      expect(runs.count).toBe(1);
    }
  });

  it("falls back to a full run for another document, or other caps", async () => {
    const original = page("Prepared");
    const handle = prepared(original);
    const other = page("Rendered instead");
    const html = await renderToHtml(
      <PageRenderer
        document={other}
        blocks={blocks}
        siteStyles={false}
        prepared={handle}
      />
    );
    expect(html).toContain("Rendered instead");
    expect(html).not.toContain("Prepared");
    expect(runs.count).toBe(1);

    runs.count = 0;
    await renderToHtml(
      <PageRenderer
        document={original}
        blocks={blocks}
        siteStyles={false}
        limits={{ ...DEFAULT_LIMITS }}
        prepared={handle}
      />
    );
    expect(runs.count).toBe(1);
  });
});
