/**
 * That the cascade read for an editor describes the tree the page renders.
 *
 * The module compiles a second time, from its own derivation of the document,
 * so the risk it carries is not that the compiler is wrong — it has its own
 * suite — but that the two derivations describe different pages. Both failures
 * are reachable and they point opposite ways: a tree pruned harder than the
 * renderer's withholds an account of markup that IS on the page, and one pruned
 * less reports a source for markup that is not.
 *
 * Asserted against `PageRenderer`'s actual output rather than against
 * `resolvePageStyles` called directly. The renderer derives its style input
 * BEFORE it resolves, so resolving a raw document prunes nothing and would agree
 * with any derivation at all — including the two this file exists to separate.
 *
 * @module page-style-trace.test
 */
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AnyBlockDefinition,
  BlockDocument,
  BreakpointSet,
} from "@nextlyhq/blocks-engine";

import { PageRenderer } from "./page-renderer";
import { pageStyleTrace } from "./page-style-trace";
import { createBlockResolver } from "./resolver";

/** The page a server would actually send, read to completion. */
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

const BREAKPOINTS: BreakpointSet = {
  viewport: [{ id: "base", label: "Base" }],
  container: [],
};

const text = {
  name: "acme/text",
  version: 1,
  description: "Text.",
  example: { props: {} },
  render: () => null,
} as unknown as AnyBlockDefinition;

/** A block declaring NO slots whose render asks for a stored one anyway. */
const legacy = {
  name: "acme/legacy",
  version: 1,
  description: "Renders a slot it does not declare.",
  example: { props: {} },
  render: ({ renderSlot }: { renderSlot: (name: string) => unknown }) =>
    renderSlot("legacy"),
} as unknown as AnyBlockDefinition;

/** One styled child, under `parentType`'s slot named `slot`. */
function page(parentType: string, slot: string): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "parent",
        type: parentType,
        version: 1,
        props: {},
        slots: {
          [slot]: [
            {
              id: "child",
              type: "acme/text",
              version: 1,
              props: {},
              styles: { base: { base: { color: "magenta" } } },
            },
          ],
        },
      },
    ],
  } as unknown as BlockDocument;
}

describe("the tree an editor's cascade read is compiled from", () => {
  it("keeps a child under a slot the definition does not declare", async () => {
    /*
     * `renderSlot` reads the stored slot by name and never consults the
     * resolver, so a definition that dropped a slot while documents still carry
     * it — or any block rendering a name it never declared — puts those children
     * on the page. The preparation pipeline's last pass assumes the opposite.
     *
     * The RENDER half is asserted first and separately: without it an absent
     * rule would be the correct answer, and the trace assertion would be
     * measuring a preference rather than a defect.
     */
    const resolver = createBlockResolver([legacy, text]);
    const document = page("acme/legacy", "legacy");

    const html = await renderToHtml(
      <PageRenderer
        document={document}
        blocks={resolver}
        styleContext={{ breakpoints: BREAKPOINTS }}
      />
    );
    expect(html).toContain("magenta");

    const trace = pageStyleTrace({
      document,
      styleContext: { breakpoints: BREAKPOINTS },
      site: undefined,
      blocks: resolver,
    });

    expect(trace?.map(entry => entry.property)).toContain("color");
  });

  it("drops a child whose parent renders as a placeholder", async () => {
    /*
     * The mirror image, and the reason the fix is one pass rather than none. A
     * placeholder replaces its node AND everything the node contained, so a
     * perfectly healthy child of an unregistered parent reaches no markup and
     * its rules are in no sheet. Reported anyway, the panel would name a source
     * for a control on a block that is not on the page — the over-report this
     * feature refuses everywhere else.
     */
    const resolver = createBlockResolver([text]);
    const document = page("acme/never-registered", "children");

    const html = await renderToHtml(
      <PageRenderer
        document={document}
        blocks={resolver}
        styleContext={{ breakpoints: BREAKPOINTS }}
      />
    );
    expect(html).not.toContain("magenta");

    const trace = pageStyleTrace({
      document,
      styleContext: { breakpoints: BREAKPOINTS },
      site: undefined,
      blocks: resolver,
    });

    // Not `toBeUndefined`: the read succeeded and answered. What it must not
    // carry is the pruned child's declaration.
    expect(trace).toBeDefined();
    expect(trace?.map(entry => entry.property)).not.toContain("color");
  });
});
