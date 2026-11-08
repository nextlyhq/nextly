/**
 * An editor judging a page's conditions for an entry, as it shows the page
 * to a visitor reading that entry: every block judged exactly as the page's
 * route judges it, a placed component's own among them, one they hide drawn
 * as the editor's own node in its place. Never asked by a published page.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ConditionSubject,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import { PageRenderer } from "./page-renderer";
import {
  prepareDocument,
  prepareDocumentAsDrawn,
  regateDocument,
} from "./prepare-document";
import { createBlockResolver } from "./resolver";
import type { EntryJudgement } from "./visibility";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

const resolver = createBlockResolver([...coreBlocks]);

const text = (id: string, words: string, conditions?: unknown): BlockNode =>
  ({
    id,
    type: "core/text",
    version: 1,
    props: { text: words },
    ...(conditions === undefined ? {} : { visibility: { conditions } }),
  }) as BlockNode;

const vip = [[{ field: "tier", op: "equals", value: "vip" }]];
const named = [[{ field: "tier", op: "exists" }]];

/** A component: one block for VIPs, one for anyone with a tier. */
const PROMO: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    text("vip-offer", "VIP offer", vip),
    text("tier-note", "Tier note", named),
  ],
};
const DEFINITIONS = new Map([["promo", PROMO]]);

/** A page with a block of its own and the component placed once. */
const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    text("intro", "Welcome"),
    {
      id: "placed",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "promo" },
    },
  ],
};

const entry = (tier: string): ConditionSubject => ({
  fields: {
    declared: new Set(["tier"]),
    readable: [{ name: "tier", type: "text" }],
  },
  values: { tier },
});

/** Every block of a tree, depth first. */
function blocksOf(nodes: readonly BlockNode[]): BlockNode[] {
  return nodes.flatMap(node => [
    node,
    ...blocksOf(Object.values(node.slots ?? {}).flat()),
  ]);
}

/** The marker an editor draws for a hidden block, keeping its placement. */
const marker = (node: BlockNode): BlockNode =>
  ({
    id: node.id,
    type: "core/text",
    version: 1,
    props: { text: `Hidden: ${node.id}` },
    instanceOf: (node as ResolvedBlockNode).instanceOf,
  }) as BlockNode;

function judgement(tier: string): EntryJudgement & {
  readonly judged: Map<string, boolean>;
  readonly asked: BlockNode[];
} {
  const judged = new Map<string, boolean>();
  const asked: BlockNode[] = [];
  return {
    entry: entry(tier),
    hiddenAs: node => {
      asked.push(node);
      return marker(node);
    },
    onJudged: (id, shown) => judged.set(id, shown),
    judged,
    asked,
  };
}

describe("an editor judging a page's conditions for an entry", () => {
  it("judges a placed component's blocks exactly as the route does", () => {
    const prepared = prepareDocument(PAGE, {
      resolver,
      definitions: DEFINITIONS,
    });
    if (prepared === null) throw new Error("the page prepares");
    const routed = regateDocument(prepared, { entry: entry("gold") });
    const served = new Set(
      blocksOf(routed?.prepared.presented.nodes ?? []).map(node => node.id)
    );
    const judge = judgement("gold");
    const drawn = prepareDocumentAsDrawn(PAGE, {
      resolver,
      definitions: DEFINITIONS,
      entryJudged: judge,
    });
    const drawnIds = blocksOf(drawn?.nodes ?? []).map(node => node.id);
    const hidden = [...judge.judged].filter(([, shown]) => !shown);
    const shown = [...judge.judged].filter(([, shown]) => shown);
    // CONTROL: the route served the tier note and hid the VIP offer.
    expect(hidden).toHaveLength(1);
    expect(shown).toHaveLength(1);
    for (const [id] of shown) expect(served.has(id)).toBe(true);
    for (const [id] of hidden) {
      expect(served.has(id)).toBe(false);
      // Drawn in its place as the editor's own node.
      expect(drawnIds).toContain(id);
    }
    // Everything else the editor draws is what the route serves.
    expect(new Set(drawnIds)).toEqual(
      new Set([...served, ...hidden.map(([id]) => id)])
    );
  });

  it("keeps the hidden block's placement on what it draws in its place", () => {
    const judge = judgement("gold");
    prepareDocumentAsDrawn(PAGE, {
      resolver,
      definitions: DEFINITIONS,
      entryJudged: judge,
    });
    expect(judge.asked).toHaveLength(1);
    expect((judge.asked[0] as ResolvedBlockNode).instanceOf).toBe("placed");
  });

  it("draws the marker, and the block its conditions hold for, in the page", async () => {
    const html = await renderToHtml(
      <PageRenderer
        document={PAGE}
        blocks={resolver}
        definitions={DEFINITIONS}
        siteStyles={false}
        entryJudged={judgement("gold")}
      />
    );
    expect(html).toContain("Tier note");
    expect(html).not.toContain("VIP offer");
    expect(html).toMatch(/Hidden: /);
  });

  it("judges for the entry even when handed a route's preparation", async () => {
    const prepared = prepareDocument(PAGE, {
      resolver,
      definitions: DEFINITIONS,
    });
    if (prepared === null) throw new Error("the page prepares");
    const judge = judgement("gold");
    const html = await renderToHtml(
      <PageRenderer
        document={PAGE}
        blocks={resolver}
        definitions={DEFINITIONS}
        siteStyles={false}
        prepared={prepared}
        entryJudged={judge}
      />
    );
    // The route's preparation held both component blocks back; the editor's
    // judgement draws the one that holds and the other's marker.
    expect(html).toContain("Tier note");
    expect(html).toMatch(/Hidden: /);
    expect(judge.judged.size).toBe(2);
  });

  it("changes nothing where no editor asks: a component's conditioned blocks are held back as before", async () => {
    const html = await renderToHtml(
      <PageRenderer
        document={PAGE}
        blocks={resolver}
        definitions={DEFINITIONS}
        siteStyles={false}
      />
    );
    expect(html).toContain("Welcome");
    expect(html).not.toContain("Tier note");
    expect(html).not.toContain("VIP offer");
  });
});
