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

/** A node the renderer prunes: an author restricted it to a segment. */
const gatedNode = {
  conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
} as unknown as BlockNode["visibility"];

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
    //
    // The root carries a STALE record, so this plan emits an update. Without
    // one it emits nothing, `applyOps` runs no preflight at all, and there is
    // no refusal to predict — a selection with nothing to restamp still saves
    // over the pattern from a page this planner will not touch.
    const document = {
      ...page([node("a", { origin: from("stale") })]),
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

  it("saves over from an unusable page when it would touch nothing", () => {
    // The other side of the two tests around it. An empty op group is never
    // applied — `applyOps` runs no preflight for it — so there is nothing for
    // the plan to be wrong about, and refusing here would block a save the
    // apply would have accepted. The library row it writes is checked on its
    // own, where the format version that actually travels is judged.
    const document = {
      ...page([node("a")]),
      nodes: [node("a"), null],
    } as unknown as BlockDocument;

    const plan = planUpdatePatternFromSelection(
      document,
      ["a"],
      target,
      anyParent
    );
    expect(plan.problem).toBeUndefined();
    expect(plan.pageOps).toEqual([]);
  });

  it("refuses a malformed node the author did not select", () => {
    // `applyOp` walks the WHOLE forest before it applies anything, so a plan
    // that checks only the envelope and the selection promises an update the
    // apply will refuse — after the library row has been written, which is the
    // order that cannot be taken back.
    const document = {
      ...page([node("a", { origin: from("stale") })]),
      nodes: [node("a", { origin: from("stale") }), null],
    } as unknown as BlockDocument;

    expect(
      planUpdatePatternFromSelection(document, ["a"], target, anyParent).problem
    ).toBe("unusable-document");
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

describe("what a save refuses on the INSERT's behalf", () => {
  // A page is stored under forgiving validation and the rules move underneath
  // it, so a run that renders today can hold a node no insert would carry.
  // Saving it without complaint produces a library row `planInsertPattern`
  // refuses everywhere — visible, unplaceable, and silent about why until an
  // author tries. Both save planners ask, because both produce that row.

  it("refuses a node whose SHAPE the op layer would not carry", () => {
    const document = page([{ ...node("a"), version: 0 } as BlockNode]);

    expect(
      planUpdatePatternFromSelection(document, ["a"], target, anyParent).problem
    ).toBe("invalid-node");
    expect(
      planSaveAsPattern(
        document,
        ["a"],
        { collection: "patterns", fields: {} },
        anyParent
      ).problem
    ).toBe("invalid-node");
  });

  it("refuses a DESCENDANT whose parent rule narrowed after the page was written", () => {
    // Legal at the root and illegal inside: the roots pass `canBeRoot`, and a
    // check that stopped there would store a pattern that insert refuses
    // during its own internal-nesting pass.
    const document = page([
      node("box", {}, { main: [node("col", { type: "core/column" })] }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["box"], target, columnsOnly)
        .problem
    ).toBe("wrong-parent");
    expect(
      planSaveAsPattern(
        document,
        ["box"],
        { collection: "patterns", fields: {} },
        columnsOnly
      ).problem
    ).toBe("wrong-parent");
  });

  it("refuses a run that spells one DOM id on two of its own nodes", () => {
    // Pages are saved under forgiving validation, so a duplicate `cssId` is a
    // warning and the page exists. Carried into a pattern it becomes a row
    // `planInsertPattern` refuses as `duplicate-dom-id` — the same unplaceable
    // row by a third route.
    //
    // Refused rather than repaired: renaming one of the pair changes which
    // element an anchor reaches, and nothing here knows which the author meant.
    const document = page([
      node("a", { cssId: "hero" }),
      node("b", { cssId: "hero" }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["a", "b"], target, anyParent)
        .problem
    ).toBe("duplicate-dom-id");
    expect(
      planSaveAsPattern(
        document,
        ["a", "b"],
        { collection: "patterns", fields: {} },
        anyParent
      ).problem
    ).toBe("duplicate-dom-id");
  });

  it("accepts a node spelling ONE id through both of its fields", () => {
    // A node emits at most one HTML id: the renderer assigns the attribute bag
    // and then overwrites with `cssId`. Counting the two spellings separately
    // made this node look like it collided with itself — and `validateDomIds`
    // explicitly does not report it, so the save was refusing a selection the
    // document model accepts.
    const document = page([
      node("a", { cssId: "hero", attributes: { id: "hero" } }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["a"], target, anyParent).problem
    ).toBeUndefined();
    expect(
      planSaveAsPattern(
        document,
        ["a"],
        { collection: "patterns", fields: {} },
        anyParent
      ).problem
    ).toBeUndefined();
  });

  it("still refuses when the two nodes disagree about which id is theirs", () => {
    // The control for the case above: two DIFFERENT nodes reaching one id is
    // the duplicate that matters, and folding a node's own two spellings must
    // not fold that away too.
    const document = page([
      node("a", { attributes: { ID: "hero" } }),
      node("b", { cssId: "hero" }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["a", "b"], target, anyParent)
        .problem
    ).toBe("duplicate-dom-id");
  });

  it("permits two GATED variants sharing one anchor", () => {
    // The case gating exists for: personalised variants of a section, each
    // carrying the same anchor, exactly one served. `pruneHiddenNodes` removes
    // both before markup, so the page never holds a duplicate — and refusing
    // here refused the feature's own use case.
    const document = page([
      node("a", { visibility: gatedNode, cssId: "hero" }),
      node("b", { visibility: gatedNode, cssId: "hero" }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["a", "b"], target, anyParent)
        .problem
    ).toBeUndefined();
    expect(
      planSaveAsPattern(
        document,
        ["a", "b"],
        { collection: "patterns", fields: {} },
        anyParent
      ).problem
    ).toBeUndefined();
  });

  it("still refuses two UNGATED nodes sharing one", () => {
    // The control. "Never report a duplicate" satisfies the test above.
    const document = page([
      node("a", { visibility: gatedNode, cssId: "hero" }),
      node("b", { cssId: "hero" }),
      node("c", { cssId: "hero" }),
    ]);

    expect(
      planUpdatePatternFromSelection(
        document,
        ["a", "b", "c"],
        target,
        anyParent
      ).problem
    ).toBe("duplicate-dom-id");
  });

  it("saves a run when the duplicate is elsewhere on the PAGE", () => {
    // Asked of the selection, not the document. A page may legitimately spell
    // one id twice somewhere the author is not saving, and refusing on that
    // would block a save whose result inserts perfectly well.
    const document = page([
      node("a", { cssId: "unique" }),
      node("x", { cssId: "twice" }),
      node("y", { cssId: "twice" }),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["a"], target, anyParent).problem
    ).toBeUndefined();
  });

  it("refuses when the format version it would STORE is one no apply accepts", () => {
    // `formatVersion` is the part of the source envelope that travels, so a
    // page carrying one the op layer will not edit produces a pattern every
    // insert refuses as `unusable-document`.
    const document = {
      ...page([node("a")]),
      formatVersion: 99,
    } as unknown as BlockDocument;

    expect(
      planSaveAsPattern(
        document,
        ["a"],
        { collection: "patterns", fields: {} },
        anyParent
      ).problem
    ).toBe("unusable-document");
  });

  it("saves from a document whose own KIND does not travel", () => {
    // The over-exclusion control, and the reason the question is asked of what
    // is stored rather than of the source. `kind` is written by the save, so a
    // source whose own kind is unreadable still yields a good pattern —
    // judging the source would refuse this for nothing.
    const document = {
      ...page([node("a")]),
      kind: "spreadsheet",
    } as unknown as BlockDocument;

    const plan = planSaveAsPattern(
      document,
      ["a"],
      { collection: "patterns", fields: {} },
      anyParent
    );
    expect(plan.problem).toBeUndefined();
    expect(plan.create?.document.kind).toBe("pattern");
  });

  it("still saves a run whose descendants are legal", () => {
    // The over-exclusion control. Refusing anything carrying a slot would
    // satisfy both tests above and break every ordinary save.
    const document = page([
      node(
        "cols",
        { type: "core/columns" },
        { main: [node("col", { type: "core/column" })] }
      ),
    ]);

    expect(
      planUpdatePatternFromSelection(document, ["cols"], target, columnsOnly)
        .problem
    ).toBeUndefined();
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

  it("saving an unedited copy back over the pattern moves NOTHING", () => {
    // The whole round trip, and the property the digest exists to have: place a
    // pattern, save the untouched copy straight back, and the pattern's content
    // is where it was — so no other copy is told to look at a change nobody
    // made. A staleness signal that fires without cause is worse than none,
    // because it teaches authors to dismiss the one that means something.
    const source = page([
      node("a", { cssId: "hero" }, { main: [node("kid")] }),
    ]);
    const { stored, placed } = seed(source, ["a"]);

    const plan = planUpdatePatternFromSelection(
      placed,
      [placed.nodes[0].id],
      target,
      anyParent
    );

    expect(patternDigest(plan.update?.document.nodes ?? [])).toBe(
      patternDigest(stored.document.nodes)
    );
    // And the authored id survived the trip rather than gaining a suffix.
    expect(plan.update?.document.nodes[0].cssId).toBe("hero");
  });

  it("does not grow the authored id, however many cycles it goes round", () => {
    // It grew by nine characters per cycle before: `hero`, `hero-3ee4a0d4`,
    // `hero-3ee4a0d4-fb48e67c`, with no bound. Run over four cycles rather
    // than one, because a single trip can be right while the composition of
    // two is not — which is the whole reason this file tests round trips.
    let current = page([node("a", { cssId: "hero" })]);
    let row = seed(current, ["a"]).stored;

    for (let cycle = 0; cycle < 4; cycle += 1) {
      const insert = planned(
        planInsertPattern(page([]), row, { index: 0 }, anyParent)
      );
      current = applyOps(page([]), insert.pageOps).document;
      const over = planUpdatePatternFromSelection(
        current,
        [current.nodes[0].id],
        target,
        anyParent
      );
      row = {
        id: PATTERN_ID,
        document: over.update?.document as BlockDocument,
      };
    }

    expect(row.document.nodes[0].cssId).toBe("hero");
    expect(current.nodes[0].cssId).toBe("hero");
  });
});
