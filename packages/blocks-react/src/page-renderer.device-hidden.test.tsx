/**
 * A block hidden on a device, as a visitor's page draws it: hidden there by
 * the page's own CSS, and carrying nothing of the stripe the builder's canvas
 * draws over it. The stripe is the editor's mark and the editor's sheet; the
 * page a visitor is served has neither.
 *
 * @module page-renderer.device-hidden.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defineBlock } from "./context";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1023 },
    { id: "mobile", label: "Mobile", maxWidth: 767 },
  ],
  container: [],
};

const text = defineBlock<{ value: string }>({
  name: "test/text",
  version: 1,
  description: "Renders its value.",
  example: { props: { value: "hi" } },
  defaultProps: { value: "" },
  render: ({ props, className }) => <p className={className}>{props.value}</p>,
});

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return new Response(stream).text();
}

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "test/text",
      version: 1,
      props: { value: "Hidden heading" },
      visibility: { devices: { mobile: false } },
    },
  ],
};

describe("a block hidden on a device, on the published page", () => {
  it("is hidden there by the page's CSS, with no stripe and no tag", async () => {
    const html = await renderToHtml(
      <PageRenderer
        document={PAGE}
        blocks={createBlockResolver([text as never])}
        styleContext={{ breakpoints: SITE }}
      />
    );
    // CONTROL: the block is in the page, and the page hides it on Mobile.
    expect(html).toContain("Hidden heading");
    expect(html).toMatch(
      /@media \(max-width: ?767px\)[^}]*\{[^}]*display: ?none/
    );
    // Nothing of the builder's stripe: not its mark, its tag or its rules.
    expect(html).not.toContain("data-nx-device-hidden");
    expect(html).not.toContain("still here in the builder");
    expect(html).not.toContain("repeating-linear-gradient");
    expect(html).not.toContain("--nx-canvas-hidden");
  });
});
