/**
 * Where a copy says it came from, across the save and the insert together.
 *
 * Tested as a ROUND TRIP rather than one planner at a time. Each planner is
 * correct on a hand-built fixture and the property that matters only exists
 * between them: what a save stores is what an insert is given, and the record
 * has to survive that hop saying the right thing.
 */
import { describe, expect, it } from "vitest";

import {
  planInsertPattern,
  planSaveAsPattern,
  type StoredPattern,
} from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, BlockOrigin } from "./document";
import { applyOps } from "./ops";
import { patternDigest } from "./pattern-digest";
import { walkNodes } from "./tree";

const node = (
  id: string,
  extra: Partial<BlockNode> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  ...extra,
  ...(slots === undefined ? {} : { slots }),
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const anyParent = { parentsOf: () => undefined };
const target = {
  collection: "patterns",
  fields: { title: "Hero", slug: "hero" },
};

/** Every origin record in a forest. */
function originsIn(nodes: BlockNode[]): (BlockOrigin | undefined)[] {
  const out: (BlockOrigin | undefined)[] = [];
  walkNodes(nodes, n => out.push(n.origin));
  return out;
}

describe("an inserted pattern records where it came from", () => {
  const saved: StoredPattern = {
    id: "hero-pattern",
    document: {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "pattern",
      nodes: [node("p1"), node("p2")],
    },
  };

  it("marks every inserted ROOT with the pattern and its digest", () => {
    const doc = page([node("a")]);

    const plan = planInsertPattern(doc, saved, { index: 1 }, anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    const inserted = applied.document.nodes.filter(n => n.id !== "a");
    expect(inserted).toHaveLength(2);
    for (const root of inserted) {
      expect(root.origin).toEqual({
        from: "pattern",
        id: "hero-pattern",
        digest: patternDigest(saved.document.nodes),
      });
    }
  });

  it("marks the roots ONLY, so a detached child is not a second insertion", () => {
    const nested: StoredPattern = {
      id: "hero-pattern",
      document: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "pattern",
        nodes: [node("p1", {}, { body: [node("child")] })],
      },
    };
    const doc = page([node("a")]);

    const plan = planInsertPattern(doc, nested, { index: 1 }, anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    const marked = originsIn(applied.document.nodes).filter(Boolean);
    expect(marked).toHaveLength(1);
  });

  it("OVERWRITES a record an earlier copy left behind", () => {
    // A root can arrive carrying provenance from a previous insertion. Filling
    // in only where absent would attribute this insertion to a pattern it has
    // nothing to do with, and a later staleness check would compare against the
    // wrong source and answer confidently.
    const carried: StoredPattern = {
      id: "second-pattern",
      document: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "pattern",
        nodes: [
          node("p1", {
            origin: { from: "pattern", id: "an-older-pattern", digest: "old" },
          }),
        ],
      },
    };
    const doc = page([node("a")]);

    const plan = planInsertPattern(doc, carried, { index: 1 }, anyParent);
    const applied = applyOps(doc, (plan.pageOps ?? []) as never);

    const inserted = applied.document.nodes.find(n => n.id !== "a");
    expect(inserted?.origin).toEqual({
      from: "pattern",
      id: "second-pattern",
      digest: patternDigest(carried.document.nodes),
    });
  });

  it("changes the digest when the pattern's content changes", () => {
    const edited = {
      ...saved.document,
      nodes: [node("p1", { props: { text: "new" } }), node("p2")],
    };

    expect(patternDigest(edited.nodes)).not.toBe(
      patternDigest(saved.document.nodes)
    );
  });
});

describe("a saved pattern carries no inherited provenance", () => {
  it("STRIPS an origin the selection was already carrying", () => {
    // A stored pattern's nodes came from the page, not from wherever the
    // page's nodes came from. Carrying it across would make this pattern claim
    // a source it never had.
    const doc = page([
      node("a", {
        origin: { from: "pattern", id: "an-older-pattern", digest: "old" },
      }),
      node("b"),
    ]);

    const plan = planSaveAsPattern(doc, ["a", "b"], target, anyParent);

    expect(originsIn(plan.create?.document.nodes ?? [])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("strips it at every depth, not only at the roots", () => {
    const doc = page([
      node(
        "a",
        {},
        {
          body: [
            node("deep", {
              origin: { from: "component", id: "some-component" },
            }),
          ],
        }
      ),
    ]);

    const plan = planSaveAsPattern(doc, ["a"], target, anyParent);

    expect(
      originsIn(plan.create?.document.nodes ?? []).filter(Boolean)
    ).toEqual([]);
  });
});

describe("the round trip between the two planners", () => {
  it("SAVES A RUN, INSERTS IT BACK, AND ATTRIBUTES IT TO THE RIGHT PATTERN", () => {
    // The property neither planner has on its own: what a save stores is what
    // an insert is handed, and the record has to survive that hop.
    const source = page([
      node("a", {
        origin: { from: "pattern", id: "an-older-pattern", digest: "old" },
      }),
      node("b"),
    ]);

    const save = planSaveAsPattern(source, ["a", "b"], target, anyParent);
    const stored: StoredPattern = {
      id: "the-new-pattern",
      document: save.create?.document as BlockDocument,
    };

    const destination = page([node("x")]);
    const plan = planInsertPattern(
      destination,
      stored,
      { index: 1 },
      anyParent
    );
    const applied = applyOps(destination, (plan.pageOps ?? []) as never);

    const inserted = applied.document.nodes.filter(n => n.id !== "x");
    expect(inserted).toHaveLength(2);
    for (const root of inserted) {
      // The NEW pattern, never the one the original selection came from.
      expect(root.origin?.id).toBe("the-new-pattern");
      expect(root.origin?.from).toBe("pattern");
    }
  });
});
