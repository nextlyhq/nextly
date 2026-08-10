/**
 * The passes every reader shares, and the order they run in.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { prepareDocumentForRead } from "./prepare-document";
import { createBlockResolver } from "./resolver";

/** A registered node, so the test isolates duplicate-id repair from resolution. */
function heading(id: string, text: string) {
  return { id, type: "core/heading", version: 1, props: { text } };
}

describe("prepareDocumentForRead", () => {
  it("returns null when every node was a placeholder", () => {
    // `null` names a page that presents nothing but placeholders. Handing back
    // the empty document instead would report "no content" for a page that HAS
    // content it cannot render, and a caller spreading its own fallbacks would
    // describe the page as empty rather than as unreadable.
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        { id: "1", type: "plugin/unregistered", version: 1, props: {} },
        { id: "2", type: "plugin/also-unknown", version: 1, props: {} },
      ],
    };

    expect(
      prepareDocumentForRead(document, {
        resolver: createBlockResolver(coreBlocks),
      })
    ).toBeNull();
  });

  it("keeps an already-empty document empty rather than null", () => {
    // Nothing was withheld there, so it is a page with no content — the other
    // side of the distinction, and the positive control that stops the check
    // above from passing for a function that returns null too eagerly.
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [],
    };

    expect(
      prepareDocumentForRead(document, {
        resolver: createBlockResolver(coreBlocks),
      })
    ).toEqual(document);
  });

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
