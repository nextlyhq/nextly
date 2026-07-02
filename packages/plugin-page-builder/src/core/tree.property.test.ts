import { describe, it, expect } from "vitest";

import {
  makeNode,
  insertNode,
  moveNode,
  removeNode,
  duplicateNode,
  findNode,
  walk,
} from "./tree";
import type { BlockNode } from "./types";

// Deterministic PRNG — no Math.random (reproducible; also unavailable in some runtimes).
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function ids(root: BlockNode): string[] {
  const out: string[] = [];
  walk(root, n => out.push(n.id));
  return out;
}
function hasDup(a: string[]): boolean {
  return new Set(a).size !== a.length;
}
function maxDepth(n: BlockNode, d = 0): number {
  const kids = Object.values(n.slots ?? {}).flat();
  return kids.length ? Math.max(...kids.map(c => maxDepth(c, d + 1))) : d;
}

describe("tree ops preserve invariants under random operations", () => {
  it("no duplicate ids, root intact, bounded depth over 200 ops (x5 seeds)", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rnd = prng(seed);
      let root: BlockNode = makeNode("core/container", {}, undefined, {
        default: [],
      });
      const rootId = root.id;

      for (let i = 0; i < 200; i++) {
        const all = ids(root);
        const pick = all[Math.floor(rnd() * all.length)];
        const op = Math.floor(rnd() * 4);

        if (op === 0) {
          const parent = findNode(root, pick);
          if (parent?.slots) {
            root = insertNode(
              root,
              pick,
              "default",
              makeNode("core/container", {}, undefined, { default: [] }),
              0
            );
          }
        } else if (op === 1 && pick !== rootId) {
          root = moveNode(root, pick, rootId, "default", 0);
        } else if (op === 2 && pick !== rootId) {
          root = removeNode(root, pick);
        } else if (op === 3 && pick !== rootId) {
          root = duplicateNode(root, pick);
        }

        expect(hasDup(ids(root))).toBe(false);
        expect(findNode(root, rootId)).toBeDefined();
        expect(maxDepth(root)).toBeLessThan(300);
      }
    }
  });
});
