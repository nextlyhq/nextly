/**
 * Which definitions a page reaches, and how many reads that costs.
 *
 * The pipeline does not fetch — it takes the definitions it is handed and
 * reports what it could not satisfy. So the question this answers is the one
 * the route owns: which ids to ask for, in how many round trips, and what an
 * unanswered id means to the pass downstream.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  MAX_COMPOSED_DEPTH,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  definitionsFor,
  unsuppliedComponentIds,
  type ComponentSource,
} from "./component-source";

const instance = (id: string, componentId: string): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
});

/** A source over a fixed store that records every batch it was asked for. */
function recording(store: Record<string, BlockDocument>): {
  source: ComponentSource;
  batches: string[][];
} {
  const batches: string[][] = [];
  const source: ComponentSource = ids => {
    batches.push([...ids]);
    const found = new Map<string, BlockDocument>();
    for (const id of ids) {
      if (Object.hasOwn(store, id)) found.set(id, store[id]!);
    }
    return Promise.resolve(found);
  };
  return { source, batches };
}

describe("the definitions a document reaches", () => {
  it("asks for the ids the page names, in one batch", async () => {
    const { source, batches } = recording({
      hero: component([]),
      footer: component([]),
    });

    const found = await definitionsFor(
      page([instance("i1", "hero"), instance("i2", "footer")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["hero", "footer"]]);
    expect([...found.keys()]).toEqual(["hero", "footer"]);
  });

  it("follows a component's own references, one batch per level", async () => {
    // The transitive set is not knowable from the stored page: which
    // components a component holds is a fact about ITS document, so it cannot
    // be discovered without reading it first.
    const { source, batches } = recording({
      outer: component([instance("n1", "middle")]),
      middle: component([instance("n2", "inner")]),
      inner: component([]),
    });

    const found = await definitionsFor(
      page([instance("i1", "outer")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["outer"], ["middle"], ["inner"]]);
    expect([...found.keys()]).toEqual(["outer", "middle", "inner"]);
  });

  it("asks once for a component two others hold", async () => {
    const { source, batches } = recording({
      a: component([instance("n1", "shared")]),
      b: component([instance("n2", "shared")]),
      shared: component([]),
    });

    await definitionsFor(
      page([instance("i1", "a"), instance("i2", "b")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["a", "b"], ["shared"]]);
  });

  it("terminates on a component that reaches itself", async () => {
    // The walk cannot rely on the resolver's cycle refusal: that happens after
    // this, on definitions this has to have finished fetching.
    const { source, batches } = recording({
      loop: component([instance("n1", "loop")]),
    });

    const found = await definitionsFor(
      page([instance("i1", "loop")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["loop"]]);
    expect([...found.keys()]).toEqual(["loop"]);
  });

  it("stops at the depth the resolver refuses past", async () => {
    // Reading further would fetch definitions no render can inline — the
    // resolver answers `composed-depth` before it asks for them — so the bound
    // is the set the page can actually use rather than a safety margin.
    const store: Record<string, BlockDocument> = {};
    for (let i = 0; i < MAX_COMPOSED_DEPTH + 3; i += 1) {
      store[`c${String(i)}`] = component([
        instance(`n${String(i)}`, `c${String(i + 1)}`),
      ]);
    }
    const { source, batches } = recording(store);

    const found = await definitionsFor(
      page([instance("i1", "c0")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toHaveLength(MAX_COMPOSED_DEPTH);
    expect([...found.keys()]).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("leaves an id the store had no row for OUT of the map", async () => {
    // Presence is what separates "nobody published one" from "one is published
    // and cannot be read", and the pipeline reports those as different reasons
    // with different remedies. Recording an absent id would collapse them.
    const { source } = recording({ hero: component([]) });

    const found = await definitionsFor(
      page([instance("i1", "hero"), instance("i2", "never-published")]),
      source,
      DEFAULT_LIMITS
    );

    expect(found.has("hero")).toBe(true);
    expect(found.has("never-published")).toBe(false);
  });

  it("asks once for an id the store has no row for, however often it recurs", async () => {
    // A miss never enters the map — its absence is what makes the pipeline
    // report it `missing` rather than `unreadable` — so the map cannot double
    // as the record of what has been looked for. Without a separate one, a
    // component several definitions reference is re-queried at every level,
    // and each retry spends a chunk and a budget claim that a later valid
    // definition then does not get.
    const { source, batches } = recording({
      a: component([instance("n1", "gone"), instance("n2", "b")]),
      b: component([instance("n3", "gone")]),
    });

    const found = await definitionsFor(
      page([instance("i1", "a")]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["a"], ["gone", "b"]]);
    expect(found.has("gone")).toBe(false);
  });

  it("fetches the component an OVERRIDE names, not the one stored", async () => {
    // The case a raw walk cannot see. `outer` stores an instance of `default`
    // and exposes its `componentId`; the page overrides it to `chosen`. A scan
    // of stored props finds `default` and the resolver asks for `chosen`, so
    // the page renders a component it was given as missing.
    const { source, batches } = recording({
      outer: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "component",
        nodes: [instance("n1", "default")],
        exposed: [
          {
            id: "which",
            label: "Which",
            nodeId: "n1",
            propPath: "componentId",
            type: "text",
          },
        ],
      } as unknown as BlockDocument,
      default: component([]),
      chosen: component([]),
    });

    const found = await definitionsFor(
      {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "i1",
            type: COMPONENT_INSTANCE_TYPE,
            version: 1,
            props: { componentId: "outer", overrides: { which: "chosen" } },
          },
        ],
      },
      source,
      DEFAULT_LIMITS
    );

    expect(found.has("chosen")).toBe(true);
    expect(batches.flat()).toContain("chosen");
    // And the stored default is never asked for. Without this the test passes
    // on a discovery that fetches BOTH — which resolves the page correctly and
    // pays for a definition no render inlines, so the assertion that the
    // override was FOLLOWED cannot be told from one that it was merely added.
    expect(found.has("default")).toBe(false);
    expect(batches.flat()).not.toContain("default");
  });

  it("keeps discovering on a page whose node cap is smaller than its component count", async () => {
    // `maxNodes` bounds nodes in the composed OUTPUT; discovery counts
    // definitions TRAVERSED. They are unrelated quantities, and tying one to
    // the other stops the walk on a page that composes perfectly well: one
    // node, one component, and one empty component inside it.
    const { source } = recording({
      a: component([instance("n1", "b")]),
      b: component([]),
    });

    const found = await definitionsFor(page([instance("i1", "a")]), source, {
      ...DEFAULT_LIMITS,
      maxNodes: 1,
    });

    expect([...found.keys()]).toEqual(["a", "b"]);
  });

  it("never asks for a component the resolver will not reach", async () => {
    // A condition-gated instance is dropped with its whole subtree before a
    // reader sees it, so the resolver never asks for its component. A walk of
    // the stored nodes reports it anyway — which is both a read nobody needs
    // and, on a page with many of them, an allowance spent before the visible
    // component is reached.
    const gate = { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] };
    const { source, batches } = recording({
      shown: component([]),
      hidden: component([]),
    });

    const found = await definitionsFor(
      page([
        instance("i1", "shown"),
        { ...instance("i2", "hidden"), visibility: gate },
      ]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([["shown"]]);
    expect(found.has("hidden")).toBe(false);
  });

  it("keeps a definition answered under an id nobody asked for", async () => {
    // A source answers with the id it read off the row, and an `afterRead`
    // hook may rewrite that. Merging an answer filed under an unrequested key
    // lets one component's document stand in for another's, and the reference
    // that really named it is never fetched.
    const batches: string[][] = [];
    const source: ComponentSource = ids => {
      batches.push([...ids]);
      const found = new Map<string, BlockDocument>();
      // Answers `outer` correctly, and smuggles a second entry under a key
      // that was not requested.
      if (ids.includes("outer")) {
        found.set("outer", component([instance("n1", "inner")]));
        found.set(
          "inner",
          component([{ id: "wrong", type: "core/text", version: 1, props: {} }])
        );
      }
      return Promise.resolve(found);
    };

    const found = await definitionsFor(
      page([instance("i1", "outer")]),
      source,
      DEFAULT_LIMITS
    );

    // `inner` is fetched by the round that actually asks for it, never taken
    // from the answer that volunteered it.
    expect(batches).toEqual([["outer"], ["inner"]]);
    expect(found.has("inner")).toBe(false);
  });

  it("stops at the discovery allowance even when one round exceeds it", async () => {
    // The allowance has to CLAMP the batch, not merely be checked before it.
    // A single round can expose more ids than the cap — a page naming twelve
    // hundred components does — so a check in front of an unbounded batch caps
    // nothing at all.
    const store: Record<string, BlockDocument> = {};
    const roots: BlockNode[] = [];
    for (let i = 0; i < 1200; i += 1) {
      store[`c${String(i)}`] = component([]);
      roots.push(instance(`i${String(i)}`, `c${String(i)}`));
    }
    const { source, batches } = recording(store);

    const found = await definitionsFor(page(roots), source, DEFAULT_LIMITS);

    expect(batches.flat().length).toBeLessThanOrEqual(1000);
    expect(found.size).toBeLessThanOrEqual(1000);
  });

  it("asks for nothing when the page holds no instance", async () => {
    const { source, batches } = recording({ hero: component([]) });

    const found = await definitionsFor(
      page([{ id: "a", type: "core/text", version: 1, props: {} }]),
      source,
      DEFAULT_LIMITS
    );

    expect(batches).toEqual([]);
    expect(found.size).toBe(0);
  });
});

describe("the components a source could not supply", () => {
  it("names an instance nothing answered for", async () => {
    const { source } = recording({});

    const missing = await unsuppliedComponentIds(
      page([instance("i1", "hero")]),
      source,
      DEFAULT_LIMITS
    );

    expect(missing).toEqual(["hero"]);
  });

  it("names nothing when every instance was supplied", async () => {
    const { source } = recording({ hero: component([]) });

    const missing = await unsuppliedComponentIds(
      page([instance("i1", "hero")]),
      source,
      DEFAULT_LIMITS
    );

    expect(missing).toEqual([]);
  });

  it("does NOT name ids discovery never got to ask about", async () => {
    // Past the discovery cap the loop stops querying, and the resolver still
    // wants the remainder. Those are holes in the page — but nobody failed to
    // publish them, and a caller told they are "not published" is offered a
    // remedy that cannot work: publishing them again changes nothing, because
    // they were never requested. Exhausting the cap is a different problem.
    const roots = Array.from({ length: 1200 }, (_, i) => `c${String(i)}`);
    const store = Object.fromEntries(roots.map(id => [id, component([])]));
    const { source, batches } = recording(store);

    const missing = await unsuppliedComponentIds(
      page(roots.map((id, i) => instance(`i${String(i)}`, id))),
      source,
      DEFAULT_LIMITS
    );

    // Every id the source WAS asked for came back, so nothing is unsupplied —
    // even though the resolver is still short of definitions.
    const asked = new Set(batches.flat());
    expect(asked.size).toBeLessThan(roots.length);
    expect(missing).toEqual([]);
  });
});
