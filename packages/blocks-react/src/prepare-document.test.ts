/**
 * The passes every reader shares, and the order they run in.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { prepareDocumentForRead } from "./prepare-document";
import { createBlockResolver } from "./resolver";

function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text } };
}

describe("prepareDocumentForRead", () => {
  it("does not let a placeholder's child reserve an id the page still uses", () => {
    // The unregistered container renders as a placeholder, which replaces its
    // whole subtree — so its child is not on the page and holds no address.
    // Deduping without that predicate lets the child claim `shared` first, drops
    // the real heading that reuses it, and then the placeholder prune removes
    // the container and its child too, leaving the page with NEITHER node.
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "container",
          type: "plugin/unregistered",
          version: 1,
          props: {},
          slots: { children: [heading("shared", "Ghost")] },
        },
        heading("shared", "Real"),
      ],
    };

    const prepared = prepareDocumentForRead(document, {
      resolver: createBlockResolver(coreBlocks),
    });

    expect(prepared?.nodes.map(node => node.props.text)).toEqual(["Real"]);
  });
});
