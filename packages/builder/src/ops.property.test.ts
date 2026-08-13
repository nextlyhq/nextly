/**
 * The op store's one promise, tested as a property rather than as examples.
 *
 * `applyOp` returns an inverse. The whole point of that inverse is that
 * applying it undoes the edit — so for every document and every op the store
 * accepts, `apply(op)` followed by `apply(inverse)` must give back exactly the
 * document you started with. Every hand-written case in `ops.test.ts` checks
 * that for ONE shape. This checks it for whatever the generator produces, which
 * is where the shapes nobody thought of live.
 *
 * The distinction matters because the two kinds of defect need different tools.
 * A malformed op is a SHAPE problem and a declared schema catches it. An
 * inverse that applies cleanly and leaves a different document is a SEMANTIC
 * problem, and no schema has an opinion about it — the only thing that catches
 * it is applying the inverse and comparing.
 *
 * Seeded rather than random, following `blocks-engine`'s property test: a
 * failure reproduces exactly from the seed printed in the message, so a defect
 * found here is a defect anyone can reproduce.
 */
import { describe, expect, it } from "vitest";

import { applyOp, OpError, type BuilderOp } from "./ops";
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";

/** Deterministic PRNG — no `Math.random`, so failures reproduce by seed. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

function node(id: string, slots?: Record<string, BlockNode[]>): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(slots === undefined ? {} : { slots }),
  };
}

/** Every node in the forest, with the parent and slot that hold it. */
function locations(
  nodes: BlockNode[]
): { node: BlockNode; parent?: BlockNode; slot?: string }[] {
  const out: { node: BlockNode; parent?: BlockNode; slot?: string }[] = [];
  const walk = (list: BlockNode[], parent?: BlockNode, slot?: string): void => {
    for (const entry of list) {
      out.push({ node: entry, ...(parent ? { parent, slot } : {}) });
      for (const [name, children] of Object.entries(entry.slots ?? {})) {
        walk(children, entry, name);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * A forest of a few nested containers, deterministic per seed.
 *
 * Containers rather than leaves, because the interesting inverses are the ones
 * that move a subtree between slots — a flat list exercises index arithmetic
 * and nothing else.
 */
function seedForest(rnd: () => number, count: number): BlockNode[] {
  let next = 0;
  const fresh = (): BlockNode => node(`n${String(next++)}`);
  const roots: BlockNode[] = [];
  for (let i = 0; i < count; i += 1) {
    const root = fresh();
    if (rnd() < 0.7) {
      const children: BlockNode[] = [];
      for (let c = 0; c < Math.floor(rnd() * 3); c += 1) children.push(fresh());
      root.slots = { main: children };
      if (rnd() < 0.4) root.slots.aside = [fresh()];
    }
    roots.push(root);
  }
  return roots;
}

/**
 * Corrupts a forest the way an IMPORT does, deterministically per seed.
 *
 * The generator above builds well-formed documents, and well-formed input is
 * the case least likely to be wrong. `applyOp` accepts documents from storage
 * and from other tools, so the interesting question is what it does with one
 * that is already malformed — and every answer except `OpError` is a defect:
 * a native error the caller cannot classify, or an edit whose inverse cannot
 * run.
 */
function corrupt(rnd: () => number, nodes: BlockNode[]): BlockNode[] {
  const copy = JSON.parse(JSON.stringify(nodes)) as BlockNode[];
  const spots = locations(copy);
  const victim = spots[Math.floor(rnd() * spots.length)];
  if (victim === undefined) return copy;
  const how = Math.floor(rnd() * 4);

  if (how === 0) {
    // A field the shape check requires, gone. Removing this subtree yields an
    // insert inverse that cannot be applied.
    delete (victim.node as Partial<BlockNode>).props;
  } else if (how === 1) {
    // A slot name that reaches the prototype rather than an own key.
    victim.node.slots = { ...(victim.node.slots ?? {}), ["__proto__"]: [] };
  } else if (how === 2) {
    // A field that is computed rather than held.
    Object.defineProperty(victim.node, "name", {
      get: () => "computed",
      enumerable: true,
      configurable: true,
    });
  } else {
    // A non-enumerable field, which survives every read and is dropped by the
    // spread that rebuilds the node.
    Object.defineProperty(victim.node, "version", {
      value: 1,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

/** One op against the given forest, or `null` when nothing applicable exists. */
function seedOp(rnd: () => number, nodes: BlockNode[]): BuilderOp | null {
  const spots = locations(nodes);
  if (spots.length === 0) return null;
  const target = spots[Math.floor(rnd() * spots.length)];
  if (target === undefined) return null;
  const kind = Math.floor(rnd() * 4);

  if (kind === 0) {
    const parent = rnd() < 0.5 ? target.node : undefined;
    return {
      kind: "insert",
      node: node(`fresh-${String(Math.floor(rnd() * 1e6))}`),
      at:
        parent === undefined
          ? { index: Math.floor(rnd() * (nodes.length + 1)) }
          : {
              parentId: parent.id,
              slot: rnd() < 0.5 ? "main" : "aside",
              index: 0,
            },
    };
  }
  if (kind === 1) return { kind: "remove", id: target.node.id };
  if (kind === 2) {
    const into = spots[Math.floor(rnd() * spots.length)];
    return {
      kind: "move",
      id: target.node.id,
      to:
        into === undefined || rnd() < 0.4
          ? { index: Math.floor(rnd() * (nodes.length + 1)) }
          : {
              parentId: into.node.id,
              slot: rnd() < 0.5 ? "main" : "aside",
              index: 0,
            },
    };
  }
  return {
    kind: "update",
    id: target.node.id,
    patch: { name: `renamed-${String(Math.floor(rnd() * 1e6))}` },
  };
}

describe("an op and its inverse are a round trip", () => {
  it("never leaves a native error, and always produces an applicable inverse", () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= 60; seed += 1) {
      const rnd = prng(seed);
      // Half the seeds run against a document corrupted the way an import
      // corrupts one. A well-formed document is the case least likely to be
      // wrong, and `applyOp` accepts input from storage and from other tools.
      const forest = seedForest(rnd, 1 + Math.floor(rnd() * 4));
      const before = doc(rnd() < 0.5 ? forest : corrupt(rnd, forest));
      const op = seedOp(rnd, before.nodes);
      if (op === null) continue;

      let applied;
      try {
        applied = applyOp(before, op);
      } catch (error) {
        // A refusal is a legitimate answer, and most generated ops are refused.
        // What must never happen is a native error reaching the caller, who
        // cannot tell one from a broken editor.
        if (error instanceof OpError) continue;
        failures.push(
          `seed ${String(seed)}: ${op.kind} threw ${String(error)}`
        );
        continue;
      }

      // The inverse must itself apply. One that is refused is a history entry
      // that cannot be undone, which is worse than a refused edit — the edit
      // has already happened.
      try {
        applyOp(applied.document, applied.inverse);
      } catch (error) {
        failures.push(
          `seed ${String(seed)}: ${op.kind} produced an inverse that was ` +
            `refused — ${String(error)}`
        );
      }
    }

    expect(failures, failures.join("\n\n")).toEqual([]);
  });

  it("restores the document exactly", () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= 60; seed += 1) {
      const rnd = prng(seed);
      const before = doc(seedForest(rnd, 1 + Math.floor(rnd() * 4)));
      const op = seedOp(rnd, before.nodes);
      if (op === null) continue;

      let applied;
      try {
        applied = applyOp(before, op);
      } catch {
        continue;
      }
      let undone;
      try {
        undone = applyOp(applied.document, applied.inverse);
      } catch {
        continue;
      }

      // Compared as DOCUMENTS rather than as node lists: an inverse that
      // restores every node and leaves an extra empty slot behind has not
      // restored the document, and the next save writes a shape the author
      // never created.
      if (JSON.stringify(undone.document) !== JSON.stringify(before)) {
        failures.push(
          `seed ${String(seed)}: ${op.kind} did not round trip\n` +
            `  before:     ${JSON.stringify(before)}\n` +
            `  after undo: ${JSON.stringify(undone.document)}`
        );
      }
    }

    expect(failures, failures.join("\n\n")).toEqual([]);
  });
});
