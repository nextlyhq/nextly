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

/** A definition whose body is one heading, plus a slot the page fills. */
const HERO: BlockDocument = {
  formatVersion: 1,
  kind: "component",
  nodes: [
    {
      id: "d1",
      type: "core/heading",
      version: 1,
      props: { text: "From the definition" },
    },
  ],
} as unknown as BlockDocument;

/** A page placing that component beside a block of its own. */
const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "i1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "hero" },
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

  it("leaves the page's OWN block unmarked, so it stays selectable", async () => {
    // The control that gives the case above its meaning. A marker written for
    // every node would satisfy that assertion while making the whole page read
    // as one component.
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
    // component, so the absence above is the marker being withheld rather than
    // the instance failing to resolve.
    expect(markup).toContain("From the definition");
    expect(markup).not.toContain(NODE_ID_ATTRIBUTE);
  });
});
