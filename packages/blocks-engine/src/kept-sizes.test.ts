/**
 * An editor's cap check measures only what an edit changed.
 *
 * Documents are immutable values in the editor, so the size of every part
 * already measured is kept against the part itself. After an edit only the
 * path from the changed node to the root is new, and only that path is
 * measured. These assert the answer stays the full measurement's, and the work
 * stays the same however large the rest of the document is.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "./document";
import { documentWork } from "./document-walks";
import { walkForest } from "./forest-walk";
import { keptForestShape, keptJsonBytes } from "./kept-sizes";
import {
  countNodes,
  DEFAULT_LIMITS,
  documentTooLargeMessage,
  type DocumentLimits,
} from "./limits";
import { measureBytes } from "./measure-bytes";
import { applyOp, type BuilderOp } from "./ops";
import { scaleDocument } from "./scale.fixtures";
import { validate } from "./validation";

/** The node count and depth by the engine's forest walk, nothing kept. */
function walkedCount(nodes: readonly BlockNode[]): number {
  let count = 0;
  walkForest(nodes, () => {
    count += 1;
    return "descend";
  });
  return count;
}
function walkedDepth(nodes: readonly BlockNode[]): number {
  let deepest = 0;
  walkForest(nodes, entry => {
    deepest = Math.max(deepest, entry.depth);
    return "descend";
  });
  return deepest;
}

/** The serialized size the writer would produce, measured in full. */
const fullBytes = (document: BlockDocument): number =>
  measureBytes(document, Number.POSITIVE_INFINITY).bytes;

/** Work one call does, as the engine's own counters see it. */
function workOf(run: () => void): { walks: number; measuredObjects: number } {
  const before = documentWork();
  run();
  const after = documentWork();
  return {
    walks: after.walks - before.walks,
    measuredObjects: after.measuredObjects - before.measuredObjects,
  };
}

const ids = (nodes: readonly BlockNode[]): string[] =>
  nodes.flatMap(node => [
    node.id,
    ...Object.values(node.slots ?? {}).flatMap(children => ids(children)),
  ]);

/** The edit's result, or nothing when the engine refuses it at the default caps. */
function tryApply(
  document: BlockDocument,
  op: BuilderOp,
  limits: DocumentLimits = DEFAULT_LIMITS
): BlockDocument | undefined {
  try {
    return applyOp(document, op, limits).document;
  } catch {
    return undefined;
  }
}

/** Kept bytes, count and depth are the full measurement's and the walk's. */
function expectKeptMatchesWalk(document: BlockDocument, at: string): void {
  expect(keptJsonBytes(document), at).toBe(fullBytes(document));
  const shape = keptForestShape(document.nodes);
  expect(shape?.count, at).toBe(walkedCount(document.nodes));
  expect(shape?.depth, at).toBe(walkedDepth(document.nodes));
}

/**
 * Caps either side of the result: the editor refuses exactly the edits the
 * full measurement says take the document past a cap it was inside, or make an
 * overage worse.
 */
function expectSameVerdicts(
  document: BlockDocument,
  op: BuilderOp,
  applied: BlockDocument,
  at: string
): void {
  const before = fullBytes(document);
  const after = fullBytes(applied);
  for (const maxBytes of [after - 1, after, before - 1, before + 1]) {
    if (maxBytes < 2) continue;
    const ceiling = before > maxBytes ? before : maxBytes;
    const refused = after > ceiling;
    const result = tryApply(document, op, { ...DEFAULT_LIMITS, maxBytes });
    expect(result === undefined, `${at} cap ${String(maxBytes)}`).toBe(refused);
  }
}

/** A small deterministic generator, so a failure names a reproducible seed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** One random edit the editor could make: insert, update, move or remove. */
function randomOp(document: BlockDocument, next: () => number): BuilderOp {
  const all = ids(document.nodes);
  const pick = () => all[Math.floor(next() * all.length)] ?? "n0";
  const roll = next();
  if (roll < 0.35) {
    return {
      kind: "insert",
      node: {
        id: `new-${String(Math.floor(next() * 1e9))}`,
        type: "core/text",
        version: 1,
        props: { text: "é".repeat(Math.floor(next() * 40)) },
      },
      at:
        next() < 0.5
          ? { index: Math.floor(next() * (document.nodes.length + 1)) }
          : { parentId: pick(), slot: "children", index: 0 },
    };
  }
  if (roll < 0.65) {
    return {
      kind: "update",
      id: pick(),
      patch: {
        props: { text: `"quoted"\n${"x".repeat(Math.floor(next() * 60))}` },
      },
    };
  }
  if (roll < 0.75) {
    return { kind: "move", id: pick(), to: { index: 0 } };
  }
  if (roll < 0.85) {
    // Into a slot: an existing one or one the parent does not have yet.
    return {
      kind: "move",
      id: pick(),
      to: {
        parentId: pick(),
        slot:
          next() < 0.5 ? "children" : `extra${String(Math.floor(next() * 3))}`,
        index: 0,
      },
    };
  }
  return { kind: "remove", id: pick() };
}

describe("a cap check over kept sizes", () => {
  it("measures a document exactly as the full measurement does", () => {
    for (const nodes of [1, 4, 150]) {
      const document = scaleDocument({ nodes });
      expect(keptJsonBytes(document)).toBe(fullBytes(document));
      expect(keptJsonBytes(document)).toBe(
        new TextEncoder().encode(JSON.stringify(document)).length
      );
    }
  });

  it("answers every random edit as a full measurement would, for every cap", () => {
    for (const seed of [1, 7, 42]) {
      const next = random(seed);
      let document = scaleDocument({ nodes: 150 });
      for (let step = 0; step < 60; step++) {
        const op = randomOp(document, next);
        const applied = tryApply(document, op);
        if (applied === undefined) continue;
        expectKeptMatchesWalk(
          applied,
          `seed ${String(seed)} step ${String(step)}`
        );
        if (op.kind !== "remove") {
          expectSameVerdicts(
            document,
            op,
            applied,
            `seed ${String(seed)} step ${String(step)}`
          );
        }
        document = applied;
      }
    }
  });

  it("does the same work on a 150-block page as on a 4-block one", () => {
    const measure = (nodes: number) => {
      const document = scaleDocument({ nodes });
      // The starting size and shape, as an editor holding the document already
      // knows them from its first check.
      keptJsonBytes(document);
      countNodes(document.nodes);
      const op: BuilderOp = {
        kind: "update",
        id: "n0",
        patch: { props: { text: "changed" } },
      };
      return workOf(() => {
        applyOp(document, op);
      });
    };
    const small = measure(4);
    const large = measure(150);
    expect(large.walks).toBe(0);
    expect(small.walks).toBe(0);
    expect(large.measuredObjects).toBeLessThanOrEqual(
      2 * Math.max(1, small.measuredObjects)
    );
  });

  it("measures the starting size once per document version", () => {
    const document = scaleDocument({ nodes: 150 });
    const op = (text: string): BuilderOp => ({
      kind: "update",
      id: "n3",
      patch: { props: { text } },
    });
    const first = workOf(() => applyOp(document, op("a")));
    const second = workOf(() => applyOp(document, op("b")));
    // The first trial measured the whole starting document; the second reuses it.
    expect(first.measuredObjects).toBeGreaterThan(100);
    expect(second.measuredObjects).toBeLessThan(first.measuredObjects / 10);
  });

  it("runs no whole-document walk for a move or a delete", () => {
    const document = scaleDocument({ nodes: 150 });
    keptJsonBytes(document);
    const move = workOf(() =>
      applyOp(document, { kind: "move", id: "n7", to: { index: 0 } })
    );
    const remove = workOf(() =>
      applyOp(document, { kind: "remove", id: "n7" })
    );
    expect(move.walks).toBe(0);
    expect(remove.walks).toBe(0);
    expect(remove.measuredObjects).toBe(0);
  });

  it("measures only the changed path for a move, a remove and the edit after a remove", () => {
    const work = (nodes: number) => {
      const document = scaleDocument({ nodes });
      keptJsonBytes(document);
      countNodes(document.nodes);
      const move = workOf(() =>
        applyOp(document, { kind: "move", id: "n7", to: { index: 0 } })
      );
      const removed = applyOp(document, { kind: "remove", id: "n9" }).document;
      const afterRemove = workOf(() =>
        applyOp(removed, {
          kind: "update",
          id: "n0",
          patch: { props: { text: "after" } },
        })
      );
      return {
        move: move.measuredObjects,
        afterRemove: afterRemove.measuredObjects,
      };
    };
    const small = work(12);
    const large = work(150);
    expect(large.move).toBeLessThanOrEqual(2 * Math.max(1, small.move));
    expect(large.afterRemove).toBeLessThanOrEqual(
      2 * Math.max(1, small.afterRemove)
    );
  });

  it("refuses an insert past the byte cap in the editor, with the server's message", () => {
    const document = scaleDocument({ nodes: 150 });
    const maxBytes = fullBytes(document) + 100;
    const limits: DocumentLimits = { ...DEFAULT_LIMITS, maxBytes };
    const op: BuilderOp = {
      kind: "insert",
      node: {
        id: "big",
        type: "core/text",
        version: 1,
        props: { text: "x".repeat(500) },
      },
      at: { index: 0 },
    };
    const refusal = (() => {
      try {
        applyOp(document, op, limits);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(refusal).toBe(documentTooLargeMessage(maxBytes));
    // The server's validator says the same words for the same document.
    const tooBig: BlockDocument = {
      ...document,
      nodes: [op.node, ...document.nodes],
    };
    const server = validate(tooBig, {
      limits,
      mode: "forgiving",
      breakpoints: { viewport: [], container: [] },
    }).map(issue => issue.message);
    expect(server).toContain(documentTooLargeMessage(maxBytes));
  });
});

/**
 * Values the kept path must not answer differently from the full measurement:
 * where it has a kept size, that size is the full measurement's, and where the
 * full measurement refuses, the kept path has none.
 */
describe("what the kept path declines", () => {
  const throwingProxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("trap");
      },
    }
  );
  const iteratesNothing = Object.assign([1, 2], {
    [Symbol.iterator]: function* () {},
  });
  const shared = { text: "shared" };
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const CASES: Record<string, unknown> = {
    "-0": { a: -0 },
    NaN: { a: Number.NaN },
    undefined: { a: undefined },
    "a toJSON": { toJSON: () => "x" },
    "an accessor": Object.defineProperty({}, "a", {
      get: () => 1,
      enumerable: true,
    }),
    "a throwing proxy": { a: throwingProxy },
    "a null prototype": Object.assign(Object.create(null) as object, { a: 1 }),
    "a sparse array": { a: [1, , 2] },
    "a cycle": cyclic,
    "a shared part": { a: shared, b: shared },
    "an array iterating nothing": { a: iteratesNothing },
  };

  it.each(Object.keys(CASES))(
    "answers %s as the full measurement does",
    name => {
      const value = CASES[name];
      const full = measureBytes(value, Number.POSITIVE_INFINITY);
      let kept: number | undefined;
      expect(() => {
        kept = keptJsonBytes(value);
      }).not.toThrow();
      if (full.exceeded) expect(kept).toBeUndefined();
      else if (kept !== undefined) expect(kept).toBe(full.bytes);
    }
  );

  const node = (id: string, slots?: unknown) =>
    ({
      id,
      type: "core/box",
      version: 1,
      props: {},
      ...(slots === undefined ? {} : { slots }),
    }) as unknown as BlockNode;
  const FORESTS: Record<string, () => BlockNode[]> = {
    "a list iterating nothing": () =>
      Object.assign([node("a"), node("b")], {
        [Symbol.iterator]: function* () {},
      }),
    "a slot behind a throwing getter": () => [
      node(
        "a",
        Object.defineProperty({}, "main", {
          get: () => {
            throw new Error("getter");
          },
          enumerable: true,
        })
      ),
    ],
    "a slot list that is not an array": () => [node("a", { main: "nope" })],
    "a node shared by two slots": () => {
      const child = node("c");
      return [node("a", { one: [child], two: [child] })];
    },
  };

  it.each(Object.keys(FORESTS))("counts %s as the forest walk does", name => {
    const forest = FORESTS[name]!();
    let count: number | undefined;
    expect(() => {
      count = countNodes(forest);
    }).not.toThrow();
    expect(count).toBe(walkedCount(forest));
  });

  it("leaves a forest past the walk's bound to the walk, which refuses it", () => {
    const forest = scaleDocument({ nodes: 50 }).nodes;
    expect(keptForestShape(forest, 10)).toBeUndefined();
    expect(keptForestShape(forest, 1000)?.count).toBe(walkedCount(forest));
  });
});
