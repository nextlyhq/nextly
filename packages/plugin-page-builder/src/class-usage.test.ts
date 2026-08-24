/**
 * Whether a page's class references can be read from data nobody validated.
 *
 * This runs inside a write hook, so its failure mode is not a wrong number — it
 * is an author's save failing over a bookkeeping record. Every case below is a
 * shape that reaches storage today: `documentFrom` admits any value whose
 * `nodes` is an array, and a real crash has already been measured in this
 * package's neighbour from `Object.values(null)` on a stored style tier.
 *
 * @module class-usage.test
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMITS,
  MAX_CLASSES_PER_NODE,
  MAX_NAMED_CLASS_NAME_LENGTH,
  MAX_NODES,
} from "@nextlyhq/blocks-engine";
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import { classUsageOf } from "./class-usage";

/**
 * The ids alone, for the cases that are about WHICH classes are found.
 *
 * Completeness has its own tests below; folding it into every assertion here
 * would say nothing extra about traversal, bounds or malformed input, which is
 * what these cases exist to pin.
 */
const classIdsUsedBy = (stored: unknown, limits?: DocumentLimits) =>
  classUsageOf(stored, limits).ids;

/** A document holding one node with the given `classes` value. */
const withClasses = (classes: unknown) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "n1", type: "core/text", version: 1, props: {}, classes }],
});

describe("the classes a page references", () => {
  it("reads them from every depth, not just the top level", () => {
    // Slots nest arbitrarily, and a class applied inside a container is as real
    // a usage as one at the root — a count that saw only top-level nodes would
    // read low exactly on the pages that are laid out rather than flat.
    expect(
      classIdsUsedBy({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: "core/box",
            version: 1,
            props: {},
            classes: ["outer"],
            slots: {
              default: [
                {
                  id: "n2",
                  type: "core/text",
                  version: 1,
                  props: {},
                  classes: ["inner"],
                },
              ],
            },
          },
        ],
      })
    ).toEqual(["inner", "outer"]);
  });

  it("reports each class ONCE however many nodes carry it", () => {
    // The question is "which classes does this page reference", not "how many
    // nodes use them". A page using one class on forty nodes is one page in
    // that class's count, and a list with repeats would make it forty.
    expect(
      classIdsUsedBy({
        formatVersion: 1,
        kind: "page",
        nodes: [
          { id: "a", type: "t", version: 1, props: {}, classes: ["card"] },
          { id: "b", type: "t", version: 1, props: {}, classes: ["card"] },
        ],
      })
    ).toEqual(["card"]);
  });

  it("is SORTED, so two pages referencing the same classes read identically", () => {
    // What lets a caller compare a stored list against a freshly derived one
    // with a plain equality check rather than set arithmetic.
    expect(
      classIdsUsedBy({
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "a",
            type: "t",
            version: 1,
            props: {},
            classes: ["z", "a", "m"],
          },
        ],
      })
    ).toEqual(["a", "m", "z"]);
  });
});

describe("what a document nobody validated costs", () => {
  it.each([
    ["null", null],
    ["a string", "not a document"],
    ["an array", []],
    ["no nodes at all", { formatVersion: 1, kind: "page" }],
    [
      "nodes that are not an array",
      { formatVersion: 1, kind: "page", nodes: null },
    ],
    ["nodes as a string", { formatVersion: 1, kind: "page", nodes: "n1" }],
  ])("answers nothing for %s rather than throwing", (_name, document) => {
    expect(() => classIdsUsedBy(document)).not.toThrow();
    expect(classIdsUsedBy(document)).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "card"],
    ["a record", { card: true }],
    ["a number", 3],
  ])("skips a node whose classes field is %s", (_name, classes) => {
    expect(() => classIdsUsedBy(withClasses(classes))).not.toThrow();
    expect(classIdsUsedBy(withClasses(classes))).toEqual([]);
  });

  it("keeps the readable entries of a partly-malformed classes array", () => {
    // Losing the whole node's references over one bad entry would under-count,
    // and under-counting is the direction that gets a class deleted.
    expect(
      classIdsUsedBy(withClasses(["card", null, 7, "hero", undefined]))
    ).toEqual(["card", "hero"]);
  });

  it("ignores an id longer than a class id may be", () => {
    // `isUsableNamedClass` rejects an id past this length before reading
    // anything else, so a longer string cannot match a class this site defines
    // however it reached storage. Skipping it is the correct answer AND the
    // bound on what one corrupt row can make this read.
    const over = "x".repeat(MAX_NAMED_CLASS_NAME_LENGTH + 1);

    expect(classIdsUsedBy(withClasses([over, "real"]))).toEqual(["real"]);
  });

  it("reads a node's classes only as far as the compiler applies them", () => {
    // The bound is the COMPILER's, not one chosen here: it applies the first
    // `MAX_CLASSES_PER_NODE` of a node's list and warns about the rest, so an
    // id past that position is not a reference this page renders. Reading
    // further would report a class as used on a page that never applies it,
    // and block its deletion forever.
    const many = Array.from(
      { length: MAX_CLASSES_PER_NODE + 500 },
      (_, i) => `c${i}`
    );

    expect(classIdsUsedBy(withClasses(many))).toHaveLength(
      MAX_CLASSES_PER_NODE
    );
  });

  it("bounds ENTRIES READ, not distinct ids, so repeats cannot make it scan forever", () => {
    // The two quantities come apart exactly here. An array of a million
    // identical entries holds ONE distinct id, so a bound on the number of ids
    // KEPT never trips however long the array is, and the whole thing is read
    // on every page write.
    //
    // Asserted by COUNTING the reads rather than by the returned list, which
    // cannot see this at all: an unbounded read of repeats returns `["hero"]`
    // exactly as a bounded one does, so a test comparing the result passes
    // whether or not any bound exists.
    let readsPastTheCap = 0;
    const repeats: unknown[] = Array.from(
      { length: MAX_CLASSES_PER_NODE + 200 },
      () => "hero"
    );
    for (let i = MAX_CLASSES_PER_NODE; i < repeats.length; i++) {
      Object.defineProperty(repeats, i, {
        configurable: true,
        enumerable: true,
        get() {
          readsPastTheCap++;
          return "hero";
        },
      });
    }

    expect(classIdsUsedBy(withClasses(repeats))).toEqual(["hero"]);
    expect(readsPastTheCap).toBe(0);
  });

  it("does not let a DEEP first root starve a later top-level sibling", () => {
    // The failure a depth-first walk produced while carrying the same numeric
    // cap as the compiler. Equal limits reached by different walks select
    // different nodes: depth-first spends the whole budget inside the first
    // root, so a class on a later top-level node is styled and rendered while
    // being absent from the record a safe-delete check reads.
    //
    // A small explicit budget rather than the engine default, so the test is
    // about the ORDER rather than about building five thousand nodes — and so
    // it exercises the `limits` parameter a site with raised limits must pass.
    let deep: Record<string, unknown> = {
      id: "deep-leaf",
      type: "core/text",
      version: 1,
      props: {},
      classes: ["buried"],
    };
    for (let i = 0; i < 20; i++) {
      deep = {
        id: `deep-${i}`,
        type: "core/box",
        version: 1,
        props: {},
        classes: [`deep-${i}`],
        slots: { main: [deep] },
      };
    }

    const ids = classIdsUsedBy(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          deep,
          {
            id: "later",
            type: "core/text",
            version: 1,
            props: {},
            classes: ["still-in-use"],
          },
        ],
      },
      { maxNodes: 5, maxDepth: 50, maxBytes: DEFAULT_LIMITS.maxBytes }
    );

    expect(ids).toContain("still-in-use");
  });

  it("stops where the COMPILER stops on depth, not only on count", () => {
    // The other half of matching the compiler's selection. It refuses to style
    // anything below `maxDepth`, so a class applied there is not a reference
    // the page renders — counting it would report a class as used on a page
    // that never applies it, and block its deletion forever.
    let nested: Record<string, unknown> = {
      id: "too-deep",
      type: "core/text",
      version: 1,
      props: {},
      classes: ["past-the-depth-bound"],
    };
    for (let i = 0; i < 4; i++) {
      nested = {
        id: `wrap-${i}`,
        type: "core/box",
        version: 1,
        props: {},
        classes: [`wrap-${i}`],
        slots: { main: [nested] },
      };
    }

    const ids = classIdsUsedBy(
      { formatVersion: 1, kind: "page", nodes: [nested] },
      { maxNodes: 1000, maxDepth: 3, maxBytes: DEFAULT_LIMITS.maxBytes }
    );

    // `wrap-3` is the OUTERMOST node — the loop wraps from the inside out — so
    // it sits at depth 1 and is selected; `wrap-0` is at depth 4 and is not.
    expect(ids).toContain("wrap-3");
    expect(ids).not.toContain("wrap-0");
    expect(ids).not.toContain("past-the-depth-bound");
  });

  it("keeps a live id that appears after thousands of others", () => {
    // The failure a distinct-id cap produced: ids of deleted classes still sit
    // in stored documents, and once enough of them filled the cap every later
    // id was dropped — including one the renderer still applies. That is the
    // under-count direction, the one that lets a class in use be deleted.
    //
    // Spread across nodes rather than one list, because a single node's list is
    // bounded by what the compiler applies; the count that used to be capped
    // was the distinct total across the whole document.
    const nodes = Array.from({ length: 3000 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`stale-${i}`],
    }));
    nodes.push({
      id: "last",
      type: "core/text",
      version: 1,
      props: {},
      classes: ["still-in-use"],
    });

    expect(classIdsUsedBy({ formatVersion: 1, kind: "page", nodes })).toContain(
      "still-in-use"
    );
  });

  it("stops TRAVERSING after the number of nodes a document may hold", () => {
    // The other half of the bound, and the one that keeps the id set finite: a
    // document reaches here unvalidated, so nothing has enforced the node cap
    // before this runs.
    //
    // The tripwire is on nodes PAST the bound, because the returned list cannot
    // tell a bounded traversal from one that walked the whole tree and ignored
    // the tail — both return exactly `MAX_NODES` ids. Reading `classes` is what
    // the callback does with a node it was handed, so a walk that stopped never
    // touches these.
    let readPastTheBound = 0;
    const nodes: unknown[] = Array.from(
      { length: MAX_NODES + 100 },
      (_, i) => ({
        id: `n${i}`,
        type: "core/text",
        version: 1,
        props: {},
        classes: [`c${i}`],
      })
    );
    for (let i = MAX_NODES; i < nodes.length; i++) {
      nodes[i] = {
        id: `n${i}`,
        type: "core/text",
        version: 1,
        props: {},
        get classes(): string[] {
          readPastTheBound++;
          return [`c${i}`];
        },
      };
    }

    expect(
      classIdsUsedBy({ formatVersion: 1, kind: "page", nodes })
    ).toHaveLength(MAX_NODES);
    expect(readPastTheBound).toBe(0);
  });
});

describe("what it must never do", () => {
  // The property the write hook's placement rests on. It runs BEFORE the page
  // row is written, so a throw here fails the author's save over a bookkeeping
  // field — and the hook is only allowed to sit there while this holds.
  //
  // Asserted over a table rather than one shape, because the risk is a shape
  // nobody thought of: every entry is a document the blocks field admits, since
  // it accepts any value whose `nodes` is an array and validates nothing below.
  // A cycle through a property the walk does not follow. Kept because it is a
  // shape that reaches storage, and named for what it actually exercises: the
  // walk descends `slots` alone, so this one never recurses at all and cannot
  // stand in for the case below.
  const cyclicByAnyProperty: Record<string, unknown> = { nodes: [] };
  (cyclicByAnyProperty.nodes as unknown[]).push({
    id: "a",
    classes: [],
    self: cyclicByAnyProperty,
  });

  // A cycle through SLOTS, which is the path the walk recurses on. Before the
  // walk became iterative this exited with a RangeError rather than an answer.
  const cyclicNode: Record<string, unknown> = {
    id: "a",
    classes: ["hero"],
    slots: { main: [] as unknown[] },
  };
  ((cyclicNode.slots as Record<string, unknown[]>).main as unknown[]).push(
    cyclicNode
  );

  const hostile: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
    ["a string", "x"],
    ["no nodes at all", {}],
    ["nodes that are not an array", { nodes: 5 }],
    ["a null node", { nodes: [null] }],
    // A MISSING entry is a separate shape from a null one, and it is the one a
    // guard written against `null` alone lets through: reading a property off
    // `undefined` throws, where reading one off a number or a string does not.
    // So the two primitive cases below cannot evidence that half of the guard —
    // these are what do.
    //
    // Neither shape survives JSON: `stringify` writes both an explicit
    // `undefined` and a hole as `null`, and `[1,,2]` is not parseable at all.
    // They arrive from a producer that builds the document IN PROCESS — a
    // structured clone keeps `undefined` — which is the same range the write
    // hook's own catch covers, and the reason this is asserted rather than
    // argued away.
    ["an undefined node", { nodes: [undefined] }],
    ["a sparse nodes array", { nodes: [, ,] }],
    ["a primitive node", { nodes: [7] }],
    [
      "classes that are not an array",
      { nodes: [{ id: "a", classes: "hero" }] },
    ],
    ["a sparse classes array", { nodes: [{ id: "a", classes: [, , "hero"] }] }],
    [
      "a node whose slots are not arrays",
      { nodes: [{ id: "a", slots: { main: 5 } }] },
    ],
    ["a document with a cycle the walk does not follow", cyclicByAnyProperty],
    ["a node whose slot holds the node itself", { nodes: [cyclicNode] }],
    [
      "a null prototype",
      Object.assign(Object.create(null), {
        nodes: [{ id: "a", classes: ["h"] }],
      }),
    ],
  ];

  it.each(hostile)("answers rather than throwing for %s", (_what, document) => {
    expect(() => classIdsUsedBy(document)).not.toThrow();
  });

  it.each([
    ["text that is not JSON at all", "{ nodes: ["],
    ["JSON that is a bare string", '"hero"'],
    ["JSON that is a number", "7"],
    ["JSON that is null", "null"],
    ["JSON whose nodes are not an array", '{"nodes":5}'],
  ])("answers rather than throwing for stored %s", (_what, stored) => {
    // The string arm exists because the column is `text` on SQLite, so what
    // arrives is whatever bytes are in it — including bytes no writer of this
    // field produced.
    expect(() => classIdsUsedBy(stored)).not.toThrow();
    expect(classIdsUsedBy(stored)).toEqual([]);
  });

  it("reads a document stored as a JSON STRING, so the string arm is not just refusing", () => {
    // The control for the five cases above, which a function that returned an
    // empty list for every string would satisfy completely.
    expect(
      classIdsUsedBy(
        JSON.stringify({ nodes: [{ id: "a", classes: ["hero", "card"] }] })
      )
    ).toEqual(["card", "hero"]);
  });

  it("still reads a well-formed document, so the table is not passing on refusal", () => {
    // The control. Every case above would pass for a function that returned an
    // empty list unconditionally, which is the shape that would satisfy them
    // all while recording nothing.
    expect(
      classIdsUsedBy({ nodes: [{ id: "a", classes: ["hero", "card"] }] })
    ).toEqual(["card", "hero"]);
  });
});

describe("whether the whole document was read", () => {
  it("reports COMPLETE for a document it read to the end", () => {
    // The half that carries the meaning. Without it a caller cannot tell a
    // page that references nothing from one whose document it could not finish,
    // and a delete check reads both as "not used".
    expect(
      classUsageOf({ formatVersion: 1, kind: "page", nodes: [] }).complete
    ).toBe(true);
    expect(classUsageOf(withClasses(["hero"])).complete).toBe(true);
  });

  it("reports INCOMPLETE when a bound stopped the selection", () => {
    // The list is then a PREFIX of the answer rather than the answer, and an id
    // missing from it is missing because the walk stopped — not because the
    // document does not use it.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      type: "core/text",
      version: 1,
      props: {},
      classes: [`c${i}`],
    }));

    const usage = classUsageOf(
      { formatVersion: 1, kind: "page", nodes: many },
      { ...DEFAULT_LIMITS, maxNodes: 5 }
    );

    expect(usage.complete).toBe(false);
    // And it still returns what it DID read, so a caller that wants the prefix
    // for another purpose is not forced to re-derive it.
    expect(usage.ids.length).toBeGreaterThan(0);
  });

  it("reports complete for a shape it cannot read at all", () => {
    // Not the same as truncated. A document that is not a document was read to
    // the end and references nothing, which is an answer rather than a refusal
    // — so it must not block a delete forever.
    for (const shape of [null, "x", 7, {}, { nodes: 5 }]) {
      expect(classUsageOf(shape).complete).toBe(true);
      expect(classUsageOf(shape).ids).toEqual([]);
    }
  });
});
