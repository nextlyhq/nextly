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

import { planInsertPattern, planSaveAsPattern } from "./composition-planners";
import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
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
    const insert = planInsertPattern(
      page([]),
      { id: "hero-pattern", document: stored as BlockDocument },
      { index: 0 },
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
    // The INSERT is where the id must move: this copy lands in a document that
    // may already hold the original.
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
    const insert = planInsertPattern(
      page([]),
      { id: "hero-pattern", document: stored as BlockDocument },
      { index: 0 },
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
