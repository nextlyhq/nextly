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

import { definitionsFor, type ComponentSource } from "./component-source";

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
