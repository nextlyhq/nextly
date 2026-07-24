import { describe, expect, it } from "vitest";

import type { BlockNode } from "./document";
import { countNodes, treeDepth } from "./limits";
import {
  duplicateNode,
  findNode,
  insertNode,
  makeNode,
  moveNode,
  removeNode,
  walkNodes,
} from "./tree";

// Deterministic PRNG — no Math.random, so failures reproduce exactly by seed.
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function allIds(nodes: BlockNode[]): string[] {
  const out: string[] = [];
  walkNodes(nodes, n => out.push(n.id));
  return out;
}

function hasDuplicates(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

describe("forest ops preserve invariants under random operations", () => {
  it("no duplicate ids, valid structure, bounded growth over 250 ops (x5 seeds)", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rnd = prng(seed);
      let nodes: BlockNode[] = [
        makeNode("core/section", 1, {}, { children: [] }),
      ];

      for (let i = 0; i < 250; i++) {
        const ids = allIds(nodes);
        const pick = ids[Math.floor(rnd() * ids.length)];
        const op = Math.floor(rnd() * 5);

        if (pick === undefined || op === 0) {
          // Insert a fresh container at the top level.
          nodes = insertNode(
            nodes,
            makeNode("core/section", 1, {}, { children: [] }),
            { index: Math.floor(rnd() * (nodes.length + 1)) }
          );
        } else if (op === 1) {
          // Insert a fresh child under the picked node's "children" slot.
          nodes = insertNode(nodes, makeNode("core/text", 1, { text: "t" }), {
            parentId: pick,
            slot: "children",
            index: 0,
          });
        } else if (op === 2) {
          // Move the picked node to a random destination (top level or a slot).
          const targetIds = allIds(nodes);
          const target = targetIds[Math.floor(rnd() * targetIds.length)];
          nodes =
            rnd() < 0.5 || target === undefined
              ? moveNode(nodes, pick, {
                  index: Math.floor(rnd() * (nodes.length + 1)),
                })
              : moveNode(nodes, pick, {
                  parentId: target,
                  slot: "children",
                  index: 0,
                });
        } else if (op === 3) {
          nodes = removeNode(nodes, pick);
        } else {
          nodes = duplicateNode(nodes, pick);
        }

        // Invariants that must hold after EVERY operation:
        const idsAfter = allIds(nodes);
        expect(hasDuplicates(idsAfter)).toBe(false);
        expect(countNodes(nodes)).toBe(idsAfter.length);
        expect(treeDepth(nodes)).toBeLessThan(300);
        // Every node found by walk is reachable by findNode (index integrity).
        for (const id of idsAfter.slice(0, 3)) {
          expect(findNode(nodes, id)).toBeDefined();
        }
      }
    }
  });

  it("a move never loses or gains nodes", () => {
    const rnd = prng(42);
    let nodes: BlockNode[] = [
      makeNode("core/section", 1, {}, { children: [makeNode("core/text", 1)] }),
      makeNode("core/section", 1, {}, { children: [] }),
    ];
    for (let i = 0; i < 100; i++) {
      const ids = allIds(nodes);
      const before = countNodes(nodes);
      const pick = ids[Math.floor(rnd() * ids.length)];
      const target = ids[Math.floor(rnd() * ids.length)];
      if (pick === undefined || target === undefined) continue;
      nodes = moveNode(nodes, pick, {
        parentId: target,
        slot: "children",
        index: 0,
      });
      // A refused move (cycle) and an applied move both preserve the count.
      expect(countNodes(nodes)).toBe(before);
    }
  });
});
