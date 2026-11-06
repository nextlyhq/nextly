/**
 * A prepared document gated again once the entry its page shows is known.
 *
 * A route prepares a page before it reads anything, which holds every
 * conditioned block back. Once the entry is read, the page is gated again by
 * its conditions, reusing what was composed and migrated, and the renderer is
 * handed the result as it is handed any preparation: the blocks whose
 * conditions held are drawn, and the rest stay out.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ConditionSubject,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./blocks";
import {
  heldConditionsOf,
  prepareDocument,
  readStagesFor,
  regateDocument,
} from "./prepare-document";
import { createBlockResolver } from "./resolver";

const resolver = createBlockResolver([...coreBlocks]);

const heading = (id: string, text: string, conditions?: unknown): BlockNode =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: 2 },
    ...(conditions === undefined ? {} : { visibility: { conditions } }),
  }) as BlockNode;

const page = (...nodes: BlockNode[]): BlockDocument =>
  ({
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  }) as BlockDocument;

const entry = (tier: string): ConditionSubject => ({
  fields: {
    declared: new Set(["tier"]),
    readable: [{ name: "tier", type: "text" }],
  },
  values: { tier },
});

const vip = [[{ field: "tier", op: "equals", value: "vip" }]];

const ids = (document: BlockDocument | undefined) =>
  document?.nodes.map(node => node.id);

describe("a prepared page gated by its entry", () => {
  const stored = page(
    heading("open", "Everyone"),
    heading("members", "VIP only", vip)
  );

  it("holds a conditioned block back until its entry is known", () => {
    const prepared = prepareDocument(stored, { resolver });
    expect(ids(prepared?.presented)).toEqual(["open"]);
  });

  it("draws a block whose conditions hold for the entry, and names it held", () => {
    const prepared = prepareDocument(stored, { resolver });
    const regated = regateDocument(prepared!, { entry: entry("vip") });
    expect(ids(regated?.prepared.presented)).toEqual(["open", "members"]);
    expect([...heldConditionsOf(regated!.prepared)]).toEqual(["members"]);
    // The renderer, handed it for the same document, draws the same tree.
    const stages = readStagesFor(stored, { resolver }, regated!.prepared);
    expect(ids(stages?.prepared)).toEqual(["open", "members"]);
  });

  it("keeps a block out whose conditions don't hold", () => {
    const prepared = prepareDocument(stored, { resolver });
    const regated = regateDocument(prepared!, { entry: entry("free") });
    expect(ids(regated?.prepared.presented)).toEqual(["open"]);
    expect(heldConditionsOf(regated!.prepared).size).toBe(0);
  });

  it("presents every conditioned block when asked to keep them all, for a route's reads", () => {
    const prepared = prepareDocument(stored, { resolver });
    const kept = regateDocument(prepared!, "keep-all");
    expect(ids(kept?.prepared.presented)).toEqual(["open", "members"]);
    // Kept for reading only: none of them is named held.
    expect(heldConditionsOf(kept!.prepared).size).toBe(0);
  });

  it("refuses a preparation it did not make", () => {
    expect(
      regateDocument({ presented: stored } as never, { entry: entry("vip") })
    ).toBeNull();
  });

  it("names nothing held for a document prepared without an entry", () => {
    const prepared = prepareDocument(stored, { resolver });
    expect(heldConditionsOf(prepared!).size).toBe(0);
  });
});

describe("a held block among repeated addresses", () => {
  it("names held only a block the drawn tree keeps where its entry decides it", () => {
    // A list's item decides the first "x"; a later "x" outside the list holds
    // for the entry, and address repair keeps the first.
    const list = {
      id: "l",
      type: "core/collection-loop",
      version: 1,
      props: { collection: "posts" },
      slots: { children: [heading("x", "Per item", vip)] },
    } as BlockNode;
    const stored = page(list, heading("x", "Repeated", vip));
    const prepared = prepareDocument(stored, { resolver });
    const regated = regateDocument(prepared!, { entry: entry("vip") });
    expect(heldConditionsOf(regated!.prepared).has("x")).toBe(false);
  });
});

describe("a conditioned component placement", () => {
  it("is composed once its conditions hold, rather than drawn as a placeholder", () => {
    const placement = {
      id: "p",
      type: "nextly/component-instance",
      version: 1,
      props: { componentId: "card" },
      visibility: { conditions: vip },
    } as BlockNode;
    const card = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [heading("title", "From the card")],
    } as BlockDocument;
    const definitions = new Map([["card", card]]);
    const stored = page(placement);
    const prepared = prepareDocument(stored, { resolver, definitions });
    // Held back until the entry is known.
    expect(prepared?.presented.nodes).toEqual([]);
    const regated = regateDocument(prepared!, { entry: entry("vip") });
    const drawn = regated!.prepared.presented.nodes;
    expect(drawn.map(node => node.type)).toEqual(["core/heading"]);
    // The composed block carries the placement's conditions, held for the entry.
    expect([...heldConditionsOf(regated!.prepared)]).toEqual([drawn[0]!.id]);
    const failing = regateDocument(prepared!, { entry: entry("free") });
    expect(failing!.prepared.presented.nodes).toEqual([]);
  });
});
