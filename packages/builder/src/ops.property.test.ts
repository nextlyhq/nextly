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
      const before = doc(seedForest(rnd, 1 + Math.floor(rnd() * 4)));
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

  // `it.fails`, because vitest marks an expected failure on the declaration —
  // a `test.fail()` call inside the body is Playwright's API and silently does
  // nothing here. Marking the whole test is acceptable only because the
  // properties that DO hold were split into their own case above, so this one
  // is narrow enough that "expected to fail" names a single shortfall.
  //
  // It goes red the day the shortfall is fixed, which is what forces the marker
  // out rather than letting it become permanent.
  it.fails("restores the document exactly", () => {
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

    // The shortfall this is marked for: placing a node into a slot the destination parent does not
    // already have makes the engine CREATE that slot, and no inverse in this
    // vocabulary can remove it. Undo therefore restores every node and leaves
    // `slots: { aside: [] }` behind — a slot the author never made, which the
    // page-builder validator rejects and which no update can delete, because
    // updates exclude `slots`.
    //
    // Reproducible: seeds 2, 39 and 53 for insert; 35, 40 and 45 for move.
    //
    // Left as a target rather than patched, because both candidate fixes change
    // the persisted format or the authoring rules — record the created slot on
    // the inverse, or refuse a placement that would create one — and that
    // decision belongs to the op-format design pass, not to this test.
    expect(failures, failures.join("\n\n")).toEqual([]);
  });
});
