/**
 * Which rendered elements tell an editor they belong to a component instance.
 *
 * A component is inlined at render: the instance node is replaced by the tree
 * its definition describes, so every element inside one carries a node id the
 * page's own document does not contain. An editor hit-testing on the node
 * address alone therefore resolves a click inside a component to an address it
 * cannot select, edit or delete.
 *
 * The discrimination is the whole point, and it runs the other way too. An
 * instance's SLOT CONTENT is nested inside that inlined tree and belongs to the
 * page — it is exactly what a marketer opened the editor to change — so it must
 * stay directly selectable. A marker painted on everything under an instance
 * would take that away, and would look correct in any test that only checked
 * the definition's own nodes.
 *
 * @module instance-marker.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type AnyBlockDefinition,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { INSTANCE_ATTRIBUTE, NODE_ID_ATTRIBUTE } from "./block-boundary";
import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/**
 * A definition with a SLOT: a box the page fills, holding a fallback of its own.
 *
 * The slot is the point. Without one, "page-owned content stays unmarked" can
 * only be asserted about a top-level sibling, which no plausible wrong
 * implementation would mark anyway — so the assertion passes while the case the
 * module exists for goes untested.
 */
const HERO: BlockDocument = {
  formatVersion: 1,
  kind: "component",
  slots: { body: { label: "Body", nodeId: "d1", slot: "children" } },
  nodes: [
    {
      id: "d1",
      type: "core/box",
      version: 1,
      props: {},
      slots: {
        children: [
          {
            id: "d2",
            type: "core/heading",
            version: 1,
            props: { text: "The definition's fallback" },
          },
        ],
      },
    },
  ],
} as unknown as BlockDocument;

/**
 * A page placing that component, FILLING its slot, beside a block of its own.
 *
 * `supplied` is nested inside the inlined tree and belongs to the page;
 * `own` is an ordinary sibling. Both must stay unmarked, and only the first
 * discriminates.
 */
const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "hero" },
      slots: {
        body: [
          {
            id: "supplied",
            type: "core/heading",
            version: 1,
            props: { text: "The page's own, inside the slot" },
          },
        ],
      },
    },
    {
      id: "own",
      type: "core/heading",
      version: 1,
      props: { text: "The page's own" },
    },
  ],
} as unknown as BlockDocument;

function render(forEditor: boolean): string {
  return renderToStaticMarkup(
    <PageRenderer
      document={PAGE}
      blocks={createBlockResolver(coreBlocks as AnyBlockDefinition[])}
      definitions={new Map([["hero", HERO]])}
      {...(forEditor ? { nodeAttribute: true } : {})}
    />
  );
}

describe("marking the elements a component instance owns", () => {
  it("names the INSTANCE on a node the definition supplied", async () => {
    // Without this the editor holds an id it cannot act on: `d1` is the
    // definition's node and the page's document has no such entry.
    const markup = render(true);

    expect(markup).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
  });

  it("leaves SLOT CONTENT the page supplied unmarked, so it stays selectable", async () => {
    // THE case the marker exists to get right, and the one a sibling cannot
    // stand in for. This node is nested inside the inlined tree — under the
    // definition's own box — and belongs to the page. It is exactly what a
    // marketer opened the editor to change, so marking it would redirect their
    // click to the component instead.
    //
    // An implementation that marked everything under an instance passes the
    // sibling assertion below and fails this one.
    const markup = render(true);

    const supplied =
      /<[^>]*data-nx-node="supplied"[^>]*>/.exec(markup)?.[0] ?? "";
    // Present first: an absent node is trivially unmarked, which would let a
    // resolver that dropped the slot content satisfy the real assertion.
    expect(supplied).not.toBe("");
    expect(supplied).not.toContain(INSTANCE_ATTRIBUTE);
  });

  it("marks the definition's own box, whose id the page cannot address", async () => {
    // The other half of the discrimination, and the reason the marker exists at
    // all: the resolver RE-MINTS ids for definition-owned nodes, so this box
    // renders under an id the page's document has never contained. Addressed by
    // node id alone an editor would resolve a click here to nothing; the
    // instance is the only thing it can act on.
    //
    // Asserted by the definition-owned element rather than by a fixed id, for
    // exactly that reason — writing `d1` here would be asserting an id the
    // renderer is free to mint differently, which is how this test first failed.
    const markup = render(true);

    const box = /<div[^>]*nx-bt-core--box[^>]*>/.exec(markup)?.[0] ?? "";
    expect(box).not.toBe("");
    expect(box).toContain(`${INSTANCE_ATTRIBUTE}="i1"`);
    // The re-minting is the premise, so it is pinned rather than assumed.
    expect(box).not.toContain('data-nx-node="d1"');
  });

  it("leaves the page's OWN sibling unmarked", async () => {
    // The weaker control, kept because it is cheap and it pins the ordinary
    // case. It does NOT discriminate on its own — see the slot case above.
    const markup = render(true);

    const own = /<[^>]*data-nx-node="own"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(own).not.toBe("");
    expect(own).not.toContain(INSTANCE_ATTRIBUTE);
  });

  it("writes nothing at all on a published page", async () => {
    // The property is real and worth pinning: this marker is the editor's own
    // namespace and has no business on a served page.
    //
    // It does NOT pin the `nodeAttribute` guard beside the emission, and saying
    // so is the point. Measured: removing that guard leaves this green, because
    // the boundary's editor-marker step is not reached at all on a published
    // render of this node — something upstream already decided. The guard stays
    // because its siblings carry it and it costs nothing, but a regression in
    // the guard alone would not be caught here, and a reader should not take
    // this green as evidence that it would.
    const markup = render(false);

    expect(markup).not.toContain(INSTANCE_ATTRIBUTE);
    // The control on the control: the published render really did draw the
    // component and its slot content, so the absence above is the marker being
    // withheld rather than the instance failing to resolve.
    expect(markup).toContain("nx-bt-core--box");
    expect(markup).toContain("The page&#x27;s own, inside the slot");
    expect(markup).not.toContain(NODE_ID_ATTRIBUTE);
  });
});
