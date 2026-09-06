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
  planInsertPattern,
  planSaveAsComponent,
  planSaveAsPattern,
} from "./composition-planners";
import type { PlanResult, PlannedCreate } from "./composition-planners";
import { COMPONENT_INSTANCE_TYPE, DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode, ComponentDocument } from "./document";
import { applyOps } from "./ops";
import type { BuilderOp } from "./ops";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import type { DocumentLimits } from "./limits";
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
    expect(threw).toBeUndefined();
    expect(result?.problem).toBeUndefined();
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
    const defaulted = planSaveAsComponent(
      doc,
      ["root"],
      componentTarget,
      exposure,
      anyParent
    );
    expect(defaulted.issues?.map(i => i.code)).toContain(
      "exposed-node-missing"
    );
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
