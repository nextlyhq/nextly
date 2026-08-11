/**
 * The passes every reader shares, and the order they run in.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { defineBlock } from "./context";
import { prepareDocumentForRead } from "./prepare-document";
import { createBlockResolver } from "./resolver";

/** A registered node, so the test isolates duplicate-id repair from resolution. */
function heading(id: string, text: string): BlockNode {
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

  it("drops a slot the block's definition does not declare", () => {
    // A leaf never calls `renderSlot`, so a stored slot left by a hand edit or
    // by a definition that dropped one is not on the page. The style compiler
    // walks every STORED slot, so leaving it would compile its descendants'
    // rules — and any `url(...)` they carry — into the sheet for markup nobody
    // receives.
    const leaf: BlockNode = {
      id: "1",
      type: "core/heading",
      version: 1,
      props: { text: "Real" },
      slots: { children: [heading("2", "Ghost")] },
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [leaf],
    };

    const prepared = prepareDocumentForRead(document, {
      resolver: createBlockResolver(coreBlocks),
    });

    expect(prepared?.nodes[0]?.slots).toEqual({});
  });

  it("keeps the slots a container DOES declare", () => {
    // The positive control. Without it the check above passes for a function
    // that strips every slot, which would empty every container on the page.
    const box: BlockNode = {
      id: "1",
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [heading("2", "Kept")] },
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [box],
    };

    const prepared = prepareDocumentForRead(document, {
      resolver: createBlockResolver(coreBlocks),
    });

    expect(prepared?.nodes[0]?.slots?.children).toHaveLength(1);
  });

  it("keeps a fully GATED page empty rather than unreadable", () => {
    // Nothing failed to render here: every block was withheld on purpose for
    // this visitor. Reporting `null` would show an unsupported-content fallback
    // for a page working exactly as configured, and `null` names the other
    // case — content that survived gating and then could not be rendered.
    const gated = heading("1", "Members only");
    gated.visibility = {
      conditions: [[{ field: "tier", op: "eq", value: "x" }]],
    };
    const document: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [gated],
    };

    const prepared = prepareDocumentForRead(document, {
      resolver: createBlockResolver(coreBlocks),
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.nodes).toEqual([]);
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

  describe("slot order", () => {
    /**
     * Two slots, so declaration order and stored order can disagree.
     *
     * Written here rather than borrowed from the catalogue because every core
     * block declares exactly one slot, and a single-slot fixture cannot tell
     * the two orders apart — it would pass whichever order the code emitted.
     */
    const panel = defineBlock({
      name: "test/panel",
      version: 1,
      description: "Two slots, so the two orders can disagree.",
      example: { props: {} },
      slots: { header: {}, footer: {} },
      render: () => null,
    });

    const resolver = createBlockResolver([...coreBlocks, panel]);

    function panelWith(slots: Record<string, BlockNode[]>): BlockDocument {
      return {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [{ id: "1", type: "test/panel", version: 1, props: {}, slots }],
      };
    }

    it("emits slots in the order the definition declares them", () => {
      // The renderer asks for its slots by calling `renderSlot` once per
      // declaration, so declaration order is the order the page presents. A
      // tree documented as render-equivalent that carried stored order would
      // describe a page nobody is served.
      const prepared = prepareDocumentForRead(
        panelWith({
          footer: [heading("2", "Bottom")],
          header: [heading("3", "Top")],
        }),
        { resolver }
      );

      expect(Object.keys(prepared?.nodes[0]?.slots ?? {})).toEqual([
        "header",
        "footer",
      ]);
    });

    it("leaves a declared but unstored slot absent", () => {
      // This pass repairs what a reader would mis-render, and an empty slot
      // renders nothing whether its key is present or not. Adding it would
      // rewrite every document that omits an optional slot.
      const prepared = prepareDocumentForRead(
        panelWith({ footer: [heading("2", "Bottom")] }),
        { resolver }
      );

      expect(Object.keys(prepared?.nodes[0]?.slots ?? {})).toEqual(["footer"]);
    });

    it("still drops an undeclared slot while reordering the rest", () => {
      // Reordering and pruning compose on one node rather than only being
      // correct apart. The ghost sits BETWEEN two declared slots, so an
      // implementation that filtered in place would have to reorder around a
      // gap; this one selects by declaration and never sees it.
      const prepared = prepareDocumentForRead(
        panelWith({
          footer: [heading("2", "Bottom")],
          ghost: [heading("3", "Nowhere")],
          header: [heading("4", "Top")],
        }),
        { resolver }
      );

      expect(Object.keys(prepared?.nodes[0]?.slots ?? {})).toEqual([
        "header",
        "footer",
      ]);
    });
  });
});
