/**
 * Planning a saved pattern from a selection.
 *
 * The assertion that matters most is the cross-root reference one. A pattern is
 * a RUN of siblings, so its document has several roots, and the obvious
 * implementation — re-identify each root in turn — produces a pattern that
 * renders, validates and looks right, while a button in the second root points
 * its `aria-describedby` at an element in the page it was saved FROM. Nothing
 * on screen shows it. The only people who find out are the ones using a screen
 * reader, and by then the pattern has been inserted on twenty pages.
 */
import { describe, expect, it } from "vitest";

import {
  planConvertToComponent,
  planDuplicateComponent,
  planInsertPattern,
  planSaveAsComponent,
  planSaveAsPattern,
  planUpdatePatternFromSelection,
} from "./composition-planners";
import type {
  PlanResult,
  PlanWarning,
  PlannedCreate,
} from "./composition-planners";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, ComponentDocument } from "./document";
import { applyOps } from "./ops";
import type { BuilderOp } from "./ops";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import type { DocumentLimits } from "./limits";
import { componentEnvelopeIssues } from "./validation";
import { patternDigest } from "./pattern-digest";
import { findNode, walkNodes } from "./tree";

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

function page(
  nodes: BlockNode[],
  settings?: BlockDocument["settings"]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
    ...(settings === undefined ? {} : { settings }),
  };
}

/**
 * A nesting source that restricts nothing, which is the ordinary case.
 *
 * Explicit rather than defaulted, because "no restriction" is a real answer a
 * registry gives and the planner must be handed one rather than assume it.
 */
const anyParent = { parentsOf: () => undefined };

/** The shipped shape of a restricted block: a column belongs inside columns. */
const columnsOnly = {
  parentsOf: (type: string) =>
    type === "core/column" ? ["core/columns"] : undefined,
};

const target = {
  collection: "patterns",
  fields: { title: "Hero", slug: "hero", granularity: "section" },
};

/** Every id in a forest. */
function idsIn(nodes: BlockNode[]): string[] {
  const out: string[] = [];
  walkNodes(nodes, n => out.push(n.id));
  return out;
}

/** The one node in a forest carrying this test's marker prop. */
function marked(nodes: BlockNode[], mark: string): BlockNode {
  let found: BlockNode | undefined;
  walkNodes(nodes, n => {
    if (n.props?.mark === mark) found = n;
  });
  if (found === undefined) throw new Error(`no node marked ${mark}`);
  return found;
}

describe("what a saved pattern is", () => {
  it("creates a pattern document in the collection the caller named", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    const plan = planSaveAsPattern(doc, ["a", "b"], target, anyParent);

    expect(plan.create?.collection).toBe("patterns");
    expect(plan.create?.document.kind).toBe("pattern");
    expect(plan.create?.fields).toEqual(target.fields);
  });

  it("takes exactly the selected run, in document order", () => {
    const doc = page([
      node("a", { props: { mark: "a" } }),
      node("b", { props: { mark: "b" } }),
      node("c", { props: { mark: "c" } }),
    ]);
    // Ids handed over out of order on purpose: the pattern's order is the
    // document's, not the order blocks happened to be clicked in.
    const plan = planSaveAsPattern(doc, ["c", "b"], target, anyParent);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "b",
      "c",
    ]);
  });

  it("LEAVES THE PAGE ALONE — a pattern is a copy, not a move", () => {
    const doc = page([node("a"), node("b")]);
    const plan = planSaveAsPattern(doc, ["a"], target, anyParent);

    expect(plan.pageOps).toEqual([]);
  });

  it("does not mutate the document it was given", () => {
    const doc = page([node("a", { cssId: "pricing" }), node("b")]);
    const before = JSON.stringify(doc);

    planSaveAsPattern(doc, ["a", "b"], target, anyParent);

    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("the copy is a document of its own", () => {
  it("shares no node id with the page it came from", () => {
    const doc = page([node("a", {}, { body: [node("a-child")] }), node("b")]);
    const plan = planSaveAsPattern(doc, ["a", "b"], target, anyParent);

    const stored = idsIn(plan.create?.document.nodes ?? []);
    expect(stored).toHaveLength(3);
    for (const id of ["a", "a-child", "b"]) {
      expect(stored).not.toContain(id);
    }
  });

  it("drops page-scoped settings, which describe the page and not the run", () => {
    const doc = page([node("a")], {
      styles: { base: { desktop: { backgroundColor: "red" } } },
      customCss: ".x{}",
    });
    const plan = planSaveAsPattern(doc, ["a"], target, anyParent);

    expect(plan.create?.document.settings).toBeUndefined();
  });
});

describe("a reference that crosses from one root to the next", () => {
  it("points at the COPY's target, not the page's", () => {
    const doc = page([
      node("a", { cssId: "pricing", props: { mark: "target" } }),
      node("b", {
        props: { mark: "pointer" },
        attributes: { "aria-describedby": "pricing" },
      }),
    ]);

    const stored = planSaveAsPattern(doc, ["a", "b"], target, anyParent).create
      ?.document.nodes;
    expect(stored).toBeDefined();

    const copiedTarget = marked(stored ?? [], "target");
    const copiedPointer = marked(stored ?? [], "pointer");

    // Asserted against the stored target's OWN id rather than against a
    // literal, which is the property and not the mechanism: whatever a save
    // does with a DOM id, a reference crossing the root boundary has to land
    // on the node the pattern carries. Written the other way — "the id
    // changed" — this passed for a save that re-minted and would have had to
    // be rewritten to let one that does not through, without the property it
    // guards ever having moved.
    expect(copiedPointer.attributes?.["aria-describedby"]).toBe(
      copiedTarget.cssId
    );
    // And the target is in the SAVED forest, so the reference reaches
    // something: an assertion that two fields agree is satisfied by both being
    // undefined.
    expect(copiedTarget.cssId).toBeTypeOf("string");
  });

  it("still reaches it after the pattern is inserted somewhere else", () => {
    // The end-to-end form, which is what an author sees. Saving and inserting
    // each rewrite references, and the pair is where a copy silently loses its
    // accessible name — invisible to everyone not using assistive technology.
    const doc = page([
      node("a", { cssId: "pricing", props: { mark: "target" } }),
      node("b", {
        props: { mark: "pointer" },
        attributes: { "aria-describedby": "pricing" },
      }),
    ]);

    const stored = planSaveAsPattern(doc, ["a", "b"], target, anyParent).create
      ?.document;
    // Into a page that ALREADY holds `pricing`, which is the case minting
    // exists for. Inserting into an empty page mints nothing now — correctly,
    // since a DOM id is authored content and there is nothing to collide with
    // — so an empty destination could not tell a working remap from no remap.
    const destination = page([node("existing", { cssId: "pricing" })]);
    const insert = planInsertPattern(
      destination,
      { id: "hero-pattern", document: stored as BlockDocument },
      { index: 1 },
      anyParent
    );
    expect(insert.problem).toBeUndefined();
    const placed = (insert.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    // Guarded, because `flatMap` over an empty list makes every assertion
    // below vacuous: `marked` would throw, but only after the test had stopped
    // testing what it names.
    expect(placed).toHaveLength(2);

    const placedTarget = marked(placed, "target");
    const placedPointer = marked(placed, "pointer");

    expect(placedPointer.attributes?.["aria-describedby"]).toBe(
      placedTarget.cssId
    );
    // The INSERT is where the id moves, because here the destination DOES
    // already hold it.
    expect(placedTarget.cssId).not.toBe("pricing");
  });
});

describe("a link inside the saved run still reaches its own target", () => {
  it("stores an href pointing at the pattern's target, not the page's", () => {
    const doc = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
      node("l", { props: { mark: "link", href: "#pricing" } }),
    ]);

    const stored =
      planSaveAsPattern(doc, ["t", "l"], target, anyParent).create?.document
        .nodes ?? [];
    const copiedTarget = marked(stored, "target");
    const copiedLink = marked(stored, "link");

    expect(copiedLink.props?.href).toBe(`#${copiedTarget.cssId}`);
  });

  it("still reaches it after the pattern is inserted somewhere else", () => {
    const doc = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
      node("l", { props: { mark: "link", href: "#pricing" } }),
    ]);

    const stored = planSaveAsPattern(doc, ["t", "l"], target, anyParent).create
      ?.document;
    const destination = page([node("existing", { cssId: "pricing" })]);
    const insert = planInsertPattern(
      destination,
      { id: "hero-pattern", document: stored as BlockDocument },
      { index: 1 },
      anyParent
    );
    expect(insert.problem).toBeUndefined();
    const placed = (insert.pageOps ?? []).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    // Guarded, because `flatMap` over an empty list makes every assertion
    // below vacuous: `marked` would throw, but only after the test had stopped
    // testing what it names.
    expect(placed).toHaveLength(2);

    const placedTarget = marked(placed, "target");
    expect(marked(placed, "link").props?.href).toBe(`#${placedTarget.cssId}`);
    expect(placedTarget.cssId).not.toBe("pricing");
  });
});

describe("a run inside a container", () => {
  it("plans from the parent's slot, not from the roots", () => {
    const doc = page([
      node(
        "card",
        {},
        {
          body: [
            node("a", { props: { mark: "a" } }),
            node("b", { props: { mark: "b" } }),
            node("c", { props: { mark: "c" } }),
          ],
        }
      ),
    ]);
    const plan = planSaveAsPattern(doc, ["b", "c"], target, anyParent);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("a document whose ids are not unique", () => {
  it("SAVES THE BLOCKS THE AUTHOR SELECTED, not a namesake parent's", () => {
    // Two parents share an id. `siblingRun` located the selection under the
    // SECOND; a lookup by that id answers with the FIRST. Reading the run's
    // indexes out of the re-resolved parent therefore took the wrong
    // container's blocks — a pattern saved from content nobody selected, with
    // nothing reporting it. Each node is now fetched by its own id instead.
    const doc: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        node(
          "dup",
          {},
          {
            body: [
              node("f1", { props: { mark: "first-parent-a" } }),
              node("f2", { props: { mark: "first-parent-b" } }),
            ],
          }
        ),
        node(
          "dup",
          {},
          {
            body: [
              node("s1", { props: { mark: "wanted-a" } }),
              node("s2", { props: { mark: "wanted-b" } }),
            ],
          }
        ),
      ],
    };

    const plan = planSaveAsPattern(doc, ["s1", "s2"], target, anyParent);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "wanted-a",
      "wanted-b",
    ]);
  });
});

describe("a run lifted out of its container", () => {
  it("REFUSES a block that cannot stand at a root, and says what it needs", () => {
    // Saving lifts the run OUT: the pattern's roots are the selected blocks.
    // A `core/column` declares `parent: ["core/columns"]`, so it has just lost
    // the only container it may sit in — and the store validates root
    // placement by the same rule, so planning this as a success would hand
    // back a document the create then refuses.
    const doc = page([
      node(
        "columns",
        { type: "core/columns" },
        {
          children: [
            node("c1", { type: "core/column" }),
            node("c2", { type: "core/column" }),
          ],
        }
      ),
    ]);

    const plan = planSaveAsPattern(doc, ["c1", "c2"], target, columnsOnly);

    expect(plan.problem).toBe("restricted-at-root");
    expect(plan.permitted).toEqual(["core/columns"]);
    expect(plan.create).toBeUndefined();
  });

  it("allows the CONTAINER itself, which is the remedy", () => {
    const doc = page([
      node(
        "columns",
        { type: "core/columns" },
        {
          children: [node("c1", { type: "core/column" })],
        }
      ),
    ]);

    const plan = planSaveAsPattern(doc, ["columns"], target, columnsOnly);

    expect(plan.problem).toBeUndefined();
    expect(plan.create?.document.nodes).toHaveLength(1);
  });
});

describe("an id that names two different nodes", () => {
  it("saves the node the SELECTION found, not a namesake elsewhere", () => {
    // The search behind `contiguousRun` checks every root before descending;
    // a plain find walks each root and its descendants in turn. So a nested
    // node and a later top-level node sharing an id resolve differently in the
    // two, and re-looking-up the id stored the wrong one. The run now carries
    // the node it actually found.
    const doc = page([
      node(
        "holder",
        {},
        { body: [node("same", { props: { mark: "nested" } })] }
      ),
      node("same", { props: { mark: "top-level" } }),
    ]);

    const plan = planSaveAsPattern(doc, ["same"], target, anyParent);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "top-level",
    ]);
  });
});

describe("what it refuses, and why", () => {
  it("refuses a selection with a block left out of the middle", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    const plan = planSaveAsPattern(doc, ["a", "c"], target, anyParent);

    expect(plan.problem).toBe("gap");
    expect(plan.create).toBeUndefined();
  });

  it("refuses blocks that sit in two different containers", () => {
    const doc = page([
      node("one", {}, { body: [node("a")] }),
      node("two", {}, { body: [node("b")] }),
    ]);

    expect(planSaveAsPattern(doc, ["a", "b"], target, anyParent).problem).toBe(
      "split"
    );
  });

  it("refuses an empty selection", () => {
    expect(
      planSaveAsPattern(page([node("a")]), [], target, anyParent).problem
    ).toBe("empty");
  });

  it("refuses an id the document does not hold, as its own cause", () => {
    expect(
      planSaveAsPattern(page([node("a")]), ["a", "ghost"], target, anyParent)
        .problem
    ).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const componentTarget = {
  collection: "components",
  fields: { title: "Card", slug: "card" },
};

/**
 * The row a plan proposes, or a failure naming the cause.
 *
 * A helper rather than a non-null assertion, so a test that stops planning for
 * a reason nobody predicted says which reason instead of reporting that
 * `undefined` has no `document`.
 */
function created<T>(plan: PlanResult<T>): PlannedCreate<T> {
  if (plan.create === undefined) {
    throw new Error(`no plan: ${String(plan.problem)}`);
  }
  return plan.create;
}

/** The definition a component plan would store. */
function definition<T>(plan: PlanResult<T>): ComponentDocument {
  return created(plan).document as ComponentDocument;
}

/** The page ops a plan proposes, or a failure naming the cause. */
function pageOps<T>(plan: PlanResult<T>): readonly BuilderOp[] {
  if (plan.pageOps === undefined) {
    throw new Error(`no plan: ${String(plan.problem)}`);
  }
  return plan.pageOps;
}

/**
 * A forest with every id replaced by its position in the walk.
 *
 * Two saves of one selection mint different node ids by design, so comparing
 * them byte-for-byte would fail on the one difference that is supposed to be
 * there. Normalising the ids leaves every other difference visible, which is
 * what "the same document" has to mean here.
 */
function shapeOf(nodes: BlockNode[]): string {
  const order = new Map<string, number>();
  walkNodes(nodes, n => order.set(n.id, order.size));
  return JSON.stringify(nodes, (key, value) =>
    key === "id" && typeof value === "string"
      ? (order.get(value) ?? value)
      : value
  );
}

/** A page whose selected card holds a headline the author might expose. */
function cardPage(): BlockDocument {
  return page([
    node("outside", { props: { mark: "outside", text: "elsewhere" } }),
    node(
      "card",
      { props: { mark: "card" } },
      {
        children: [
          node("headline", { props: { mark: "headline", text: "Hi" } }),
        ],
      }
    ),
  ]);
}

/** One nominated text property, pointing wherever the test says. */
function exposeText(nodeId: string, extra: Record<string, unknown> = {}) {
  return {
    properties: [
      {
        id: "p1",
        label: "Headline",
        nodeId,
        propPath: "text",
        type: "text" as const,
        ...extra,
      },
    ],
  };
}

describe("an exposed pointer follows the copy", () => {
  it("re-aims nodeId at the STORED node, and that node is there", () => {
    const stored = definition(
      planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        exposeText("headline"),
        anyParent
      )
    );

    const headline = marked(stored.nodes, "headline");
    expect(stored.exposed?.[0]?.nodeId).toBe(headline.id);
    // The pointer resolving is the property that matters; the id merely
    // differing from the page's would also be true of a random string.
    expect(idsIn(stored.nodes)).toContain(stored.exposed?.[0]?.nodeId);
    expect(stored.exposed?.[0]?.nodeId).not.toBe("headline");
  });

  it("re-aims a slot region the same way", () => {
    const stored = definition(
      planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        {
          slots: { body: { label: "Body", nodeId: "card", slot: "children" } },
        },
        anyParent
      )
    );

    expect(stored.slots?.body?.nodeId).toBe(marked(stored.nodes, "card").id);
    expect(idsIn(stored.nodes)).toContain(stored.slots?.body?.nodeId);
  });

  it("refuses a nomination naming a node OUTSIDE the selection", () => {
    const plan = planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposeText("outside"),
      anyParent
    );

    expect(plan.problem).toBe("invalid-exposure");
    expect(plan.issues?.map(one => one.code)).toContain("exposed-node-missing");
    expect(plan.issues?.[0]?.path).toContain("/exposed/0");
  });

  it("does not alias the options array it was handed", () => {
    const options = [{ value: "a", label: "A" }];
    const stored = definition(
      planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        exposeText("headline", { type: "select", options }),
        anyParent
      )
    );

    options.push({ value: "b", label: "B" });
    expect(stored.exposed?.[0]?.options).toHaveLength(1);
  });
});

describe("the envelope is judged by the rule that will publish it", () => {
  const refusalFor = (properties: unknown[]) =>
    planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      { properties } as never,
      anyParent
    );

  it("refuses two exposures sharing one id", () => {
    const one = exposeText("headline").properties[0];
    const plan = refusalFor([one, { ...one, label: "Second" }]);
    expect(plan.problem).toBe("invalid-exposure");
    expect(plan.issues?.map(i => i.code)).toContain("exposed-duplicate-id");
  });

  it("refuses options on something that is not a select", () => {
    const plan = refusalFor([
      {
        ...exposeText("headline").properties[0],
        options: [{ value: "a", label: "A" }],
      },
    ]);
    expect(plan.issues?.map(i => i.code)).toContain("exposed-options-invalid");
  });

  it("refuses a select with no options", () => {
    const plan = refusalFor([
      { ...exposeText("headline").properties[0], type: "select" },
    ]);
    expect(plan.issues?.map(i => i.code)).toContain("exposed-options-invalid");
  });

  it("refuses a type outside the vocabulary", () => {
    const plan = refusalFor([
      { ...exposeText("headline").properties[0], type: "colour" },
    ]);
    expect(plan.issues?.map(i => i.code)).toContain("exposed-property-invalid");
  });

  it("refuses a prop path that is not a path", () => {
    const plan = refusalFor([
      { ...exposeText("headline").properties[0], propPath: "text..deep" },
    ]);
    expect(plan.issues?.map(i => i.code)).toContain("exposed-path-invalid");
  });

  it("refuses a slot the node it points at does not declare", () => {
    const plan = planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      { slots: { body: { label: "Body", nodeId: "card", slot: "footer" } } },
      anyParent
    );
    expect(plan.issues?.map(i => i.code)).toContain("exposed-slot-missing");
  });
});

describe("what a saved component is", () => {
  it("is the tree a pattern save stores, under a component kind", () => {
    const doc = cardPage();
    const asPattern = created(
      planSaveAsPattern(doc, ["card"], target, anyParent)
    ).document;
    const asComponent = definition(
      planSaveAsComponent(doc, ["card"], componentTarget, {}, anyParent)
    );

    expect(shapeOf(asComponent.nodes)).toBe(shapeOf(asPattern.nodes));
    expect(asComponent.kind).toBe("component");
    expect(asComponent.formatVersion).toBe(doc.formatVersion);
  });

  it("declares no exposed field when nothing was nominated", () => {
    const stored = definition(
      planSaveAsComponent(cardPage(), ["card"], componentTarget, {}, anyParent)
    );
    // Absence is what the contract already reads as "exposes none", so writing
    // an empty array would make two saves of one selection differ by whether
    // the caller passed a list it had not filled.
    expect("exposed" in stored).toBe(false);
    expect("slots" in stored).toBe(false);
  });

  it("declares no exposed field for an EMPTY nomination either", () => {
    // The separate case, because absent and empty arrive by different routes: a
    // surface that builds the list from the author's ticks passes `[]` when
    // they tick nothing, and a stored `[]` would make that save differ from one
    // where the surface passed nothing at all.
    const stored = definition(
      planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        { properties: [], slots: {} },
        anyParent
      )
    );
    expect("exposed" in stored).toBe(false);
    expect("slots" in stored).toBe(false);
  });

  it("leaves the page alone", () => {
    expect(
      planSaveAsComponent(cardPage(), ["card"], componentTarget, {}, anyParent)
        .pageOps
    ).toEqual([]);
  });

  it("refuses what a pattern save refuses about the selection", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    expect(
      planSaveAsComponent(doc, ["a", "c"], componentTarget, {}, anyParent)
        .problem
    ).toBe("gap");
  });
});

describe("converting a run into an instance", () => {
  it("removes the run and puts one instance where it stood", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    const plan = planConvertToComponent(
      doc,
      ["a", "b"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    expect(pageOps(plan).map(op => op.kind)).toEqual([
      "remove",
      "remove",
      "insert",
    ]);

    // The plan IS the dry run, so the ops it proposes have to apply.
    const after = applyOps(doc, pageOps(plan)).document;
    expect(after.nodes.map(n => n.type)).toEqual([
      COMPONENT_INSTANCE_TYPE,
      "core/box",
    ]);
    expect(after.nodes[0]?.props?.componentId).toBe("def-1");
  });

  it("puts the instance back inside the container the run sat in", () => {
    const doc = page([
      node("wrap", {}, { children: [node("a"), node("b"), node("c")] }),
    ]);
    const plan = planConvertToComponent(
      doc,
      ["b"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    const after = applyOps(doc, pageOps(plan)).document;
    expect(after.nodes[0]?.slots?.children.map(n => n.type)).toEqual([
      "core/box",
      COMPONENT_INSTANCE_TYPE,
      "core/box",
    ]);
  });

  it("appends when the run ended the list", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    const plan = planConvertToComponent(
      doc,
      ["b", "c"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    const after = applyOps(doc, pageOps(plan)).document;
    expect(after.nodes.map(n => n.type)).toEqual([
      "core/box",
      COMPONENT_INSTANCE_TYPE,
    ]);
  });

  it("stores the definition a plain component save would store", () => {
    const doc = cardPage();
    const saved = definition(
      planSaveAsComponent(
        doc,
        ["card"],
        componentTarget,
        exposeText("headline"),
        anyParent
      )
    );
    const converted = definition(
      planConvertToComponent(
        doc,
        ["card"],
        componentTarget,
        "def-1",
        exposeText("headline"),
        anyParent
      )
    );

    expect(shapeOf(converted.nodes)).toBe(shapeOf(saved.nodes));
    expect(converted.exposed?.[0]?.nodeId).toBe(
      marked(converted.nodes, "headline").id
    );
  });

  it("names the row the instance points at", () => {
    const plan = planConvertToComponent(
      page([node("a")]),
      ["a"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );
    expect(created(plan).id).toBe("def-1");
  });

  it("refuses a component id that names nothing", () => {
    const doc = page([node("a")]);
    expect(
      planConvertToComponent(doc, ["a"], componentTarget, "", {}, anyParent)
        .problem
    ).toBe("invalid-source");
    expect(
      planConvertToComponent(
        doc,
        ["a"],
        componentTarget,
        undefined as unknown as string,
        {},
        anyParent
      ).problem
    ).toBe("invalid-source");
  });

  it("refuses a selected root the document holds twice", () => {
    // `remove` addresses by id and could not say which node it meant. The
    // duplicate is reachable from a page nothing validated, and it sits where
    // the selection does NOT: a nested copy of a top-level id, which
    // `contiguousRun` resolves to one node without complaint.
    const doc = page([
      node("dup"),
      node("other", {}, { children: [node("dup")] }),
    ]);

    expect(
      planConvertToComponent(
        doc,
        ["dup"],
        componentTarget,
        "def-1",
        {},
        anyParent
      ).problem
    ).toBe("duplicate-destination");
    expect(() => applyOps(doc, [{ kind: "remove", id: "dup" }])).toThrow();
  });

  it("refuses a locked block, which is what the remove would do", () => {
    const doc = page([node("a", { locked: true })]);

    expect(
      planConvertToComponent(
        doc,
        ["a"],
        componentTarget,
        "def-1",
        {},
        anyParent
      ).problem
    ).toBe("destination-locked");
    // The other direction of the dry-run contract: the refusal is the apply's
    // own, not a rule this module invented that the apply does not share.
    expect(() => applyOps(doc, [{ kind: "remove", id: "a" }])).toThrow();
  });

  it("asks the nesting rule about the INSTANCE, not about what it replaces", () => {
    const instanceNeedsSection = {
      parentsOf: (type: string) =>
        type === COMPONENT_INSTANCE_TYPE ? ["core/section"] : undefined,
    };
    const doc = page([node("a")]);

    // The run itself is unrestricted, so the SAVE half is happy.
    expect(
      planSaveAsComponent(doc, ["a"], componentTarget, {}, instanceNeedsSection)
        .problem
    ).toBeUndefined();
    // The instance going back is not.
    const plan = planConvertToComponent(
      doc,
      ["a"],
      componentTarget,
      "def-1",
      {},
      instanceNeedsSection
    );
    expect(plan.problem).toBe("restricted-at-root");
    expect(plan.permitted).toEqual(["core/section"]);
  });
});

describe("a nomination this cannot read is refused, never dropped or dereferenced", () => {
  const plan = (exposure: unknown) =>
    planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposure as never,
      anyParent
    );

  it("refuses a properties value that is not a list", () => {
    // Normalising it to absent reported SUCCESS for a nomination the caller
    // made and this could not read.
    const result = plan({ properties: "bad" });
    expect(result.problem).toBe("invalid-exposure");
    expect(result.issues?.map(i => i.code)).toContain(
      "component-envelope-invalid"
    );
  });

  it("refuses a null entry instead of throwing on it", () => {
    let threw: unknown;
    let result;
    try {
      result = plan({ properties: [null] });
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeUndefined();
    expect(result?.problem).toBe("invalid-exposure");
  });

  it("refuses a slots value that is not a record", () => {
    expect(plan({ slots: "bad" }).problem).toBe("invalid-exposure");
  });

  it("does not run a prototype setter for a __proto__ slot key", () => {
    // Assigning to it invokes the inherited setter rather than creating a
    // property, so the slot the author asked for vanishes and the result gains
    // a prototype — making the validator refuse what it accepts when the same
    // document is stored directly.
    const result = plan({
      slots: { __proto__: { label: "B", nodeId: "card", slot: "children" } },
    });
    expect(result.problem).toBe("invalid-exposure");
  });

  it("copies each option RECORD, not only the list", () => {
    // The weaker test — pushing a new element — stays green while every option
    // object is still shared with the caller's request.
    const options = [{ value: "a", label: "A" }];
    const stored = definition(
      planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        exposeText("headline", { type: "select", options }),
        anyParent
      )
    );

    options[0]!.label = "MUTATED";
    expect(stored.exposed?.[0]?.options?.[0]?.label).toBe("A");
  });

  it("refuses a nomination naming an id the selection holds twice", () => {
    // The map is keyed on the ORIGINAL id, so the second node's mapping
    // replaces the first — and the pointer lands on whichever came last. It
    // resolves, so the envelope check passes and every instance override then
    // edits a block the author did not choose.
    const doc = page([
      node(
        "wrap",
        {},
        {
          children: [
            node("dup", { props: { mark: "first" } }),
            node("dup", { props: { mark: "second" } }),
          ],
        }
      ),
    ]);

    expect(
      planSaveAsComponent(
        doc,
        ["wrap"],
        componentTarget,
        exposeText("dup"),
        anyParent
      ).problem
    ).toBe("ambiguous-exposure");
  });
});

describe("a convert refuses everything its ops would meet", () => {
  it("refuses when a sibling the author never selected is malformed", () => {
    // `applyOps` walks the WHOLE forest before applying anything, so a plan
    // that ignores an unselected malformed node succeeds and then throws on its
    // first op — after the library row has been written.
    const doc = page([node("a"), null as unknown as BlockNode]);

    expect(
      planConvertToComponent(
        doc,
        ["a"],
        componentTarget,
        "def-1",
        {},
        anyParent
      ).problem
    ).toBe("unusable-document");
    expect(() => applyOps(doc, [{ kind: "remove", id: "a" }])).toThrow();
  });

  it("refuses a duplicate id on a DESCENDANT, not just on the root", () => {
    // `remove` refuses when any id inside the subtree it takes occurs twice in
    // the document, because its inverse could not put that subtree back. A
    // root-only check passes this and the apply throws.
    const doc = page([
      node("a", {}, { children: [node("dup")] }),
      node("other", {}, { children: [node("dup")] }),
    ]);

    expect(
      planConvertToComponent(
        doc,
        ["a"],
        componentTarget,
        "def-1",
        {},
        anyParent
      ).problem
    ).toBe("duplicate-destination");
    expect(() => applyOps(doc, [{ kind: "remove", id: "a" }])).toThrow();
  });
});

describe("the exposure request itself is judged before its fields", () => {
  const plan = (exposure: unknown) =>
    planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposure as never,
      anyParent
    );

  it.each([
    ["null", null],
    ["a string", "bad"],
    ["an array", []],
    ["a number", 3],
  ])("refuses %s as the whole request", (_name, exposure) => {
    // `null` threw; a string and an array answered `undefined` to both field
    // reads and were taken for "expose nothing", which reports success for a
    // request nobody could honour.
    let threw: unknown;
    let result;
    try {
      result = plan(exposure);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeUndefined();
    expect(result?.problem).toBe("invalid-exposure");
  });

  it("still treats an absent request as exposing nothing", () => {
    // The one value that SAYS so, rather than failing to say anything.
    const stored = definition(plan(undefined));
    expect("exposed" in stored).toBe(false);
  });

  it("carries a malformed options value to the validator", () => {
    // Omitting it turned a refusal into a success: the envelope check rejects a
    // present `options` on anything but a select, and one that is not a list.
    const result = plan({
      properties: [{ ...exposeText("headline").properties[0], options: "bad" }],
    });
    expect(result.problem).toBe("invalid-exposure");
    expect(result.issues?.map(i => i.code)).toContain(
      "exposed-options-invalid"
    );
  });

  it("carries a malformed slot allow-list to the validator", () => {
    // Dropping it left an unrestricted slot the planner then reported as fine.
    const result = plan({
      slots: {
        body: { label: "Body", nodeId: "card", slot: "children", allow: "bad" },
      },
    });
    expect(result.problem).toBe("invalid-exposure");
  });

  it("refuses an over-cap properties list WITHOUT reading its entries", () => {
    // The refusal alone does not discriminate: mapping the list first and then
    // letting `eachBounded` reject it reaches the same answer, having done
    // exactly the work the cap exists to refuse. So the entries count their own
    // reads, and the assertion is that none happened.
    let reads = 0;
    const many = Array.from({ length: MAX_ENVELOPE_ENTRIES + 1 }, (_, i) => {
      const entry: Record<string, unknown> = {
        label: "L",
        nodeId: "headline",
        propPath: "text",
        type: "text",
      };
      Object.defineProperty(entry, "id", {
        enumerable: true,
        get() {
          reads += 1;
          return `p${String(i)}`;
        },
      });
      return entry;
    });

    expect(plan({ properties: many }).problem).toBe("invalid-exposure");
    expect(reads).toBe(0);
  });

  it("refuses an over-cap slot map WITHOUT reading its entries", () => {
    let reads = 0;
    const slots: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_ENVELOPE_ENTRIES; i++) {
      const entry: Record<string, unknown> = {
        nodeId: "card",
        slot: "children",
      };
      Object.defineProperty(entry, "label", {
        enumerable: true,
        get() {
          reads += 1;
          return "S";
        },
      });
      slots[`s${String(i)}`] = entry;
    }

    expect(plan({ slots }).problem).toBe("invalid-exposure");
    expect(reads).toBe(0);
  });
});

describe("a caller-sized exposure costs a refusal, not a traversal", () => {
  const plan = (exposure: unknown, limits?: DocumentLimits) =>
    planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposure as never,
      anyParent,
      limits
    );

  it("does not read an over-cap list while checking for ambiguity", () => {
    // The ambiguity pass runs BEFORE the mappers, so their caps do not cover
    // it — and an over-cap list is refused by the envelope check whatever this
    // pass concludes, which makes reading it work the cap exists to refuse.
    let reads = 0;
    const many = Array.from({ length: MAX_ENVELOPE_ENTRIES + 1 }, (_, i) => {
      const entry: Record<string, unknown> = {
        id: `p${String(i)}`,
        label: "L",
        propPath: "text",
        type: "text",
      };
      Object.defineProperty(entry, "nodeId", {
        enumerable: true,
        get() {
          reads += 1;
          return "headline";
        },
      });
      return entry;
    });

    expect(plan({ properties: many }).problem).toBe("invalid-exposure");
    expect(reads).toBe(0);
  });

  it("refuses an array whose `map` the caller shadowed", () => {
    // The entries and the array type are both valid here; only the inherited
    // method is shadowed, so none of the entry guards sees anything wrong.
    const shadowed: unknown[] = [exposeText("headline").properties[0]];
    Object.defineProperty(shadowed, "map", {
      value: "not a function",
      enumerable: true,
    });

    let threw: unknown;
    let result;
    try {
      result = plan({ properties: shadowed });
    } catch (error) {
      threw = error;
    }

    // Not a native error, which is the property this test was written for.
    expect(threw).toBeUndefined();
    // And refused, which it was not when this test was first written. An own
    // `map` is a non-index key on an array, and `JSON.stringify` writes an
    // array by position — so the key is silently lost and the list does not
    // round-trip. The op layer refuses such a list outright, and asking that
    // rule here rather than only avoiding `map` is what closed the accessor
    // case beside it.
    expect(result?.problem).toBe("invalid-exposure");
  });

  it("indexes the envelope under the HOST's node cap, not its own", () => {
    // A host may raise `maxNodes`, and strict validation — the gate this dry
    // run predicts — is given the host's limits. Indexing under the default
    // leaves a large definition's later nodes outside the index, so a sound
    // exposure is reported as pointing at nothing and the planner refuses a
    // component the apply would publish.
    const children: BlockNode[] = [];
    for (let i = 0; i < 5200; i += 1) children.push(node(`k${String(i)}`));
    const doc = page([node("root", {}, { children })]);
    const exposure = {
      properties: [
        {
          id: "p1",
          label: "L",
          nodeId: "k5100",
          propPath: "text",
          type: "text" as const,
        },
      ],
    };

    const raised = planSaveAsComponent(
      doc,
      ["root"],
      componentTarget,
      exposure,
      anyParent,
      { ...DEFAULT_LIMITS, maxNodes: 6000 }
    );
    expect(raised.problem).toBeUndefined();

    // The control: under the DEFAULT cap the same definition is refused, so
    // the assertion above is about the limit being threaded rather than about
    // the pointer happening to resolve.
    //
    // Refused for its SIZE, which is what is actually wrong with it. This
    // asserted `exposed-node-missing` until the bound was settled before the
    // index was built — and that verdict was the defect: `k5100` is a real node
    // this document really contains, called dangling only because the index
    // stopped at the cap. It sent an author to repair a sound exposure while
    // the size, the one thing they could act on, went unmentioned.
    const defaulted = planSaveAsComponent(
      doc,
      ["root"],
      componentTarget,
      exposure,
      anyParent
    );
    expect(defaulted.problem).toBe("exceeds-limits");
    expect(defaulted.issues).toBeUndefined();
  });
});

describe("what the plan promises about the page it will edit", () => {
  it("refuses a replacement that would push the page past its byte cap", () => {
    // Only the APPLY can answer this: `assertFitsCaps` measures the document a
    // node is going into, so a subtree with no destination cannot be judged
    // against it — which `nodeShapeRefusal` says in as many words. A run
    // replaced by a LARGER instance crosses a cap the page was inside.
    const doc = page([node("a")]);
    const limits = {
      ...DEFAULT_LIMITS,
      maxBytes: JSON.stringify(doc).length,
    };

    expect(
      planConvertToComponent(
        doc,
        ["a"],
        componentTarget,
        "def-1",
        {},
        anyParent,
        limits
      ).problem
    ).toBe("exceeds-limits");

    // The other direction of the dry-run contract: the apply refuses it too.
    expect(() =>
      applyOps(
        doc,
        [
          { kind: "remove", id: "a" },
          {
            kind: "insert",
            node: {
              id: "i1",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "def-1" },
            },
            at: { index: 0 },
          },
        ],
        limits
      )
    ).toThrow();
  });

  it("refuses a definition JSON could not write, envelope included", () => {
    // The envelope is caller-supplied and the envelope check reads only `value`
    // and `label`, so an option carrying a `BigInt` passes it and makes the
    // whole document unstorable. The tree was already asked this question
    // before it had an envelope; the completed definition is asked it again.
    const plan = planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposeText("headline", {
        type: "select",
        options: [{ value: "x", label: "X", metadata: 1n }],
      }) as never,
      anyParent
    );

    expect(plan.problem).toBe("unusable-document");
  });
});

describe("a list nested inside an exposure is bounded too", () => {
  it("does not copy an over-cap options list", () => {
    // Nothing outside the entry bounds a list inside it: the outer cap already
    // admitted this single nomination.
    let reads = 0;
    const options: unknown[] = [];
    for (let i = 0; i <= MAX_ENVELOPE_ENTRIES; i += 1) {
      const option: Record<string, unknown> = { value: `v${String(i)}` };
      Object.defineProperty(option, "label", {
        enumerable: true,
        get() {
          reads += 1;
          return "L";
        },
      });
      options.push(option);
    }

    const plan = planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      exposeText("headline", { type: "select", options }) as never,
      anyParent
    );

    expect(plan.problem).toBe("invalid-exposure");
    expect(reads).toBe(0);
  });

  it("copies an allow-list without invoking its iterator", () => {
    // A spread runs `Symbol.iterator`, which is inherited and so the caller's
    // to shadow — on an array whose entries are all well formed, which is why
    // the entry guards cannot see it.
    const allow: unknown[] = ["core/box"];
    Object.defineProperty(allow, Symbol.iterator, { value: "not a function" });

    let threw: unknown;
    let plan;
    try {
      plan = planSaveAsComponent(
        page([node("card", {}, { children: [] })]),
        ["card"],
        componentTarget,
        {
          slots: {
            body: { label: "B", nodeId: "card", slot: "children", allow },
          },
        } as never,
        anyParent
      );
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeUndefined();
    expect(plan?.problem).toBeUndefined();
  });
});

describe("the request is read once, so two passes cannot disagree", () => {
  /** A nomination whose `nodeId` answers differently on each read. */
  function shiftingNomination(values: readonly string[]) {
    let reads = 0;
    const entry: Record<string, unknown> = {
      id: "p1",
      label: "L",
      propPath: "text",
      type: "text",
    };
    Object.defineProperty(entry, "nodeId", {
      enumerable: true,
      get() {
        const value = values[Math.min(reads, values.length - 1)]!;
        reads += 1;
        return value;
      },
    });
    return { entry, reads: () => reads };
  }

  it("reads a nominated nodeId exactly once", () => {
    const { entry, reads } = shiftingNomination(["headline"]);

    planSaveAsComponent(
      cardPage(),
      ["card"],
      componentTarget,
      { properties: [entry] } as never,
      anyParent
    );

    // Three reads before this: twice while collecting ids for the ambiguity
    // guard, once again in the mapper. A value that shifts between them let the
    // guard clear one id while the mapper stored another.
    expect(reads()).toBe(1);
  });

  it("judges the id it will store, not one it saw on the way", () => {
    // The selection holds `dup` twice, so a nomination naming it must refuse.
    // Reading three times let a getter show the guard a safe id and the mapper
    // the ambiguous one — the plan succeeding, the pointer resolving, and every
    // instance override editing a node the author never chose.
    const doc = page([
      node("wrap", {}, { children: [node("safe"), node("dup"), node("dup")] }),
    ]);
    const { entry } = shiftingNomination(["dup", "safe", "safe"]);

    expect(
      planSaveAsComponent(
        doc,
        ["wrap"],
        componentTarget,
        { properties: [entry] } as never,
        anyParent
      ).problem
    ).toBe("ambiguous-exposure");
  });
});

describe("what a definition may not be", () => {
  it("refuses one that would exceed the caller's byte cap", () => {
    // An exposure only ever makes a document bigger, so a page that fits can
    // become a definition that does not — and `documentRefusal` answers whether
    // a document can be EDITED, which is a different question from whether it
    // fits.
    const doc = page([node("a")]);
    const limits = {
      ...DEFAULT_LIMITS,
      maxBytes: JSON.stringify(doc).length + 10,
    };

    expect(
      planSaveAsComponent(
        doc,
        ["a"],
        componentTarget,
        {
          properties: [
            {
              id: "p1",
              label: "A label long enough to carry it over the cap",
              nodeId: "a",
              propPath: "text",
              type: "text" as const,
            },
          ],
        },
        anyParent,
        limits
      ).problem
    ).toBe("exceeds-limits");
  });

  it("refuses one that would contain an instance of itself", () => {
    // The selection can already hold an instance of the component about to be
    // created — a dangling one on the page. The resolver classifies that as a
    // cycle and leaves it unresolved, so a conversion whose dry run succeeded
    // replaces visible content with a broken placeholder.
    const doc = page([
      {
        id: "i1",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "def-1" },
      },
    ]);

    expect(
      planConvertToComponent(
        doc,
        ["i1"],
        componentTarget,
        "def-1",
        {},
        anyParent
      ).problem
    ).toBe("self-reference");

    // The control: converting it under a DIFFERENT id is fine, so the refusal
    // is about the self-reference rather than about instances in a selection.
    expect(
      planConvertToComponent(
        doc,
        ["i1"],
        componentTarget,
        "def-2",
        {},
        anyParent
      ).problem
    ).toBeUndefined();
  });

  it("refuses an exposure list whose indices are accessors", () => {
    // A genuine array, with entries that would be well formed, that computes
    // them. Neither the array check nor the entry guards see it, and reading
    // one index runs the caller's code — while a getter that appends extends
    // `length` underneath the loop the cap is supposed to hold.
    //
    // Refused rather than carried to the validator: carrying works for a value
    // the envelope check can READ, and this one explodes wherever it is first
    // touched, which only moves the failure into validation.
    const computed: unknown[] = [];
    Object.defineProperty(computed, "0", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("read me and find out");
      },
    });
    Object.defineProperty(computed, "length", { value: 1, writable: true });

    let threw: unknown;
    let result;
    try {
      result = planSaveAsComponent(
        cardPage(),
        ["card"],
        componentTarget,
        { properties: computed } as never,
        anyParent
      );
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeUndefined();
    expect(result?.problem).toBe("invalid-exposure");
  });
});

describe("an insert records what it renamed, and a save puts it back", () => {
  /** A pattern whose only node is named `pricing`, plus a link to it. */
  function heroPattern(): BlockDocument {
    const authored = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
      node("l", {
        props: { mark: "link" },
        attributes: { "aria-describedby": "pricing" },
      }),
    ]);
    return created(planSaveAsPattern(authored, ["t", "l"], target, anyParent))
      .document;
  }

  /** Insert it into a page that already holds `pricing`, forcing a rename. */
  function insertedInto(stored: BlockDocument) {
    const destination = page([node("existing", { cssId: "pricing" })]);
    const insert = planInsertPattern(
      destination,
      { id: "hero-pattern", document: stored },
      { index: 1 },
      anyParent
    );
    const placed = pageOps(insert).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    expect(placed).toHaveLength(2);
    return {
      destination: applyOps(destination, pageOps(insert)).document,
      placed,
    };
  }

  it("records the rename on the inserted root, source id to copy id", () => {
    const { placed } = insertedInto(heroPattern());
    const renamedTarget = marked(placed, "target");

    // It really did rename: the destination already held `pricing`.
    expect(renamedTarget.cssId).not.toBe("pricing");
    expect(renamedTarget.cssId).toContain("pricing");

    const origin = renamedTarget.origin;
    expect(origin?.from).toBe("pattern");
    expect(origin?.from === "pattern" ? origin.renamed : undefined).toEqual({
      pricing: renamedTarget.cssId,
    });
  });

  it("records the rename on a root that only REFERENCES the renamed id", () => {
    // The other half of what a rename touches. `reidForestWithMap` rewrites
    // references across the WHOLE forest, so the link root's
    // `aria-describedby` followed `pricing` to its minted name — but the record
    // was built from the ids each root RENDERS, and this root renders none. It
    // therefore carried a page-specific id with nothing saying what it had been.
    const { placed } = insertedInto(heroPattern());
    const renamedTarget = marked(placed, "target");
    const link = marked(placed, "link");

    // It really did follow the rename.
    expect(link.attributes?.["aria-describedby"]).toBe(renamedTarget.cssId);

    const origin = link.origin;
    expect(origin?.from === "pattern" ? origin.renamed : undefined).toEqual({
      pricing: renamedTarget.cssId,
    });
  });

  it("ROUND TRIP: saving only the referencing root restores its reference", () => {
    // The consequence, which the record exists to prevent. Saving the pair
    // together already worked, because the TARGET's record covered `pricing`
    // and the restore reads every selected root's. Saving the link alone is
    // the case that had no answer: the run went into the library still naming
    // `pricing-<suffix>`, an id that exists on exactly one page and resolves to
    // nothing anywhere it is inserted next — a silent loss of the accessible
    // name, which is what these references are for.
    const { destination, placed } = insertedInto(heroPattern());
    const link = marked(placed, "link");

    const saved = planSaveAsPattern(destination, [link.id], target, anyParent);

    const savedLink = marked(created(saved).document.nodes, "link");
    expect(savedLink.attributes?.["aria-describedby"]).toBe("pricing");
  });

  it("restores a renamed id on a node the author gated after inserting", () => {
    // Gating decides what may be RENAMED, because a rename avoids the ids a
    // page renders. Putting one BACK asks nothing about the page — so a node
    // gated between the insert and the save still holds the minted id and still
    // has to give it up. Skipping it restored the link and not its target,
    // which points the two at different ids and breaks the pattern for every
    // page it is inserted into afterwards.
    const { destination, placed } = insertedInto(heroPattern());
    const renamedTarget = marked(placed, "target");
    const gated = page(
      destination.nodes.map(one =>
        one.id === renamedTarget.id
          ? {
              ...one,
              visibility: {
                conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
              },
            }
          : one
      )
    );

    const saved = planSaveAsPattern(
      gated,
      placed.map(one => one.id),
      target,
      anyParent
    );
    const stored = created(saved).document.nodes;

    expect(marked(stored, "target").cssId).toBe("pricing");
    expect(marked(stored, "link").attributes?.["aria-describedby"]).toBe(
      "pricing"
    );
  });

  it.each([
    [
      "an href prop",
      (id: string) => ({ props: { mark: "link", href: `#${id}` } }),
      (n: BlockNode) => n.props?.href,
    ],
    [
      "a bound href's fallback",
      (id: string) => ({
        props: { mark: "link" },
        bindings: { href: { $bind: "url", fallback: `#${id}` } },
      }),
      (n: BlockNode) =>
        (n.bindings as { href?: { fallback?: unknown } } | undefined)?.href
          ?.fallback,
    ],
  ])(
    "records the rename for a root that references it through %s",
    (_name, build, read) => {
      // `relinkOne` rewrites THREE carriers, not one: an IDREFS attribute, a
      // `#id` link in props, and that link's binding fallback. A record built
      // from a second enumeration of the carriers would cover whichever the
      // author of that list remembered, so the record is taken from the relink
      // pass itself and every carrier it rewrites is covered by construction.
      const authored = page([
        node("t", { cssId: "pricing", props: { mark: "target" } }),
        node("l", build("pricing")),
      ]);
      const stored = created(
        planSaveAsPattern(authored, ["t", "l"], target, anyParent)
      ).document;

      const destination = page([node("existing", { cssId: "pricing" })]);
      const insert = planInsertPattern(
        destination,
        { id: "hero-pattern", document: stored },
        { index: 1 },
        anyParent
      );
      const placed = pageOps(insert).flatMap(op =>
        op.kind === "insert" ? [op.node] : []
      );
      const renamedTarget = marked(placed, "target");
      const link = marked(placed, "link");

      // It really did follow the rename.
      expect(read(link)).toBe(`#${renamedTarget.cssId!}`);

      const origin = link.origin;
      expect(origin?.from === "pattern" ? origin.renamed : undefined).toEqual({
        pricing: renamedTarget.cssId,
      });
    }
  );

  it("records nothing when nothing was renamed", () => {
    // Absent rather than empty, so a copy that renamed nothing is identical to
    // one taken before this was recorded.
    const insert = planInsertPattern(
      page([node("other", { cssId: "elsewhere" })]),
      { id: "hero-pattern", document: heroPattern() },
      { index: 1 },
      anyParent
    );
    const placed = pageOps(insert).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    );
    const origin = marked(placed, "target").origin;

    expect(origin?.from === "pattern" ? "renamed" in origin : true).toBe(false);
  });

  it("ROUND TRIP: saving the copy back stores the source's own ids", () => {
    // The property neither planner has on its own. The insert renames to fit
    // the page; the save puts it back — so a copy edited and saved over its own
    // pattern is stored under the names the pattern uses, its digest does not
    // move, and every other copy of that pattern stays in sync.
    const stored = heroPattern();
    const { destination, placed } = insertedInto(stored);
    const ids = placed.map(one => one.id);

    const saved = planUpdatePatternFromSelection(
      destination,
      ids,
      { collection: "patterns", id: "hero-pattern" },
      anyParent
    );

    const rewritten = saved.update?.document;
    expect(rewritten).toBeDefined();

    const savedTarget = marked(rewritten!.nodes, "target");
    const savedLink = marked(rewritten!.nodes, "link");

    // The authored id, not the one minted to fit that one page.
    expect(savedTarget.cssId).toBe("pricing");
    // And the reference followed it, which is the half a value-only fix misses.
    expect(savedLink.attributes?.["aria-describedby"]).toBe("pricing");

    // The whole point: the pattern's fingerprint has not moved, so no other
    // copy is told it is stale for an edit nobody made.
    expect(patternDigest(rewritten!.nodes)).toBe(patternDigest(stored.nodes));
  });

  it("leaves a copy with no record exactly as it is", () => {
    // The migration path: a root inserted before this field existed carries no
    // record, which says the same thing an empty one does — restore nothing.
    const stored = heroPattern();
    const { destination, placed } = insertedInto(stored);
    const withoutRecord = page(
      applyOps(destination, []).document.nodes.map(one =>
        one.origin?.from === "pattern"
          ? {
              ...one,
              origin: {
                from: "pattern" as const,
                id: one.origin.id,
                digest: one.origin.digest,
              },
            }
          : one
      )
    );

    const saved = planUpdatePatternFromSelection(
      withoutRecord,
      placed.map(one => one.id),
      { collection: "patterns", id: "hero-pattern" },
      anyParent
    );

    // Unchanged: the minted id is stored, exactly as it was before this change.
    expect(marked(saved.update!.document.nodes, "target").cssId).not.toBe(
      "pricing"
    );
  });

  it("refuses two copies of one pattern that restore to the same id", () => {
    // Honest rather than convenient: the run really does hold two elements the
    // source names identically, and storing them under their minted names would
    // put two ids nobody wrote into the library, each suffixed again next time.
    const stored = heroPattern();
    const first = insertedInto(stored);
    const second = planInsertPattern(
      first.destination,
      { id: "hero-pattern", document: stored },
      { index: 3 },
      anyParent
    );
    const page2 = applyOps(first.destination, pageOps(second)).document;
    const everyId = page2.nodes
      .filter(one => one.origin !== undefined)
      .map(one => one.id);

    expect(
      planUpdatePatternFromSelection(
        page2,
        everyId,
        { collection: "patterns", id: "hero-pattern" },
        anyParent
      ).problem
    ).toBe("duplicate-dom-id");
  });
});

describe("duplicating a component definition", () => {
  /** A definition exposing a property and a slot, both pointing into its tree. */
  function definitionWith(extra: Partial<ComponentDocument> = {}) {
    return {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes: [
        node(
          "card",
          { props: { mark: "card" }, cssId: "hero" },
          {
            children: [
              node("headline", { props: { mark: "headline", text: "Hi" } }),
            ],
          }
        ),
      ],
      exposed: [
        {
          id: "p1",
          label: "Headline",
          nodeId: "headline",
          propPath: "text",
          type: "text" as const,
        },
      ],
      slots: { body: { label: "Body", nodeId: "card", slot: "children" } },
      variants: { compact: { label: "Compact", overrides: { p1: "Short" } } },
      ...extra,
    } satisfies ComponentDocument;
  }

  const dup = (source: BlockDocument) =>
    planDuplicateComponent(source, componentTarget, undefined);

  it("re-aims every pointer at the COPY, so the duplicate can be published", () => {
    // The defect this planner is written around: re-identifying without
    // rewriting the pointers yields a definition that loads, renders, offers
    // its properties in the inspector, and fails its own publish gate with one
    // error per exposure.
    const source = definitionWith();
    const copy = definition(dup(source));

    const copiedHeadline = marked(copy.nodes, "headline");
    const copiedCard = marked(copy.nodes, "card");

    expect(copy.exposed?.[0]?.nodeId).toBe(copiedHeadline.id);
    expect(copy.slots?.body?.nodeId).toBe(copiedCard.id);
    // The property that matters, asked of the gate rather than of the ids.
    expect(componentEnvelopeIssues(copy)).toEqual([]);
  });

  it("gives the copy its own node ids", () => {
    const source = definitionWith();
    const copy = definition(dup(source));

    expect(idsIn(copy.nodes)).not.toContain("card");
    expect(idsIn(copy.nodes)).not.toContain("headline");
  });

  it("keeps the exposed ids, because variants are keyed by them", () => {
    // Re-minting would demand a second rewrite of every variant's keys and buy
    // nothing: a fresh duplicate has no instances, and an exposed id is scoped
    // to its own document.
    const copy = definition(dup(definitionWith()));

    expect(copy.exposed?.[0]?.id).toBe("p1");
    expect(copy.variants?.compact?.overrides).toEqual({ p1: "Short" });
  });

  it("keeps the DOM ids", () => {
    // A duplicate is a document of its OWN rather than a copy placed beside the
    // original, so there is nothing to collide with — and composition mints
    // per-instance ids when it inlines a definition.
    expect(marked(definition(dup(definitionWith())).nodes, "card").cssId).toBe(
      "hero"
    );
  });

  it("touches no page", () => {
    expect(dup(definitionWith()).pageOps).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "row"],
    ["a number", 3],
  ])("answers rather than throwing for %s", (_name, row) => {
    // A published entry point handed a STORED ROW, and a row can be any of
    // these — where reading `.kind` off it takes a native error out of a
    // function that promises a refusal.
    let threw: unknown;
    let result;
    try {
      result = planDuplicateComponent(
        row as unknown as BlockDocument,
        componentTarget
      );
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeUndefined();
    expect(result?.problem).toBe("not-a-component");
  });

  it.each([
    ["a null among the nodes", [node("a"), null as unknown as BlockNode]],
    [
      "a null nested in a slot",
      [node("a", {}, { children: [null as unknown as BlockNode] })],
    ],
  ])("refuses %s", (_name, nodes) => {
    // `documentRefusal` reads the envelope and the `nodes` array, not the
    // entries inside it — so without the forest check beside it these were
    // copied into a duplicate that PLANNED SUCCESSFULLY and then could not be
    // published, since strict validation is this collection's gate. Every other
    // planner here pairs the two refusals; this one now does too.
    const broken = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes,
    } as unknown as BlockDocument;

    expect(planDuplicateComponent(broken, componentTarget).problem).toBe(
      "unusable-document"
    );
  });

  it("refuses a document that is not a component", () => {
    // A pattern duplicated through here would be stored as a component and
    // refused by the collection it landed in, having reported success.
    expect(dup(page([node("a")])).problem).toBe("not-a-component");
  });

  it("refuses a source JSON could not write", () => {
    const unwritable = definitionWith() as unknown as Record<string, unknown>;
    unwritable.settings = { custom: 1n };

    expect(dup(unwritable as unknown as BlockDocument).problem).toBe(
      "unusable-document"
    );
  });

  it("refuses a source whose envelope COMPUTES itself", () => {
    // The reason the source is asked before anything reads it. Reading an
    // accessor gives a value, so nothing throws and the copy comes out plain —
    // meaning the duplicate would pass every later check while the row it came
    // from is one the store cannot write. Asking first refuses the broken
    // source instead of quietly minting a sound copy of it.
    const computed = definitionWith() as unknown as Record<string, unknown>;
    Object.defineProperty(computed, "exposed", {
      enumerable: true,
      get() {
        return [
          {
            id: "p1",
            label: "L",
            nodeId: "headline",
            propPath: "text",
            type: "text",
          },
        ];
      },
    });

    expect(dup(computed as unknown as BlockDocument).problem).toBe(
      "unusable-document"
    );
  });

  it("reports a source whose envelope was already broken", () => {
    // Asked of what is STORED, so a definition that was already dangling is
    // reported rather than silently duplicated into a second broken row.
    const broken = definitionWith({
      exposed: [
        {
          id: "p1",
          label: "L",
          nodeId: "gone",
          propPath: "text",
          type: "text",
        },
      ],
    });

    const plan = dup(broken);
    expect(plan.problem).toBe("invalid-exposure");
    expect(plan.issues?.map(i => i.code)).toContain("exposed-node-missing");
  });
});

describe("the rename record survives being restamped", () => {
  it("ROUND TRIP TWICE: a second save still stores the source's own ids", () => {
    // The gap in the round-trip test above, and it is the one that mattered:
    // that test never APPLIED the page ops and saved again. A save-over
    // restamps a stale root's provenance, and the restamp rewrote the whole
    // record — dropping the rename map, so the next save had nothing to restore
    // and put the page-specific suffix back into the pattern. The fix held for
    // one cycle and failed on the second.
    const authored = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
    ]);
    const stored = created(
      planSaveAsPattern(authored, ["t"], target, anyParent)
    ).document;

    const destination = page([node("existing", { cssId: "pricing" })]);
    const inserted = applyOps(
      destination,
      pageOps(
        planInsertPattern(
          destination,
          { id: "hero-pattern", document: stored },
          { index: 1 },
          anyParent
        )
      )
    ).document;
    const copyId = inserted.nodes[1]!.id;

    // EDIT the copy, so its digest differs and the save has to restamp it.
    const edited = applyOps(inserted, [
      {
        kind: "update",
        id: copyId,
        patch: { props: { mark: "target", edited: true } },
      },
    ]).document;

    const first = planUpdatePatternFromSelection(
      edited,
      [copyId],
      { collection: "patterns", id: "hero-pattern" },
      anyParent
    );
    expect(marked(first.update!.document.nodes, "target").cssId).toBe(
      "pricing"
    );

    // Apply what the plan asked for, then save the same copy AGAIN.
    const restamped = applyOps(edited, pageOps(first)).document;
    const second = planUpdatePatternFromSelection(
      restamped,
      [copyId],
      { collection: "patterns", id: "hero-pattern" },
      anyParent
    );

    expect(marked(second.update!.document.nodes, "target").cssId).toBe(
      "pricing"
    );
  });

  it("keeps the map on the record the restamp writes", () => {
    // Asserted on the record as well as through the round trip, because the
    // round trip would also pass if the map were recomputed by some other
    // route — and only the copy that renamed knows what it renamed.
    const authored = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
    ]);
    const stored = created(
      planSaveAsPattern(authored, ["t"], target, anyParent)
    ).document;
    const destination = page([node("existing", { cssId: "pricing" })]);
    const inserted = applyOps(
      destination,
      pageOps(
        planInsertPattern(
          destination,
          { id: "hero-pattern", document: stored },
          { index: 1 },
          anyParent
        )
      )
    ).document;
    const copyId = inserted.nodes[1]!.id;
    const renamedTo = marked(inserted.nodes, "target").cssId!;

    const edited = applyOps(inserted, [
      {
        kind: "update",
        id: copyId,
        patch: { props: { mark: "target", edited: true } },
      },
    ]).document;
    const restamped = applyOps(
      edited,
      pageOps(
        planUpdatePatternFromSelection(
          edited,
          [copyId],
          { collection: "patterns", id: "hero-pattern" },
          anyParent
        )
      )
    ).document;

    const origin = restamped.nodes[1]!.origin;
    expect(origin?.from === "pattern" ? origin.renamed : undefined).toEqual({
      pricing: renamedTo,
    });
  });
});

describe("a duplicate is refused what strict validation would refuse", () => {
  it("refuses a source spelling one DOM id on two nodes", () => {
    // The copy KEEPS DOM ids, so a source that already spelled one twice hands
    // the duplicate the same fault — and nothing else here sees it: the
    // envelope check reads pointers, the document refusal reads storability and
    // size. The pattern paths already ask this question.
    const doc = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes: [node("a", { cssId: "dup" }), node("b", { cssId: "dup" })],
    } as unknown as BlockDocument;

    expect(planDuplicateComponent(doc, componentTarget).problem).toBe(
      "duplicate-dom-id"
    );
  });

  it("does not read a kind that computes itself", () => {
    // `documentRefusal` refuses a document whose fields compute themselves, and
    // `kind` is one of them — so asking the kind FIRST ran the caller's accessor
    // and took a native error out of a function that promises a refusal.
    const computed: Record<string, unknown> = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      nodes: [],
    };
    Object.defineProperty(computed, "kind", {
      enumerable: true,
      get() {
        throw new Error("read me and find out");
      },
    });

    let threw: unknown;
    let result;
    try {
      result = planDuplicateComponent(
        computed as unknown as BlockDocument,
        componentTarget
      );
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeUndefined();
    expect(result?.problem).toBe("unusable-document");
  });
});

describe("a polluted prototype is not provenance", () => {
  it("does not treat an inherited origin as a record this page holds", () => {
    // An ordinary read walks the prototype chain. With `Object.prototype.origin`
    // polluted, every node on the page looked copied from somewhere — and this
    // planner emitted an update stamping that false provenance onto a root that
    // had none. Measured: one op where none is correct.
    //
    // The document validator answers this about OWN properties only, so an
    // ordinary read here also put the two roads back into disagreement, which is
    // the asymmetry these planners exist to close.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted.origin = { from: "pattern", id: "ghost", digest: "d" };
    try {
      const doc = page([node("a", { props: { mark: "plain" } })]);

      const plan = planUpdatePatternFromSelection(
        doc,
        ["a"],
        { collection: "patterns", id: "ghost" },
        anyParent
      );

      expect(pageOps(plan)).toEqual([]);
    } finally {
      delete polluted.origin;
    }
  });

  it("does not restore DOM ids from an inherited rename map", () => {
    // The same read, on the other consumer: a polluted record would hand the
    // save a map it never recorded and put back ids nobody renamed.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    polluted.origin = {
      from: "pattern",
      id: "ghost",
      digest: "d",
      renamed: { authored: "minted" },
    };
    try {
      const doc = page([node("a", { cssId: "minted", props: { mark: "t" } })]);

      const saved = created(
        planSaveAsPattern(doc, ["a"], target, anyParent)
      ).document;

      expect(marked(saved.nodes, "t").cssId).toBe("minted");
    } finally {
      delete polluted.origin;
    }
  });
});

describe("what an insert records stays proportional to the pattern", () => {
  it("records only the renames each root carried", () => {
    // The complete map on every root makes the stored document and the op group
    // grow with the SQUARE of the pattern's width. Measured before this: a
    // 40-root pattern landing beside a colliding copy carried 1600 entries
    // where 40 were meant, and a 250-root one produced an op group the default
    // document cap refuses outright — the feature breaking exactly the large
    // patterns it is most useful for.
    const roots = Array.from({ length: 40 }, (_, i) =>
      node(`r${String(i)}`, { cssId: `id${String(i)}` })
    );
    const stored = created(
      planSaveAsPattern(
        page(roots),
        roots.map(root => root.id),
        target,
        anyParent
      )
    ).document;

    const destination = page(
      roots.map((_, i) => node(`d${String(i)}`, { cssId: `id${String(i)}` }))
    );
    const placed = pageOps(
      planInsertPattern(
        destination,
        { id: "hero-pattern", document: stored },
        { index: 40 },
        anyParent
      )
    ).flatMap(op => (op.kind === "insert" ? [op.node] : []));

    expect(placed).toHaveLength(40);
    for (const one of placed) {
      const origin = one.origin;
      expect(
        Object.keys(
          (origin?.from === "pattern" ? origin.renamed : undefined) ?? {}
        )
      ).toHaveLength(1);
    }
  });

  it("still restores through a per-root map", () => {
    // The control for the narrowing: keeping only each root's own entries must
    // not cost the restore, which is what the whole record is for.
    const authored = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
    ]);
    const stored = created(
      planSaveAsPattern(authored, ["t"], target, anyParent)
    ).document;
    const destination = page([node("existing", { cssId: "pricing" })]);
    const inserted = applyOps(
      destination,
      pageOps(
        planInsertPattern(
          destination,
          { id: "hero-pattern", document: stored },
          { index: 1 },
          anyParent
        )
      )
    ).document;

    const saved = planUpdatePatternFromSelection(
      inserted,
      [inserted.nodes[1]!.id],
      { collection: "patterns", id: "hero-pattern" },
      anyParent
    );

    expect(marked(saved.update!.document.nodes, "target").cssId).toBe(
      "pricing"
    );
  });
});

describe("a duplicate is a row of its own", () => {
  it("shares no mutable envelope data with its source", () => {
    // The spread left `variants`, `assets`, `settings` and every nested
    // `options` array shared with the source, so editing the duplicate edited
    // the component it came from.
    const options = [{ value: "a", label: "A" }];
    const source = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes: [node("a")],
      exposed: [
        {
          id: "p1",
          label: "L",
          nodeId: "a",
          propPath: "t",
          type: "select" as const,
          options,
        },
      ],
      assets: { mediaIds: ["m1"] },
    } as unknown as BlockDocument;

    const copy = definition(
      planDuplicateComponent(source, componentTarget)
    ) as unknown as {
      exposed: { options: { label: string }[] }[];
      assets: { mediaIds: string[] };
    };

    copy.exposed[0]!.options[0]!.label = "MUTATED";
    copy.assets.mediaIds.push("m2");

    expect(options[0]!.label).toBe("A");
    expect(
      (source as unknown as { assets: { mediaIds: string[] } }).assets.mediaIds
    ).toHaveLength(1);
  });

  it("blames the SIZE, not a sound exposure, when the forest is over the cap", () => {
    // The envelope check resolves every exposure pointer against an index it
    // builds under `maxNodes`, so a forest past that bound is indexed only as
    // far as the bound reaches. A pointer at anything beyond it then comes back
    // as `exposed-node-missing` — a node the document really contains, called
    // dangling. That verdict sends an author to delete or repair an exposure
    // that was never wrong, while the one thing they could act on, the size,
    // goes unmentioned. Only DEPTH and COUNT can truncate the index, so only
    // those are settled before one is built.
    const source = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes: [node("n1"), node("n2"), node("n3")],
      exposed: [
        {
          id: "x1",
          label: "Text",
          nodeId: "n3",
          propPath: "text",
          type: "text" as const,
        },
      ],
    } as unknown as BlockDocument;

    const plan = planDuplicateComponent(source, componentTarget, {
      ...DEFAULT_LIMITS,
      maxNodes: 2,
    });

    expect(plan.problem).toBe("exceeds-limits");
    // And no issue list at all, so the sound pointer is never blamed.
    expect(plan.issues).toBeUndefined();
  });

  it("refuses a source whose node breaks the node contract", () => {
    // `forestRefusal` establishes that the forest holds plain serializable
    // records, not that each is a node this engine would carry. A legacy
    // `type: "box"` survives it, and the copy then reports success for a
    // definition strict validation refuses.
    const legacy = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component" as const,
      nodes: [{ id: "a", type: "box", version: 1, props: {} }],
    } as unknown as BlockDocument;

    expect(planDuplicateComponent(legacy, componentTarget).problem).toBe(
      "invalid-node"
    );
  });
});

describe("the anchors a conversion leaves behind", () => {
  /** A link whose target is a fragment, which is where an anchor is named. */
  function link(id: string, href: string): BlockNode {
    return node(id, { type: "core/link", props: { href } });
  }

  function warnings<T>(plan: PlanResult<T>): readonly PlanWarning[] {
    if (plan.warnings === undefined) {
      throw new Error(`no plan: ${String(plan.problem)}`);
    }
    return plan.warnings;
  }

  it("warns when a link still on the page names an id the run takes away", () => {
    // Composition scopes a definition-authored id per instance — it has to,
    // because two instances cannot both answer to one `id` — so the anchor
    // stops resolving. A warning and not a refusal: nothing here is invalid,
    // and the author may want the component anyway.
    const doc = page([
      link("nav", "#pricing"),
      node("run", { cssId: "pricing" }),
    ]);

    const plan = planConvertToComponent(
      doc,
      ["run"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    expect(plan.problem).toBeUndefined();
    expect(warnings(plan)).toEqual([
      { kind: "orphaned-anchor", domId: "pricing", referencingRoots: ["nav"] },
    ]);
  });

  it("says nothing about a link INSIDE the run", () => {
    // Both halves move into the definition together and the relink pass
    // rewrites the reference, so this one keeps working. Reporting it would
    // train an author to ignore the warning that matters.
    const doc = page([
      node(
        "run",
        {},
        {
          children: [
            link("nav", "#pricing"),
            node("hero", { cssId: "pricing" }),
          ],
        }
      ),
      node("after"),
    ]);

    const plan = planConvertToComponent(
      doc,
      ["run"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    expect(warnings(plan)).toEqual([]);
  });

  it("still warns when the id is named from inside AND outside", () => {
    // The case that decides how this is computed. Subtracting what the run
    // references from what the document references reports nothing here, and
    // the OUTSIDE link is broken exactly as it is in the first test — so the
    // run is removed and what remains is what gets asked.
    const doc = page([
      link("outside", "#pricing"),
      node(
        "run",
        { cssId: "pricing" },
        { children: [link("inside", "#pricing")] }
      ),
    ]);

    const plan = planConvertToComponent(
      doc,
      ["run"],
      componentTarget,
      "def-1",
      {},
      anyParent
    );

    expect(warnings(plan)).toEqual([
      {
        kind: "orphaned-anchor",
        domId: "pricing",
        referencingRoots: ["outside"],
      },
    ]);
  });

  it("reads an id off the attribute bag as readily as off cssId", () => {
    // `renderedDomId` is the one rule for which of the two a node emits, and
    // this asks the question through it rather than through a second reading
    // that would know about only one of them.
    const doc = page([
      link("nav", "#pricing"),
      node("run", { attributes: { id: "pricing" } }),
    ]);

    expect(
      warnings(
        planConvertToComponent(
          doc,
          ["run"],
          componentTarget,
          "def-1",
          {},
          anyParent
        )
      ).map(warning => warning.domId)
    ).toEqual(["pricing"]);
  });

  it("finds a reference through an ARIA relationship, not only a fragment", () => {
    const doc = page([
      node("label", { attributes: { "aria-controls": "pricing" } }),
      node("run", { cssId: "pricing" }),
    ]);

    expect(
      warnings(
        planConvertToComponent(
          doc,
          ["run"],
          componentTarget,
          "def-1",
          {},
          anyParent
        )
      ).map(warning => warning.domId)
    ).toEqual(["pricing"]);
  });

  it("says nothing when the id the run carries is not named anywhere", () => {
    const doc = page([
      link("nav", "#elsewhere"),
      node("run", { cssId: "pricing" }),
    ]);

    expect(
      warnings(
        planConvertToComponent(
          doc,
          ["run"],
          componentTarget,
          "def-1",
          {},
          anyParent
        )
      )
    ).toEqual([]);
  });

  it("says nothing when the run renders no id at all", () => {
    const doc = page([link("nav", "#pricing"), node("run")]);

    expect(
      warnings(
        planConvertToComponent(
          doc,
          ["run"],
          componentTarget,
          "def-1",
          {},
          anyParent
        )
      )
    ).toEqual([]);
  });

  it("carries an empty list from a planner that moves nothing off the page", () => {
    // Saving to the library COPIES, so nothing stops being addressable. The
    // field is present and empty rather than absent, so a surface reading it
    // has one value to handle instead of two.
    const doc = page([
      link("nav", "#pricing"),
      node("run", { cssId: "pricing" }),
    ]);

    expect(planSaveAsPattern(doc, ["run"], target, anyParent).warnings).toEqual(
      []
    );
  });
});

/**
 * A node carrying provenance the type does not admit.
 *
 * Stored documents reach a planner from a database, so a record whose
 * `renamed` is `null` is a value the runtime really can be handed and the type
 * really cannot describe. Asserted once, here, rather than at each fixture, so
 * the places doing it are countable.
 */
function withStoredOrigin(node: BlockNode, origin: unknown): BlockNode {
  return { ...node, origin } as unknown as BlockNode;
}

describe("a saved DESCENDANT of an inserted root", () => {
  /** A pattern whose renamed id sits on a CHILD, two levels under the root. */
  function nestedPattern(): BlockDocument {
    const authored = page([
      node(
        "wrap",
        { props: { mark: "wrap" } },
        {
          children: [
            node(
              "mid",
              { props: { mark: "mid" } },
              {
                children: [
                  node("t", { cssId: "pricing", props: { mark: "target" } }),
                ],
              }
            ),
          ],
        }
      ),
    ]);
    return created(planSaveAsPattern(authored, ["wrap"], target, anyParent))
      .document;
  }

  /** Insert it into a page that already holds `pricing`, forcing a rename. */
  function placedIn(stored: BlockDocument): BlockDocument {
    const destination = page([node("existing", { cssId: "pricing" })]);
    const insert = planInsertPattern(
      destination,
      { id: "hero-pattern", document: stored },
      { index: 1 },
      anyParent
    );
    return applyOps(destination, pageOps(insert)).document;
  }

  it("stores the SOURCE id, not the suffixed one the page gave it", () => {
    // The record is stamped on inserted ROOTS only — a descendant did not
    // arrive from the pattern separately. Read from the node's own record
    // alone, a descendant restored nothing and the page-specific id went into
    // the new pattern, where the next insert would suffix it again.
    const after = placedIn(nestedPattern());
    const renamed = marked([...after.nodes], "target");
    expect(renamed.cssId).not.toBe("pricing");
    expect(renamed.cssId).toContain("pricing");

    const saved = created(
      planSaveAsPattern(after, [renamed.id], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("carries the record down more than one level", () => {
    // `mid` sits between the root that holds the record and the node that
    // holds the id, so a scope that reached only a direct child would restore
    // nothing here while passing the case above.
    const after = placedIn(nestedPattern());
    const mid = marked([...after.nodes], "mid");

    const saved = created(
      planSaveAsPattern(after, [mid.id], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("lets a nested insert's own record win inside its own subtree", () => {
    // A node carrying a record uses it INSTEAD of the one it sits inside, so a
    // pattern inserted within a pattern restores against the pattern it
    // actually came from.
    const outer = placedIn(nestedPattern());
    const mid = marked([...outer.nodes], "mid");
    const inner = planInsertPattern(
      outer,
      { id: "inner-pattern", document: nestedPattern() },
      { parentId: mid.id, slot: "children", index: 0 },
      anyParent
    );
    const after = applyOps(outer, pageOps(inner)).document;

    // Two nodes now answer to "target": the outer one and the inner copy. The
    // inner root is the one carrying the inner record.
    const innerRoot = pageOps(inner).flatMap(op =>
      op.kind === "insert" ? [op.node] : []
    )[0];
    const innerOnPage = findNode([...after.nodes], innerRoot?.id ?? "");
    const innerTarget = marked(
      innerOnPage === undefined ? [] : [innerOnPage],
      "target"
    );

    const saved = created(
      planSaveAsPattern(after, [innerTarget.id], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("does not restore a node against its PARENT's namesake", () => {
    // A document reaching a planner is untrusted and may spell one node id
    // twice, so a scope keyed by id answers for whichever namesake the walk
    // reached first. Here `wrap` names two different containers and only one
    // was inserted from a pattern; the selected node sits under the OTHER, so
    // it has nothing to restore against — while an id-keyed scope hands it the
    // first `wrap`'s record and writes an id the author never wrote.
    const doc = page([
      node(
        "wrap",
        {
          origin: {
            from: "pattern",
            id: "hero-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        { children: [node("x", { props: { mark: "inserted" } })] }
      ),
      node(
        "wrap",
        {},
        {
          children: [
            node("y", { cssId: "pricing-1", props: { mark: "authored" } }),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["y"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "authored").cssId).toBe("pricing-1");
  });

  it("stops at a nested pattern that renamed NOTHING", () => {
    // A collision is the exception, so `insertOrigin` writes no `renamed` at
    // all for the ordinary insert — and a boundary derived from the map being
    // non-empty therefore is not one. The inner pattern authored `pricing-1`
    // itself; inheriting the host's map rewrites it to the HOST pattern's
    // spelling and stores content the inner pattern never had.
    const doc = page([
      node(
        "outer",
        {
          origin: {
            from: "pattern",
            id: "outer-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node(
              "inner",
              {
                origin: { from: "pattern", id: "inner-pattern", digest: "d2" },
              } as Partial<BlockNode>,
              {
                children: [
                  node("t", { cssId: "pricing-1", props: { mark: "target" } }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("saves past a sibling whose provenance is malformed", () => {
    // The walk reaches the WHOLE document now, so a record nothing selected
    // still gets read — and a stored `renamed` holding null took the planner
    // out as a native TypeError, refusing a valid save because of metadata on
    // an unrelated node. A planner answers with a plan or a refusal.
    const doc = page([
      withStoredOrigin(node("sibling"), {
        from: "pattern",
        id: "p",
        digest: "d",
        renamed: null,
      }),
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("declines to restore a node that occurs in two places", () => {
    // One node OBJECT under two parents. A selection names objects rather than
    // places, so nothing can say which occurrence was meant — and restoring
    // against the recorded one rewrites an id under a parent that never came
    // from a pattern. Declining keeps every id, which is what a node with no
    // record in scope gets anyway.
    const shared = node("shared", {
      cssId: "pricing-1",
      props: { mark: "target" },
    });
    const doc = page([
      node(
        "recorded",
        {
          origin: {
            from: "pattern",
            id: "hero-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        { children: [shared] }
      ),
      node("plain", {}, { children: [shared] }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["shared"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("restores a pattern nested INSIDE the selection, not only the roots'", () => {
    // A run inserted from one pattern can hold a second pattern inserted into
    // it later, with a rename map of its own. Reading only the selected roots'
    // records stores that nested copy's page-specific id — the growth the
    // restore exists to stop, left running for one subtree — while the outer
    // half looks correct, which is why selecting the inner node alone does not
    // catch it.
    const doc = page([
      node(
        "outer",
        {
          origin: {
            from: "pattern",
            id: "outer-pattern",
            digest: "d",
            renamed: { hero: "hero-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node("a", { cssId: "hero-1", props: { mark: "outerTarget" } }),
            node(
              "inner",
              {
                origin: {
                  from: "pattern",
                  id: "inner-pattern",
                  digest: "d2",
                  renamed: { pricing: "pricing-1" },
                },
              } as Partial<BlockNode>,
              {
                children: [
                  node("b", {
                    cssId: "pricing-1",
                    props: { mark: "innerTarget" },
                  }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "outerTarget").cssId).toBe("hero");
    expect(marked([...saved.nodes], "innerTarget").cssId).toBe("pricing");
  });

  it("lets the INNERMOST record decide an id two of them name", () => {
    // Reachable rather than hypothetical: an outer record keeps naming an id
    // whose node has since been deleted, and a pattern inserted afterwards
    // mints the same suffixed name for a node of its own. One node holds it,
    // and the record that actually renamed THAT node is the inner one.
    const doc = page([
      node(
        "outer",
        {
          origin: {
            from: "pattern",
            id: "outer-pattern",
            digest: "d",
            renamed: { alpha: "shared-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node(
              "inner",
              {
                origin: {
                  from: "pattern",
                  id: "inner-pattern",
                  digest: "d2",
                  renamed: { beta: "shared-1" },
                },
              } as Partial<BlockNode>,
              {
                children: [
                  node("t", { cssId: "shared-1", props: { mark: "target" } }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("beta");
  });

  it("leaves a node that was MOVED out of the run that renamed it", () => {
    // The record describes a rename that happened somewhere this node no longer
    // is. Its ancestry holds no record, so the id is the author's now, and
    // putting it back rewrites one they own — while the record is still in the
    // selection, on the sibling it was stamped on.
    const doc = page([
      node(
        "outer",
        {},
        {
          children: [
            node(
              "inserted",
              {
                origin: {
                  from: "pattern",
                  id: "hero-pattern",
                  digest: "d",
                  renamed: { pricing: "pricing-1" },
                },
              } as Partial<BlockNode>,
              { children: [node("stayed", { props: { mark: "stayed" } })] }
            ),
            node("moved", { cssId: "pricing-1", props: { mark: "moved" } }),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "moved").cssId).toBe("pricing-1");
  });

  it("refuses a record the document validator would not accept", () => {
    // `isBlockOrigin` is the one answer to whether a stored record is whole,
    // and it refuses an origin missing its id or its digest. A weaker reading
    // here — the discriminant alone — accepted one and drove a restore off it,
    // which is the planner and the validator disagreeing about the same record.
    const doc = page([
      withStoredOrigin(node("root"), {
        from: "pattern",
        id: "",
        digest: "",
        renamed: { pricing: "pricing-1" },
      }),
    ]);
    const withChild = page([
      {
        ...doc.nodes[0]!,
        slots: {
          children: [
            node("t", { cssId: "pricing-1", props: { mark: "target" } }),
          ],
        },
      },
    ]);

    const saved = created(
      planSaveAsPattern(withChild, ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("leaves a REFERENCE held by a node moved out of the run", () => {
    // Nothing in the selection renders the id, so the record can only be about
    // a reference — but a node moved out of the run keeps its reference too,
    // and rewriting that points it somewhere the saved forest never had. The
    // reference has to be held by a node the record governs.
    const doc = page([
      node(
        "outer",
        {},
        {
          children: [
            node(
              "inserted",
              {
                origin: {
                  from: "pattern",
                  id: "hero-pattern",
                  digest: "d",
                  renamed: { pricing: "pricing-1" },
                },
              } as Partial<BlockNode>,
              { children: [node("stayed")] }
            ),
            node("moved", {
              attributes: { "aria-describedby": "pricing-1" },
              props: { mark: "moved" },
            }),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(
      marked([...saved.nodes], "moved").attributes?.["aria-describedby"]
    ).toBe("pricing-1");
  });

  it("stops at a COMPONENT record, not only a pattern's", () => {
    // A component detached inside an inserted pattern carries independent
    // provenance: its subtree did not come from the host pattern, so the host's
    // renames are not about it. Only a pattern record carries a map, so every
    // other kind stops inheritance with an empty one.
    const doc = page([
      node(
        "inserted",
        {
          origin: {
            from: "pattern",
            id: "hero-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node(
              "detached",
              {
                origin: { from: "component", id: "def-1" },
              } as Partial<BlockNode>,
              {
                children: [
                  node("t", { cssId: "pricing-1", props: { mark: "target" } }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["inserted"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("gives one node object the SAME scope on both of its visits", () => {
    // The walk compares scopes by identity to notice that two occurrences of a
    // node disagree. A record rebuilt on each visit reads as a disagreement
    // with itself, and every descendant of it is then downgraded to no scope —
    // so the id the record exists to put back is stored as the page spells it.
    const recorded = node(
      "recorded",
      {
        origin: {
          from: "pattern",
          id: "hero-pattern",
          digest: "d",
          renamed: { pricing: "pricing-1" },
        },
      } as Partial<BlockNode>,
      {
        children: [
          node("t", { cssId: "pricing-1", props: { mark: "target" } }),
        ],
      }
    );
    const doc = page([
      node("one", {}, { children: [recorded] }),
      node("two", {}, { children: [recorded] }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("saves past a sibling that refuses to say what it holds", () => {
    // The walk reaches every node now, so reflection on an unselected one runs
    // its traps. A node that will not answer holds nothing this can act on —
    // and a planner answers with a plan or a refusal, never a native error.
    const hostile = new Proxy(node("hostile"), {
      getOwnPropertyDescriptor(node_, key) {
        if (key === "origin") throw new Error("the record is not for reading");
        return Reflect.getOwnPropertyDescriptor(node_, key);
      },
    });
    const doc = page([
      hostile as BlockNode,
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("does not admit an outer rename for a NESTED scope's own reference", () => {
    // The inner pattern authored this reference itself. The outer record is
    // about the run the outer root was copied as, which the inner pattern is
    // not part of — so a scan that descended through the boundary would rewrite
    // a reference its own author wrote.
    const doc = page([
      node(
        "outer",
        {
          origin: {
            from: "pattern",
            id: "outer-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node(
              "inner",
              {
                origin: { from: "pattern", id: "inner-pattern", digest: "d2" },
              } as Partial<BlockNode>,
              {
                children: [
                  node("ref", {
                    attributes: { "aria-describedby": "pricing-1" },
                    props: { mark: "ref" },
                  }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(
      marked([...saved.nodes], "ref").attributes?.["aria-describedby"]
    ).toBe("pricing-1");
  });

  it("saves past an origin whose own reads throw", () => {
    // `isBlockOrigin` establishes the record is whole through descriptors, and
    // an ordinary read of a field afterwards runs the `get` trap that check
    // just avoided — validating defensively and then reading naively is the
    // same crash one line later.
    const origin = new Proxy(
      { from: "pattern", id: "p", digest: "d" },
      {
        get() {
          throw new Error("the record is not for reading");
        },
      }
    );
    const doc = page([
      withStoredOrigin(node("hostile"), origin),
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("refuses a selection holding provenance it cannot trust", () => {
    // The reachable answer for an untrusted record INSIDE a selection: the
    // shape rule refuses the save outright, so no scope decision is ever taken
    // on one. The boundary treats a claimed record as a boundary whatever it
    // says, which is what keeps that from depending on this ordering.
    const doc = page([
      node(
        "outer",
        {
          origin: {
            from: "pattern",
            id: "outer-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            {
              ...withStoredOrigin(node("odd"), {
                from: "elsewhere",
                id: "x",
                digest: "d",
              }),
              slots: {
                children: [node("t", { cssId: "pricing-1" })],
              },
            },
          ],
        }
      ),
    ]);

    expect(planSaveAsPattern(doc, ["outer"], target, anyParent).problem).toBe(
      "invalid-node"
    );
  });

  it("costs no more for a thousand departed ids than for one", () => {
    // A stored pattern accumulates rename entries whose targets were later
    // removed. Asking about them one at a time rebuilt the governed region per
    // entry — quadratic in entries times nodes, on a save with nothing wrong
    // with it.
    //
    // A RATIO between two saves in the same run, not a wall-clock ceiling: a
    // ceiling measures whichever machine happens to be running the suite, and
    // this has to fail on the shape. Both saves walk the same forest and differ
    // only in how many entries the record carries, so the linear form answers
    // in about the same time for both and the per-entry form does not.
    function timeSave(entries: number): number {
      const renamed: Record<string, string> = {};
      for (let index = 0; index < entries; index += 1) {
        renamed[`was-${index}`] = `now-${index}`;
      }
      const children: BlockNode[] = [];
      for (let index = 0; index < 2_000; index += 1) {
        children.push(node(`k${index}`));
      }
      const doc = page([
        node(
          "root",
          {
            origin: { from: "pattern", id: "p", digest: "d", renamed },
          } as Partial<BlockNode>,
          { children }
        ),
      ]);

      const started = performance.now();
      const plan = planSaveAsPattern(doc, ["root"], target, anyParent);
      const elapsed = performance.now() - started;
      expect(plan.problem).toBeUndefined();
      return elapsed;
    }

    const one = timeSave(1);
    const many = timeSave(2_000);

    // Measured on this fixture: the one-pass form takes about the same for
    // both, the per-entry form roughly forty times longer for the second. The
    // constant absorbs a fast machine, where both readings are small enough
    // that scheduling noise dominates the ratio.
    expect(many).toBeLessThan(one * 10 + 200);
  });

  it("leaves an id two records disagree about", () => {
    // Each record holds a reference to one current id and calls it something
    // different. A single restore map has room for one answer, so applying
    // either rewrites the other scope's reference to a name it never had —
    // measured, both came back as `beta`.
    //
    // Nothing renders the id, so both references already point outside the
    // saved forest; leaving them is the only answer that corrupts neither.
    const doc = page([
      node(
        "outer",
        {},
        {
          children: [
            node(
              "a",
              {
                origin: {
                  from: "pattern",
                  id: "pattern-a",
                  digest: "d",
                  renamed: { alpha: "shared-1" },
                },
              } as Partial<BlockNode>,
              {
                children: [
                  node("refA", {
                    attributes: { "aria-describedby": "shared-1" },
                    props: { mark: "refA" },
                  }),
                ],
              }
            ),
            node(
              "b",
              {
                origin: {
                  from: "pattern",
                  id: "pattern-b",
                  digest: "d",
                  renamed: { beta: "shared-1" },
                },
              } as Partial<BlockNode>,
              {
                children: [
                  node("refB", {
                    attributes: { "aria-describedby": "shared-1" },
                    props: { mark: "refB" },
                  }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(
      marked([...saved.nodes], "refA").attributes?.["aria-describedby"]
    ).toBe("shared-1");
    expect(
      marked([...saved.nodes], "refB").attributes?.["aria-describedby"]
    ).toBe("shared-1");
  });

  it("restores an id two records AGREE about", () => {
    // One insert stamps its rename map onto every root that references the
    // renamed id, so saving two of those roots brings two records saying the
    // same thing. Discarding on the count alone would store the page-specific
    // id for a run whose records agree about it perfectly.
    const record = {
      from: "pattern",
      id: "hero-pattern",
      digest: "d",
      renamed: { hero: "hero-1" },
    };
    const doc = page([
      node("linkA", {
        origin: record,
        attributes: { "aria-describedby": "hero-1" },
        props: { mark: "linkA" },
      } as Partial<BlockNode>),
      node("linkB", {
        origin: record,
        attributes: { "aria-describedby": "hero-1" },
        props: { mark: "linkB" },
      } as Partial<BlockNode>),
      node("elsewhere", { cssId: "hero-1" }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["linkA", "linkB"], target, anyParent)
    ).document;

    expect(
      marked([...saved.nodes], "linkA").attributes?.["aria-describedby"]
    ).toBe("hero");
    expect(
      marked([...saved.nodes], "linkB").attributes?.["aria-describedby"]
    ).toBe("hero");
  });

  it("saves past a rename ENTRY that refuses to be read", () => {
    // A validated record can still be a Proxy whose indexed reads throw, and
    // an ordinary `renamed[was]` runs exactly the trap the validation avoided.
    const renamed = new Proxy(
      { pricing: "pricing-1" },
      {
        get(store, key) {
          if (typeof key === "string" && key !== "constructor") {
            throw new Error("the entry is not for reading");
          }
          return Reflect.get(store, key);
        },
      }
    );
    const doc = page([
      withStoredOrigin(node("sibling"), {
        from: "pattern",
        id: "p",
        digest: "d",
        renamed,
      }),
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("saves past a sibling whose slots refuse to be read", () => {
    // The scope walk reaches every node, and the shared walk descends by
    // reading `slots` — so a node that will not answer took a valid save out.
    const hostile = {} as BlockNode;
    Object.defineProperties(hostile, {
      id: { value: "hostile", enumerable: true },
      type: { value: "core/box", enumerable: true },
      version: { value: 1, enumerable: true },
      props: { value: {}, enumerable: true },
      slots: {
        get() {
          throw new Error("the slots are not for reading");
        },
        enumerable: true,
        configurable: true,
      },
    });
    const doc = page([
      hostile,
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("leaves an id an unrelated subtree also references", () => {
    // One record governs a reference to it, and a subtree with provenance of
    // its own authored a reference to the same id. The restore carries a single
    // map for the whole forest, so putting the governed one back rewrites the
    // unrelated author's reference too — one legitimate hit is not licence for
    // that, so neither moves.
    const doc = page([
      node(
        "outer",
        {},
        {
          children: [
            node("governed", {
              origin: {
                from: "pattern",
                id: "hero-pattern",
                digest: "d",
                renamed: { pricing: "pricing-1" },
              },
              attributes: { "aria-describedby": "pricing-1" },
              props: { mark: "governed" },
            } as Partial<BlockNode>),
            node(
              "unrelated",
              {
                origin: { from: "component", id: "def-1" },
              } as Partial<BlockNode>,
              {
                children: [
                  node("theirs", {
                    attributes: { "aria-describedby": "pricing-1" },
                    props: { mark: "theirs" },
                  }),
                ],
              }
            ),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["outer"], target, anyParent)
    ).document;

    expect(
      marked([...saved.nodes], "theirs").attributes?.["aria-describedby"]
    ).toBe("pricing-1");
    expect(
      marked([...saved.nodes], "governed").attributes?.["aria-describedby"]
    ).toBe("pricing-1");
  });

  it("ignores a record storage would not keep", () => {
    // A non-enumerable `origin` survives in memory and nowhere else: JSON, an
    // object spread and `structuredClone` all drop it. Restoring an id from one
    // puts a name back on the strength of metadata the saved document will not
    // carry.
    const ancestor = node(
      "ancestor",
      {},
      {
        children: [
          node("t", { cssId: "pricing-1", props: { mark: "target" } }),
        ],
      }
    );
    Object.defineProperty(ancestor, "origin", {
      value: {
        from: "pattern",
        id: "hero-pattern",
        digest: "d",
        renamed: { pricing: "pricing-1" },
      },
      enumerable: false,
      configurable: true,
    });

    const saved = created(
      planSaveAsPattern(page([ancestor]), ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("saves past a slot record that refuses to be enumerated", () => {
    // The property read is one trap and listing the record's values is another.
    // Containing only the first leaves the second to take down whatever asked
    // for the walk.
    const slots = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("the slots are not for listing");
        },
      }
    );
    const hostile = {
      id: "hostile",
      type: "core/box",
      version: 1,
      props: {},
      slots,
    } as unknown as BlockNode;
    const doc = page([
      hostile,
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });

  it("counts a GATED node as a holder, whichever order it is walked in", () => {
    // `duplicateDomIdRefusal` only refuses two nodes that RENDER one id, and a
    // condition-gated node renders nothing — so a second holder is permitted
    // and the record has to account for it. Reading only the first made the
    // saved content depend on walk order.
    const gated = (): BlockNode =>
      node("hid", {
        cssId: "pricing-1",
        props: { mark: "hid" },
        visibility: {
          conditions: [[{ field: "tier", op: "eq", value: "pro" }]],
        },
      } as Partial<BlockNode>);
    const governed = (): BlockNode =>
      node(
        "root",
        {
          origin: {
            from: "pattern",
            id: "hero-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        {
          children: [
            node("vis", { cssId: "pricing-1", props: { mark: "vis" } }),
          ],
        }
      );
    const theirs = (): BlockNode =>
      node(
        "theirs",
        { origin: { from: "component", id: "def-1" } } as Partial<BlockNode>,
        { children: [gated()] }
      );

    for (const children of [
      [governed(), theirs()],
      [theirs(), governed()],
    ]) {
      const saved = created(
        planSaveAsPattern(
          page([node("outer", {}, { children })]),
          ["outer"],
          target,
          anyParent
        )
      ).document;

      // Neither moves: the two holders sit under different records and
      // disagree, and the answer is the same whichever was reached first.
      expect(marked([...saved.nodes], "vis").cssId).toBe("pricing-1");
      expect(marked([...saved.nodes], "hid").cssId).toBe("pricing-1");
    }
  });

  it("reads an own `origin: undefined` as no record at all", () => {
    // The field is optional and JSON omits it, so an own property holding
    // `undefined` is how "no origin" is spelled in memory. Treating it as a
    // boundary stopped an ancestor's rename reaching a node that never
    // announced anything.
    const middle = node(
      "mid",
      {},
      {
        children: [
          node("t", { cssId: "pricing-1", props: { mark: "target" } }),
        ],
      }
    );
    Object.defineProperty(middle, "origin", {
      value: undefined,
      enumerable: true,
      configurable: true,
    });
    const doc = page([
      node(
        "root",
        {
          origin: {
            from: "pattern",
            id: "hero-pattern",
            digest: "d",
            renamed: { pricing: "pricing-1" },
          },
        } as Partial<BlockNode>,
        { children: [middle] }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("restores a repeated node whose two parents say the same thing", () => {
    // One insert copies its record onto each root it placed, so a node reached
    // under two of them is told the same thing twice rather than told two
    // things. There is no placement ambiguity to decline.
    const record = () => ({
      from: "pattern",
      id: "hero-pattern",
      digest: "d",
      renamed: { pricing: "pricing-1" },
    });
    const shared = node("shared", {
      cssId: "pricing-1",
      props: { mark: "target" },
    });
    const doc = page([
      node("r1", { origin: record() } as Partial<BlockNode>, {
        children: [shared],
      }),
      node("r2", { origin: record() } as Partial<BlockNode>, {
        children: [shared],
      }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["shared"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });

  it("keeps every id when no ancestor was ever inserted from a pattern", () => {
    // The control for all three above: without a record in scope there is
    // nothing to put back, and an authored id is the author's to keep.
    const authored = page([
      node(
        "wrap",
        {},
        {
          children: [
            node("t", { cssId: "pricing", props: { mark: "target" } }),
          ],
        }
      ),
    ]);

    const saved = created(
      planSaveAsPattern(authored, ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing");
  });
});

describe("a document whose branches share one object", () => {
  /**
   * A chain of DISTINCT objects where each holds the next TWICE.
   *
   * Compact on disk and enormous to walk: the shared walk counts a node object
   * in two slots as two elements — deliberately, since counting it once reports
   * half a real size — so `depth` objects expand to 2^depth entries.
   */
  function sharedChain(depth: number): BlockNode {
    let built = node("leaf");
    for (let i = 0; i < depth; i += 1) {
      built = node(`n${String(i)}`, {}, { a: [built], b: [built] });
    }
    return built;
  }

  function pageWith(depth: number): BlockDocument {
    return page([
      node("mine", { props: { mark: "target" } }),
      sharedChain(depth),
    ]);
  }

  /**
   * A DAG whose nodes COUNT how many times the walk asked them for children,
   * and stop answering once the count passes `stopAfter`.
   *
   * The tripwire is what makes this test safe to keep. A regression here is an
   * unbounded walk over 2^30 entries, and vitest's per-test timeout cannot
   * interrupt synchronous JavaScript — `format-boundary.test.ts` documents the
   * same limitation for the same reason — so a test that merely waited would
   * hang the worker for hours where it should report in milliseconds. Past the
   * cap these nodes report no children, the walk unwinds, and the count is the
   * evidence.
   */
  function counted(
    depth: number,
    stopAfter: number
  ): { root: BlockNode; reads: () => number } {
    let reads = 0;
    const watch = (node: BlockNode): BlockNode =>
      new Proxy(node, {
        get(held, key, receiver) {
          if (key !== "slots") return Reflect.get(held, key, receiver);
          reads += 1;
          // Past the bound the node has nothing to offer, which ends the walk
          // rather than letting it run to the end of an exponential document.
          if (reads > stopAfter) return undefined;
          return Reflect.get(held, key, receiver);
        },
      }) as BlockNode;

    let built = watch(node("leaf"));
    for (let i = 0; i < depth; i += 1) {
      built = watch(node(`n${String(i)}`, {}, { a: [built], b: [built] }));
    }
    return { root: built, reads: () => reads };
  }

  /** One save against a counted DAG of this depth. */
  function scanOf(depth: number): { problem: unknown; reads: number } {
    const cap = DEFAULT_LIMITS.maxNodes;
    const { root, reads } = counted(depth, cap);
    const doc = page([node("mine", { props: { mark: "target" } }), root]);
    const plan = planSaveAsPattern(doc, ["mine"], target, anyParent);
    return { problem: plan.problem, reads: reads() };
  }

  it("reads no more of the document than the cap allows, at any depth", () => {
    // The selection is one unrelated top-level node, found immediately; what
    // has to be bounded is the scan that goes looking for the scope it sits in.
    //
    // Asserted as a COUNT rather than as elapsed time. The bound made the old
    // timing comparison meaningless — once both depths stop at the cap they do
    // identical sub-millisecond work, so a ratio between them reported
    // scheduler noise and went red on CI at 9.32 against a threshold of 8.
    // What the bound actually promises is a number, and this is that number.
    const cap = DEFAULT_LIMITS.maxNodes;
    const shallow = scanOf(12);
    const deep = scanOf(30);

    expect(deep.problem).toBe("exceeds-limits");
    // The counter OBSERVED the walk. Without this the test is satisfied by a
    // probe that never counts: a mistyped key leaves both scans at zero, and
    // `0 <= cap` and the equality below both hold while `problem` keeps coming
    // from the production cap. The suite would then accept a dead tripwire —
    // and the tripwire is what stops a later loss of the bound from hanging
    // this test for hours instead of failing it. Measured: with this assertion
    // removed, a mistyped key in the probe failed nothing at all.
    expect(deep.reads).toBeGreaterThan(cap / 2);
    expect(deep.reads).toBeLessThanOrEqual(cap);
    // INDEPENDENT of depth, which is the whole property. Eighteen more levels
    // is 2^18 times the document and must be the same amount of reading.
    expect(deep.reads).toBe(shallow.reads);
  });

  it("refuses a NaN cap before walking, not after", () => {
    // `NaN + 1` is `NaN`, and every `read >= NaN` is false — so a caller's bad
    // configuration REMOVES the budget rather than exceeding it, and the walk
    // this bound exists to stop runs in full before anything rejects the
    // configuration. The published limit rule already refuses that.
    //
    // ZERO reads is the assertion, and it is what `toThrow` could not give.
    // The component planner rejects this configuration later anyway, so a throw
    // says nothing about WHEN — it is equally true of a run that walked the
    // whole document first. A count of zero says the document was never
    // touched.
    const cap = DEFAULT_LIMITS.maxNodes;
    const { root, reads } = counted(30, cap);
    const doc = page([node("mine", { props: { mark: "target" } }), root]);

    // The CONTROL, and this test needs one more than most: zero reads is the
    // answer being asserted, so a probe that never counts gives it for free.
    // A valid save over the same document proves the counter observes this
    // walk before the count of zero is allowed to mean anything.
    planSaveAsPattern(doc, ["mine"], target, anyParent);
    expect(reads()).toBeGreaterThan(0);
    const before = reads();

    expect(() =>
      planSaveAsComponent(
        doc,
        ["mine"],
        componentTarget,
        { properties: [] },
        anyParent,
        { ...DEFAULT_LIMITS, maxNodes: Number.NaN }
      )
    ).toThrow(RangeError);
    // NOTHING was added by the refused call — the document was never touched.
    expect(reads()).toBe(before);
  });

  it("still plans when the sharing is somewhere the save is not", () => {
    // The control, and it has to put the sharing OUTSIDE the run: a shared
    // object inside the selection is one id on two nodes, which the shape rule
    // refuses as `invalid-node` before any of this is reached. What the scan
    // meets is sharing in a branch nobody selected — and SIZE is the only thing
    // refused there, so a shallow one saves normally.
    const doc = pageWith(4);

    const plan = planSaveAsPattern(doc, ["mine"], target, anyParent);

    expect(plan.problem).toBeUndefined();
  });
});

describe("provenance is read once, and only where storage would keep it", () => {
  it("ignores a rename map storage would not keep", () => {
    // The enclosing `origin` is enumerable and whole; the `renamed` INSIDE it
    // is not. Every road this record travels to storage — `JSON.stringify`, an
    // object spread, `structuredClone` — drops that field, so restoring from it
    // renames an id on the strength of something the saved document will not
    // carry. Guarding the record's own property and not its fields left exactly
    // that gap one level down.
    const origin: Record<string, unknown> = {
      from: "pattern",
      id: "hero-pattern",
      digest: "d",
    };
    Object.defineProperty(origin, "renamed", {
      value: { pricing: "pricing-1" },
      enumerable: false,
      configurable: true,
    });
    // The premise, asserted rather than assumed: a fixture that quietly became
    // enumerable would make this test pass for the opposite reason.
    expect(JSON.parse(JSON.stringify(origin)).renamed).toBeUndefined();

    const root = node("root", { origin } as Partial<BlockNode>, {
      children: [node("t", { cssId: "pricing-1", props: { mark: "target" } })],
    });

    const saved = created(
      planSaveAsPattern(page([root]), ["t"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("reads a validated rename record without enumerating it again", () => {
    // A record that answers `ownKeys` once and throws on the next call. The
    // guard enumerates to validate the map; a reader that goes back for the
    // contents runs the same trap a second time and escapes as a native error
    // from a save of a selection this node is not even part of.
    let listings = 0;
    const renamed = new Proxy(
      { pricing: "pricing-1" } as Record<string, string>,
      {
        ownKeys(record) {
          listings += 1;
          if (listings > 1) throw new TypeError("listed twice");
          return Reflect.ownKeys(record);
        },
      }
    );
    const sibling = node("sibling", {
      origin: { from: "pattern", id: "hero-pattern", digest: "d", renamed },
    } as Partial<BlockNode>);
    const doc = page([
      node("mine", { cssId: "hero", props: { mark: "target" } }),
      sibling,
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
    expect(listings).toBe(1);
  });

  it("reads a node's origin descriptor once, not once per question", () => {
    // Whether a node BOUNDS the scope and what its record SAYS were two reads
    // of one descriptor. A node reaching a planner can be a Proxy, and two
    // reads can answer differently — so the origin that established the scope
    // and the origin whose map rewrote the ids could be two different records,
    // each individually valid, with nothing downstream able to tell.
    let reads = 0;
    const child = node("kid", {
      cssId: "pricing-1",
      props: { mark: "target" },
    });
    const bare = node("root", {}, { children: [child] });
    // The FIRST answer renames nothing, which is what an insert that met no
    // collision writes. The second renames `pricing` — so a second read is
    // visible as `pricing-1` coming back as `pricing`.
    const answers = [
      { from: "pattern", id: "hero-pattern", digest: "d" },
      {
        from: "pattern",
        id: "hero-pattern",
        digest: "d",
        renamed: { pricing: "pricing-1" },
      },
    ];
    const root = new Proxy(bare, {
      getOwnPropertyDescriptor(held, key) {
        if (key !== "origin") {
          return Reflect.getOwnPropertyDescriptor(held, key);
        }
        const value = answers[Math.min(reads, answers.length - 1)];
        reads += 1;
        return { value, enumerable: true, configurable: true, writable: true };
      },
    }) as BlockNode;

    const saved = created(
      planSaveAsPattern(page([root]), ["kid"], target, anyParent)
    ).document;

    expect(reads).toBe(1);
    expect(marked([...saved.nodes], "target").cssId).toBe("pricing-1");
  });

  it("reads one node object's origin once, not once per occurrence", () => {
    // A node placed in two slots is REACHED twice — the shared walk counts it
    // as two elements of the document deliberately. Reading its record again on
    // the second visit would let one node object be a scope boundary on one
    // occurrence and not on the other, carrying two different rename maps, with
    // walk order deciding which one its descendants inherited.
    let reads = 0;
    const shared = new Proxy(node("shared", { cssId: "pricing-1" }), {
      getOwnPropertyDescriptor(held, key) {
        if (key !== "origin") {
          return Reflect.getOwnPropertyDescriptor(held, key);
        }
        reads += 1;
        return {
          value:
            reads === 1
              ? { from: "pattern", id: "hero-pattern", digest: "d" }
              : {
                  from: "pattern",
                  id: "hero-pattern",
                  digest: "d",
                  renamed: { pricing: "pricing-1" },
                },
          enumerable: true,
          configurable: true,
          writable: true,
        };
      },
    }) as BlockNode;
    const doc = page([
      node("left", {}, { children: [shared] }),
      node("right", {}, { children: [shared] }),
      node("mine", { cssId: "hero", props: { mark: "target" } }),
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
    expect(reads).toBe(1);
  });

  it("saves past a revoked proxy nothing selected", () => {
    // `Array.isArray` THROWS on a revoked proxy, so classifying the entry took
    // the walk out before either guarded slots read could contain it — and the
    // classification was spelled twice, so containing one moved the same error
    // to the line after it.
    const { proxy, revoke } = Proxy.revocable(node("gone"), {});
    revoke();
    const doc = page([
      node("mine", { cssId: "hero", props: { mark: "target" } }),
      proxy as BlockNode,
    ]);

    const saved = created(
      planSaveAsPattern(doc, ["mine"], target, anyParent)
    ).document;

    expect(marked([...saved.nodes], "target").cssId).toBe("hero");
  });
});
