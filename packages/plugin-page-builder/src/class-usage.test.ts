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
  MAX_NAMED_CLASSES,
  MAX_NAMED_CLASS_NAME_LENGTH,
} from "@nextlyhq/blocks-engine";

import { classIdsUsedBy } from "./class-usage";

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

  it("stops at the number of classes a site can define", () => {
    // A page cannot usefully reference more DISTINCT classes than the library
    // can hold, so a document claiming to is corrupt — and this runs on every
    // page write, where an unbounded read is paid every time.
    const many = Array.from(
      { length: MAX_NAMED_CLASSES + 500 },
      (_, i) => `c${i}`
    );

    expect(classIdsUsedBy(withClasses(many))).toHaveLength(MAX_NAMED_CLASSES);
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
  const cyclic: Record<string, unknown> = { nodes: [] };
  (cyclic.nodes as unknown[]).push({ id: "a", classes: [], self: cyclic });

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
    ["a document that references itself", cyclic],
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
