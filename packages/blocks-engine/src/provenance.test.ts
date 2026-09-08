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
import { reidForestWithMap, walkNodes } from "./tree";

/**
 * A minimal node: enough to be well formed, and nothing that carries meaning.
 *
 * The defaults matter to what these tests can conclude. No `origin`, so a
 * record appearing in a result was written by a planner rather than inherited
 * from a fixture; empty `props` and one block type throughout, so a digest that
 * differs differs because of the field under test.
 */
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

/** A destination document. Kind `page`, because a pattern is inserted INTO one. */
const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/**
 * A nesting source that restricts nothing.
 *
 * Explicit rather than defaulted: every planner here takes one, and a source
 * that refused a placement would fail these tests for a reason that has nothing
 * to do with provenance.
 */
const anyParent = { parentsOf: () => undefined };
/**
 * Where a saved pattern is stored, in the caller's vocabulary.
 *
 * Passed through by the planner untouched, so its contents are irrelevant here
 * beyond being present — what these tests read is the document it wraps.
 */
const target = {
  collection: "patterns",
  fields: { title: "Hero", slug: "hero" },
};

/**
 * Every origin record in a forest, at every depth, in walk order.
 *
 * Collected rather than checked node by node because the assertions are about
 * HOW MANY records exist and where — that only the roots are marked, or that a
 * save left none anywhere — and both are claims about the whole forest.
 */
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

describe("the digest describes what a COPY would carry", () => {
  it("IGNORES a root's own origin, which inserting overwrites anyway", () => {
    // Clearing an inert field that nothing copies must not report every
    // existing copy as stale.
    const bare = [node("p1"), node("p2")];
    const marked = [
      node("p1", {
        origin: { from: "pattern", id: "an-older-pattern", digest: "old" },
      }),
      node("p2"),
    ];

    expect(patternDigest(marked)).toBe(patternDigest(bare));
  });

  it("IGNORES regenerated node ids, at every depth", () => {
    // Inserting mints every id fresh, so no stored id reaches a copy. Hashing
    // them made an identity-only rewrite of the pattern report every existing
    // copy as stale at once.
    const before = [node("p1", {}, { body: [node("deep")] })];
    const after = reidForestWithMap([...before]).nodes;

    expect(after[0]!.id).not.toBe("p1");
    expect(patternDigest(after)).toBe(patternDigest(before));
  });

  it("still notices a cssId rename, which every copy DOES render", () => {
    // The control against over-excluding. A minted replacement is built from
    // the stored value — `pricing` becomes `pricing-<suffix>` — so renaming it
    // changes what every copy renders and must change the digest.
    const before = [node("p1", { cssId: "pricing" })];
    const after = [node("p1", { cssId: "plans" })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("still hashes a PROP an author happened to name id", () => {
    // The control against the shortcut: a `JSON.stringify` replacer keyed on
    // the name would drop this too, and it is content.
    const before = [node("p1", { props: { id: "left" } })];
    const after = [node("p1", { props: { id: "right" } })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("IGNORES whitespace inside an id reference, which the copier collapses", () => {
    // `"hero   label"` and `"hero label"` name the same two references and the
    // copier writes both back as the second, so every copy carries the same
    // value and a spacing edit is not a change any copy can show.
    const spaced = [
      node("t", { cssId: "hero" }),
      node("p1", { attributes: { "aria-labelledby": "hero   label" } }),
    ];
    const tight = [
      node("t", { cssId: "hero" }),
      node("p1", { attributes: { "aria-labelledby": "hero label" } }),
    ];

    expect(patternDigest(spaced)).toBe(patternDigest(tight));
  });

  it("still notices a reference pointing somewhere else", () => {
    // The control against collapsing the whole value: which ids are named IS
    // carried, and changing one changes every copy.
    const before = [node("p1", { attributes: { "aria-labelledby": "hero" } })];
    const after = [node("p1", { attributes: { "aria-labelledby": "footer" } })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("HASHES AN ATTRIBUTE STORED UNDER __proto__, which the copy keeps", () => {
    // A name that came from persisted JSON can be `__proto__`, and assigning
    // to it runs the legacy prototype setter rather than creating an own
    // property. The attribute would then be absent from what is hashed while
    // the copier carries it, so editing it would produce the same digest and
    // no upstream-change notice.
    const attributesWith = (value: string): Record<string, string> =>
      JSON.parse(`{"__proto__":${JSON.stringify(value)}}`) as Record<
        string,
        string
      >;

    // The control: the key really is an OWN property, not the prototype.
    expect(Object.hasOwn(attributesWith("a"), "__proto__")).toBe(true);

    const before = [node("p1", { attributes: attributesWith("a") })];
    const after = [node("p1", { attributes: attributesWith("b") })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("does NOT collapse whitespace in an ordinary attribute", () => {
    // An attribute that holds no reference is content, and a copy carries its
    // spacing exactly.
    const before = [node("p1", { attributes: { "data-note": "a   b" } })];
    const after = [node("p1", { attributes: { "data-note": "a b" } })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("still hashes an attributes.id, which the copy derives from", () => {
    const before = [node("p1", { attributes: { id: "hero" } })];
    const after = [node("p1", { attributes: { id: "banner" } })];

    expect(patternDigest(after)).not.toBe(patternDigest(before));
  });

  it("does NOT ignore an origin deeper than a root, which IS copied", () => {
    // Insert overwrites the roots only, so a descendant's record travels into
    // the page and a change to it is a change to what a copy holds.
    const bare = [node("p1", {}, { body: [node("deep")] })];
    const marked = [
      node(
        "p1",
        {},
        {
          body: [node("deep", { origin: { from: "component", id: "c" } })],
        }
      ),
    ];

    expect(patternDigest(marked)).not.toBe(patternDigest(bare));
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

describe("a pattern handed over without an identity", () => {
  it("is refused rather than given a record the op layer rejects", () => {
    // Every non-empty string is a legal id and only the empty one is not, so
    // the type cannot say this and a check has to.
    const nameless: StoredPattern = {
      id: "",
      document: {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "pattern",
        nodes: [node("p1")],
      },
    };

    const plan = planInsertPattern(
      page([node("a")]),
      nameless,
      { index: 1 },
      anyParent
    );

    expect(plan.problem).toBe("invalid-source");
    expect(plan.pageOps).toBeUndefined();
  });

  it("refuses an id that is not a string at all", () => {
    // This is a published entry point, and the value reaching it comes from a
    // JavaScript caller or a stored row as often as from a typed one — so the
    // type is a claim about the callers it can see, not about the input.
    for (const id of [42, null, undefined, {}]) {
      const odd = {
        id,
        document: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "pattern",
          nodes: [node("p1")],
        },
      } as unknown as StoredPattern;

      expect(
        planInsertPattern(page([node("a")]), odd, { index: 1 }, anyParent)
          .problem
      ).toBe("invalid-source");
    }
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
