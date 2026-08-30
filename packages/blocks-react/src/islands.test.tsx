/**
 * Which blocks on a page need JavaScript, answered from the stored document.
 *
 * The question `"use client"` cannot answer. A directive is a fact about a
 * MODULE that a bundler can see; a page is stored as JSON naming block types,
 * and this package has to answer without importing every block in the library
 * or inspecting how one was compiled.
 *
 * The last case is the one that could not be written before a block could say
 * this about itself: the core library adds no JavaScript of its own. It is
 * asserted here at the unit level and measured nightly in a real browser, and
 * the two answer different halves — this one cannot see bytes, and the browser
 * cannot say WHICH block was responsible.
 *
 * @module islands.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import { coreBlocks } from "./blocks";
import { createBlockResolver } from "./resolver";
import { islandsFor } from "./styles";

import type { AnyBlockDefinition } from "@nextlyhq/blocks-engine";

const ticker = {
  name: "test/ticker",
  version: 1,
  description: "A block that counts down.",
  example: { props: {} },
  island: { reason: "counts down to a date the server cannot know." },
  render: () => null,
} as unknown as AnyBlockDefinition;

const still = {
  name: "test/still",
  version: 1,
  description: "A block that draws and stops.",
  example: { props: {} },
  render: () => null,
} as unknown as AnyBlockDefinition;

const blocks = createBlockResolver([ticker, still]);

function page(...types: string[]): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: types.map((type, index) => ({
      id: `n${index}`,
      type,
      version: 1,
      props: {},
    })),
  } as unknown as BlockDocument;
}

describe("the islands a stored page contains", () => {
  it("names the interactive block and carries its reason", () => {
    expect(islandsFor(page("test/ticker"), blocks)).toEqual({
      "test/ticker": {
        reason: "counts down to a date the server cannot know.",
      },
    });
  });

  it("is EMPTY for a page whose blocks all draw and stop", () => {
    // Empty means the page needs no JavaScript OF ITS OWN — not that it ships
    // no script, which is a fact about the host framework and not about
    // blocks.
    expect(islandsFor(page("test/still"), blocks)).toEqual({});
  });

  it("ignores a block type the page does not use", () => {
    // The control the emptiness assertion needs: a reader that answered from
    // the REGISTRY rather than the document would report the ticker on a page
    // that never places one, and the assertion above would still pass.
    expect(islandsFor(page("test/still"), blocks)).not.toHaveProperty(
      "test/ticker"
    );
  });

  it("reports one entry however many times a block is placed", () => {
    expect(
      Object.keys(islandsFor(page("test/ticker", "test/ticker"), blocks))
    ).toEqual(["test/ticker"]);
  });
});

describe("a block stored under a slot its parent may not draw", () => {
  // A block declares such a slot when it renders the contents only sometimes —
  // a loop over a query draws its template once per row, and none at all when
  // the query is empty. A reader of the STORED document cannot tell which
  // happened, because that is settled by rendering.
  const loop = {
    name: "test/loop",
    version: 1,
    description: "Draws its template once per row.",
    example: { props: {} },
    slots: { children: {} },
    conditionalSlots: ["children"],
    render: () => null,
  } as unknown as AnyBlockDefinition;

  const nested = createBlockResolver([loop, ticker, still]);

  const pageWithLoop = (childType: string): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n0",
          type: "test/loop",
          version: 1,
          props: {},
          slots: {
            children: [{ id: "n1", type: childType, version: 1, props: {} }],
          },
        },
      ],
    }) as unknown as BlockDocument;

  it("does not report an island the page may never draw", () => {
    // Reporting it claims a page needs JavaScript that never reaches it, which
    // is the opposite of the claim this function exists to make. Skipped rather
    // than guessed, and this is the cautious direction: a conditional slot that
    // WAS drawn under-reports one island, while the reverse tells a caller a
    // static page is interactive.
    expect(islandsFor(pageWithLoop("test/ticker"), nested)).toEqual({});
  });

  it("still reports an island in an UNCONDITIONAL slot", () => {
    // The control the assertion above needs: a walk that skipped every slot
    // would satisfy it while seeing nothing at all.
    const plainParent = {
      name: "test/box",
      version: 1,
      description: "Draws its children always.",
      example: { props: {} },
      slots: { children: {} },
      render: () => null,
    } as unknown as AnyBlockDefinition;
    const blocksWithBox = createBlockResolver([plainParent, ticker]);
    const doc = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n0",
          type: "test/box",
          version: 1,
          props: {},
          slots: {
            children: [
              { id: "n1", type: "test/ticker", version: 1, props: {} },
            ],
          },
        },
      ],
    } as unknown as BlockDocument;

    expect(Object.keys(islandsFor(doc, blocksWithBox))).toEqual([
      "test/ticker",
    ]);
  });
});

describe("a document whose shape a reader cannot control", () => {
  const box = {
    name: "test/box",
    version: 1,
    description: "Draws its children always.",
    example: { props: {} },
    slots: { children: {} },
    render: () => null,
  } as unknown as AnyBlockDefinition;

  const deep = createBlockResolver([box, ticker]);

  it("answers for nesting deeper than the call stack", () => {
    // A stored document is untrusted input and its depth is bounded by nothing
    // this function controls. A recursive descent threw `RangeError` before
    // returning any answer — so asking whether a page needs JavaScript was the
    // thing that failed, on a document a reader had no chance to reject first.
    let node: Record<string, unknown> = {
      id: "leaf",
      type: "test/ticker",
      version: 1,
      props: {},
    };
    for (let depth = 0; depth < 15000; depth += 1) {
      node = {
        id: `n${depth}`,
        type: "test/box",
        version: 1,
        props: {},
        slots: { children: [node] },
      };
    }
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    } as unknown as BlockDocument;

    // Does not THROW, which is the property. It answers `{}`, and that is the
    // right answer rather than a shortfall: the read preparation caps document
    // depth, so the leaf is truncated away and the renderer draws nothing there
    // either. Asserting the ticker WERE found would demand this disagree with
    // the page.
    expect(() => islandsFor(document, deep)).not.toThrow();
    expect(islandsFor(document, deep)).toEqual({});
  });

  it("still finds an island at a depth the page actually renders", () => {
    // The control the assertion above needs, and it is doing real work: `{}` is
    // also what a walk that read nothing returns, so without this the deep case
    // would pass against a function that had stopped looking entirely.
    let node: Record<string, unknown> = {
      id: "leaf",
      type: "test/ticker",
      version: 1,
      props: {},
    };
    for (let depth = 0; depth < 3; depth += 1) {
      node = {
        id: `n${depth}`,
        type: "test/box",
        version: 1,
        props: {},
        slots: { children: [node] },
      };
    }
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    } as unknown as BlockDocument;

    expect(Object.keys(islandsFor(document, deep))).toEqual(["test/ticker"]);
  });

  it("terminates on a node that contains itself", () => {
    // A cycle is reachable through a hand edit or a bad migration. Termination
    // comes from the read preparation, which caps depth and so hands this walk
    // a finite tree — asserted here because that is a property this function
    // DEPENDS on rather than one it implements, and nothing else would notice
    // if the cap moved.
    const cyclic: Record<string, unknown> = {
      id: "n0",
      type: "test/box",
      version: 1,
      props: {},
    };
    cyclic.slots = { children: [cyclic] };
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [cyclic],
    } as unknown as BlockDocument;

    expect(islandsFor(document, deep)).toEqual({});
  });
});

describe("an island the page draws nothing for", () => {
  // A block declaring `rendersNothing(props)` emits no markup — an image still
  // waiting for its picture. The read preparation deliberately does NOT decide
  // this: it says so where it draws its line, because a node resolving to a
  // placeholder is an exceptional state while a block drawing nothing is an
  // ordinary one.
  const emptyTicker = {
    name: "test/empty-ticker",
    version: 1,
    description: "Counts down, when given a date.",
    example: { props: {} },
    island: { reason: "counts down to a date the server cannot know." },
    rendersNothing: (props: { date?: string }) => props.date === undefined,
    render: () => null,
  } as unknown as AnyBlockDefinition;

  const blocksWithEmpty = createBlockResolver([emptyTicker]);

  const pageOf = (props: Record<string, unknown>): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "test/empty-ticker", version: 1, props }],
    }) as unknown as BlockDocument;

  it("is not reported when its props draw nothing", () => {
    expect(islandsFor(pageOf({}), blocksWithEmpty)).toEqual({});
  });

  it("IS reported when the same block has something to draw", () => {
    // The control: a walk that dropped every island would satisfy the case
    // above while reporting nothing about any page.
    expect(
      Object.keys(islandsFor(pageOf({ date: "2026-01-01" }), blocksWithEmpty))
    ).toEqual(["test/empty-ticker"]);
  });
});

describe("the limits a site sets", () => {
  const box = {
    name: "test/box2",
    version: 1,
    description: "Draws its children always.",
    example: { props: {} },
    slots: { children: {} },
    render: () => null,
  } as unknown as AnyBlockDefinition;
  const deep = createBlockResolver([box, ticker]);

  const nested = (depth: number): BlockDocument => {
    let node: Record<string, unknown> = {
      id: "leaf",
      type: "test/ticker",
      version: 1,
      props: {},
    };
    for (let level = 0; level < depth; level += 1) {
      node = {
        id: `n${level}`,
        type: "test/box2",
        version: 1,
        props: {},
        slots: { children: [node] },
      };
    }
    return {
      formatVersion: 1,
      kind: "page",
      nodes: [node],
    } as unknown as BlockDocument;
  };

  it("reads the caps the caller gives, not the defaults", () => {
    // A site that raised `maxDepth` renders deeper than the default allows. Read
    // against the defaults, an island the page DOES draw is truncated away and
    // the caller is told the page needs less JavaScript than it does.
    const document = nested(14);

    expect(islandsFor(document, deep)).toEqual({});
    expect(
      Object.keys(
        islandsFor(document, deep, { limits: { maxDepth: 40 } as never })
      )
    ).toEqual(["test/ticker"]);
  });
});

describe("the core block library", () => {
  it("declares no islands, so a page of core blocks adds no JavaScript", () => {
    // The nightly Lighthouse budget measures the BYTES on a real page in a
    // real browser; this says which blocks would be responsible if that number
    // ever moved, which the browser cannot.
    const declared = (coreBlocks as AnyBlockDefinition[])
      .filter(block => block.island !== undefined)
      .map(block => block.name);

    expect(declared).toEqual([]);
  });

  it("was actually reading the library, not an empty list", () => {
    // Without this the assertion above passes on a `coreBlocks` that failed to
    // import — the emptiness it asserts is the same emptiness a broken import
    // produces.
    expect((coreBlocks as AnyBlockDefinition[]).length).toBeGreaterThan(10);
  });
});
