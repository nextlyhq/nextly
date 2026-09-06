/**
 * Saving a contiguous run OVER an existing pattern.
 *
 * Two things are being asserted, and the second is the one that needed writing
 * down. The first is the ordinary planner contract: what document it stores,
 * and which refusals it makes rather than leaving to the apply.
 *
 * The second is the round trip. `planSaveAsPattern` and `planInsertPattern`
 * were each correct on their own fixtures and together produced a library row
 * nothing could place, because nothing fed one planner's real output to the
 * other. Save-over closes that loop — insert a pattern, edit it, save it back —
 * so the assertions here run all three against each other's output and apply
 * the ops through `applyOps` as the oracle, rather than reading the plan.
 */
import { describe, expect, it } from "vitest";

import {
  planInsertPattern,
  planSaveAsPattern,
  planUpdatePatternFromSelection,
  type CompositionPlan,
  type PlanResult,
  type StoredPattern,
} from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, BlockOrigin } from "./document";
import { applyOps } from "./ops";
import { patternDigest } from "./pattern-digest";
import { walkNodes } from "./tree";

function node(
  id: string,
  extra: Partial<BlockNode> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...extra,
    ...(slots === undefined ? {} : { slots }),
  };
}

const page = (
  nodes: BlockNode[],
  settings?: BlockDocument["settings"]
): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
  ...(settings === undefined ? {} : { settings }),
});

const anyParent = { parentsOf: () => undefined };

/** The shipped shape of a restricted block: a column belongs inside columns. */
const columnsOnly = {
  parentsOf: (type: string) =>
    type === "core/column" ? ["core/columns"] : undefined,
};

const PATTERN_ID = "hero-pattern";
const target = { collection: "patterns", id: PATTERN_ID };

/** A provenance record naming this pattern at some digest. */
const from = (digest: string, id = PATTERN_ID): BlockOrigin => ({
  from: "pattern",
  id,
  digest,
});

/**
 * The plan, or a failure naming the refusal instead of a null dereference.
 *
 * `pageOps` is optional on the union, so every test that reads it has to
 * narrow. Doing it here means a test whose planner unexpectedly REFUSES fails
 * saying which problem it hit, rather than throwing on `undefined` several
 * lines later.
 */
function planned<T>(
  result: ReturnType<typeof planUpdatePatternFromSelection> | PlanResult<T>
): CompositionPlan<T> {
  if (result.problem !== undefined) {
    throw new Error(`expected a plan, got refusal ${result.problem}`);
  }
  return result as CompositionPlan<T>;
}

/** Every node in a forest, in walk order. */
function allNodes(nodes: BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  walkNodes(nodes, n => out.push(n));
  return out;
}

describe("planUpdatePatternFromSelection: the document it stores", () => {
  it("stores the run under the SOURCE document's format version", () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [node("a"), node("b")],
    };

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    // Not DOCUMENT_FORMAT_VERSION: a pattern claiming the newest version would
    // tell the migrator there is nothing to do, and an old page's blocks would
    // be stored as if already migrated.
    expect(plan.update?.document.formatVersion).toBe(1);
    expect(plan.update?.document.kind).toBe("pattern");
    expect(plan.update?.collection).toBe("patterns");
    expect(plan.update?.id).toBe(PATTERN_ID);
  });

  it("re-identifies, so the stored copy shares no id with the page", () => {
    const document = page([node("a", {}, { main: [node("child")] })]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    const storedIds = allNodes(plan.update?.document.nodes ?? []).map(
      n => n.id
    );
    expect(storedIds).toHaveLength(2);
    expect(storedIds).not.toContain("a");
    expect(storedIds).not.toContain("child");
  });

  it("stores no settings, so a save-over cannot repaint the pages it lands on", () => {
    const document = page([node("a")], { customCss: ".x{color:red}" });

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.update?.document.settings).toBeUndefined();
  });

  it("strips inherited provenance at EVERY depth", () => {
    const document = page([
      node(
        "a",
        { origin: from("old-root") },
        { main: [node("child", { origin: from("old-child") })] }
      ),
    ]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    const origins = allNodes(plan.update?.document.nodes ?? []).map(
      n => n.origin
    );
    expect(origins).toEqual([undefined, undefined]);
  });

  it("carries no fields, so it cannot rename the row it overwrites", () => {
    const document = page([node("a")]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    // Asserted as the WHOLE key set rather than one absent name: a planner
    // that grew a `fields` passthrough would keep passing a `not.toHaveProperty`
    // check written about some other spelling.
    expect(Object.keys(plan.update ?? {}).sort()).toEqual([
      "collection",
      "document",
      "id",
    ]);
  });

  it("stores what planSaveAsPattern would store from the same selection", () => {
    const document = page([
      node("a", { cssId: "hero" }, { main: [node("child", { name: "Copy" })] }),
      node("b"),
    ]);

    const saved = planSaveAsPattern(
      document,
      ["a", "b"],
      { collection: "patterns", fields: {} },
      anyParent
    );
    const updated = planUpdatePatternFromSelection(
      document,
      ["a", "b"],
      target,
      anyParent
    );

    // Through the digest, which is exactly the comparison that matters: it
    // ignores the minted ids the two calls cannot share and reports any other
    // divergence. Two builders that agreed today would make the staleness
    // check answer wrongly the day one of them moved.
    expect(patternDigest(updated.update?.document.nodes ?? [])).toBe(
      patternDigest(saved.create?.document.nodes ?? [])
    );
  });
});

describe("planUpdatePatternFromSelection: the provenance it repairs", () => {
  it("re-stamps a selected root that names THIS pattern at a stale digest", () => {
    const document = page([node("a", { origin: from("stale") })]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    const digest = patternDigest(plan.update?.document.nodes ?? []);
    expect(plan.pageOps).toEqual([
      {
        kind: "update",
        id: "a",
        patch: { origin: { from: "pattern", id: PATTERN_ID, digest } },
      },
    ]);
  });

  it("leaves a root already at the new digest alone, costing no undo step", () => {
    const settled = page([node("a", { origin: from("stale") })]);
    const first = planUpdatePatternFromSelection(
      settled,
      ["a"],
      target,
      anyParent
    );
    const digest = patternDigest(first.update?.document.nodes ?? []);

    const document = page([node("a", { origin: from(digest) })]);
    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.pageOps).toEqual([]);
    // The plan is still a plan: the library write happens either way, and only
    // the page op is the one that would have done nothing.
    expect(plan.update?.id).toBe(PATTERN_ID);
  });

  it("leaves a root naming a DIFFERENT pattern pointing where it came from", () => {
    const document = page([node("a", { origin: from("d", "other-pattern") })]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.pageOps).toEqual([]);
  });

  it("does not mint a record for a root that never carried one", () => {
    const document = page([node("a"), node("b")]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a", "b"],
      target,
      anyParent
    );

    expect(plan.pageOps).toEqual([]);
  });

  it("re-stamps only ROOTS, never a descendant that names this pattern", () => {
    const document = page([
      node(
        "a",
        { origin: from("stale") },
        { main: [node("child", { origin: from("stale") })] }
      ),
    ]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(
      planned(plan).pageOps.map(op => (op.kind === "update" ? op.id : op.kind))
    ).toEqual(["a"]);
  });

  it("stamps the digest a later insert of the updated pattern would write", () => {
    // The DESCENDANT's origin is what makes this test able to fail. The digest
    // excludes a ROOT's origin — inserting overwrites it — but keeps a deeper
    // one, and the stored copy has every origin stripped. So hashing the page
    // selection rather than what is stored produces a number no insert of this
    // pattern can reproduce, and only a nested record shows the difference. A
    // single-root fixture passed this test with the wrong expression in place.
    const document = page([
      node(
        "a",
        { origin: from("stale") },
        { main: [node("kid", { origin: from("nested", "another-pattern") })] }
      ),
    ]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );
    const applied = applyOps(document, planned(plan).pageOps).document;

    // The oracle is the OTHER planner, not a second call to the digest. What
    // must hold is that the page's record and the record an insert of this
    // pattern writes are the same number — which is the whole question a
    // staleness surface asks.
    const inserted = planInsertPattern(
      page([]),
      { id: PATTERN_ID, document: plan.update?.document as BlockDocument },
      { index: 0 },
      anyParent
    );
    const insertedOrigin = planned(inserted).pageOps.flatMap(op =>
      op.kind === "insert" ? [op.node.origin] : []
    );

    expect(insertedOrigin).toEqual([applied.nodes[0].origin]);
  });
});

describe("planUpdatePatternFromSelection: what it refuses", () => {
  it("refuses an identity that is not a non-empty string", () => {
    const document = page([node("a")]);

    for (const id of ["", undefined, 7]) {
      const plan = planUpdatePatternFromSelection(
        document,
        ["a"],
        { collection: "patterns", id: id as string },
        anyParent
      );
      expect(plan.problem).toBe("invalid-source");
    }
  });

  it("refuses a document applyOps could not edit at all", () => {
    // `applyOp` asks about the whole envelope before it looks at an op, so a
    // plan built against one it will not edit is a dry run that disagrees with
    // the run it predicts.
    const document = {
      ...page([node("a")]),
      kind: "spreadsheet",
    } as unknown as BlockDocument;

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.problem).toBe("unusable-document");
  });

  it("passes the run's own cause through unchanged", () => {
    const document = page([node("a"), node("b"), node("c")]);

    expect(
      planUpdatePatternFromSelection(document, ["a", "c"], target, anyParent)
        .problem
    ).toBe("gap");
    expect(
      planUpdatePatternFromSelection(document, [], target, anyParent).problem
    ).toBe("empty");
    expect(
      planUpdatePatternFromSelection(document, ["ghost"], target, anyParent)
        .problem
    ).toBe("unknown");
  });

  it("refuses a block that may not be a document root, and names where it may", () => {
    const document = page([
      node(
        "cols",
        { type: "core/columns" },
        { main: [node("col", { type: "core/column" })] }
      ),
    ]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["col"],
      target,
      columnsOnly
    );

    expect(plan.problem).toBe("restricted-at-root");
    expect(plan.permitted).toEqual(["core/columns"]);
  });

  it("refuses when the root it would address is held twice", () => {
    // `update` refuses an id the document holds twice, because it could not
    // say which node the patch was meant for.
    const document = page([node("a", { origin: from("stale") }), node("a")]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.problem).toBe("duplicate-destination");
  });

  it("accepts a duplicate id it does not address", () => {
    // The over-exclusion control. Refusing on any duplicate anywhere is the
    // shortcut form of the fix above, and it would block a save the apply
    // would have accepted — these ops never address `dup`.
    const document = page([
      node("a", { origin: from("stale") }),
      node("dup"),
      node("dup"),
    ]);

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );

    expect(plan.problem).toBeUndefined();
    expect(plan.pageOps).toHaveLength(1);
  });
});

describe("save → insert → save-over, through applyOps", () => {
  /** Save a run as a new pattern, then insert it into an empty page. */
  function seed(
    source: BlockDocument,
    ids: string[]
  ): {
    stored: StoredPattern;
    placed: BlockDocument;
  } {
    const saved = planSaveAsPattern(
      source,
      ids,
      { collection: "patterns", fields: {} },
      anyParent
    );
    const stored: StoredPattern = {
      id: PATTERN_ID,
      document: saved.create?.document as BlockDocument,
    };
    const insert = planned(
      planInsertPattern(page([]), stored, { index: 0 }, anyParent)
    );
    return { stored, placed: applyOps(page([]), insert.pageOps).document };
  }

  it("leaves the run that defined the pattern reporting itself in sync", () => {
    const source = page([node("a", { name: "Hero" }), node("b")]);
    const { placed } = seed(source, ["a", "b"]);

    // The author edits the placed copy, then saves it back over the pattern.
    const edited = applyOps(placed, [
      { kind: "update", id: placed.nodes[0].id, patch: { name: "Hero 2" } },
    ]).document;
    const plan = planUpdatePatternFromSelection(
      edited,
      edited.nodes.map(n => n.id),
      target,
      anyParent
    );
    const after = applyOps(edited, planned(plan).pageOps).document;

    // Every root now records the digest of the pattern as it now stands. This
    // is the property the whole page-op half exists for: without it the run
    // that just DEFINED the pattern reports itself out of date against content
    // it is identical to.
    const now = patternDigest(plan.update?.document.nodes ?? []);
    expect(after.nodes.map(n => n.origin)).toEqual([
      { from: "pattern", id: PATTERN_ID, digest: now },
      { from: "pattern", id: PATTERN_ID, digest: now },
    ]);
  });

  it("leaves copies made BEFORE the save-over reporting stale", () => {
    const source = page([node("a", { name: "Hero" })]);
    const { stored } = seed(source, ["a"]);

    // A second page took a copy at the old digest and is not being edited.
    const elsewhere = applyOps(
      page([]),
      planned(planInsertPattern(page([]), stored, { index: 0 }, anyParent))
        .pageOps
    ).document;
    const before = elsewhere.nodes[0].origin;

    const editable = page([node("a", { name: "Hero 2" })]);
    const plan = planUpdatePatternFromSelection(
      editable,
      ["a"],
      target,
      anyParent
    );
    const now = patternDigest(plan.update?.document.nodes ?? []);

    expect(before).not.toEqual({
      from: "pattern",
      id: PATTERN_ID,
      digest: now,
    });
  });

  it("produces a pattern the insert planner still accepts, locks and all", () => {
    // The shape that broke the pair before: a locked node survives the save,
    // and an insert refuses a subtree that arrives locked. It is placeable
    // only because the group unlocks, inserts and locks again.
    const source = page([node("a", { locked: true }, { main: [node("kid")] })]);
    const { placed } = seed(source, ["a"]);

    const plan = planUpdatePatternFromSelection(
      placed,
      [placed.nodes[0].id],
      target,
      anyParent
    );
    expect(plan.problem).toBeUndefined();

    const again = planInsertPattern(
      page([]),
      { id: PATTERN_ID, document: plan.update?.document as BlockDocument },
      { index: 0 },
      anyParent
    );
    expect(again.problem).toBeUndefined();

    const landed = applyOps(page([]), planned(again).pageOps).document;
    expect(landed.nodes[0].locked).toBe(true);
  });

  it("stores the same document however many times it is saved over", () => {
    // Idempotence of the SAVE, which is what makes a digest usable at all: two
    // saves of one selection have to agree, or every copy of the pattern reads
    // as stale after a save-over that changed nothing.
    //
    // It is the save half of that property. The insert half is NOT closed —
    // `planInsertPattern` re-mints a DOM id unconditionally rather than only
    // when the destination already holds it, so a placed copy's `hero` comes
    // back as `hero-<suffix>` and saving THAT over the pattern does move the
    // digest. Measured, filed as
    // `finding:pb6-insert-remints-a-dom-id-the-destination-does-not-hold`, and
    // deliberately not asserted here: a test pinning today's answer would have
    // to be deleted by the fix rather than turning green for it.
    const source = page([
      node("a", { cssId: "hero" }, { main: [node("kid")] }),
    ]);
    const { placed } = seed(source, ["a"]);

    const first = planUpdatePatternFromSelection(
      placed,
      [placed.nodes[0].id],
      target,
      anyParent
    );
    const second = planUpdatePatternFromSelection(
      placed,
      [placed.nodes[0].id],
      target,
      anyParent
    );

    expect(patternDigest(first.update?.document.nodes ?? [])).toBe(
      patternDigest(second.update?.document.nodes ?? [])
    );
    // And the authored id is what is stored, not something minted over it.
    expect(first.update?.document.nodes[0].cssId).toBe(placed.nodes[0].cssId);
  });
});
