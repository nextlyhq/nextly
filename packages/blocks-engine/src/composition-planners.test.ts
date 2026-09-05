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

import { planSaveAsPattern } from "./composition-planners";
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
    const plan = planSaveAsPattern(doc, ["a", "b"], target);

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
    const plan = planSaveAsPattern(doc, ["c", "b"], target);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "b",
      "c",
    ]);
  });

  it("LEAVES THE PAGE ALONE — a pattern is a copy, not a move", () => {
    const doc = page([node("a"), node("b")]);
    const plan = planSaveAsPattern(doc, ["a"], target);

    expect(plan.pageOps).toEqual([]);
  });

  it("does not mutate the document it was given", () => {
    const doc = page([node("a", { cssId: "pricing" }), node("b")]);
    const before = JSON.stringify(doc);

    planSaveAsPattern(doc, ["a", "b"], target);

    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("the copy is a document of its own", () => {
  it("shares no node id with the page it came from", () => {
    const doc = page([node("a", {}, { body: [node("a-child")] }), node("b")]);
    const plan = planSaveAsPattern(doc, ["a", "b"], target);

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
    const plan = planSaveAsPattern(doc, ["a"], target);

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

    const stored = planSaveAsPattern(doc, ["a", "b"], target).create?.document
      .nodes;
    expect(stored).toBeDefined();

    const copiedTarget = marked(stored ?? [], "target");
    const copiedPointer = marked(stored ?? [], "pointer");

    // The id moved...
    expect(copiedTarget.cssId).not.toBe("pricing");
    // ...and the reference moved with it, ACROSS the root boundary.
    expect(copiedPointer.attributes?.["aria-describedby"]).toBe(
      copiedTarget.cssId
    );
  });
});

describe("a link inside the saved run still reaches its own target", () => {
  it("stores an href pointing at the pattern's target, not the page's", () => {
    const doc = page([
      node("t", { cssId: "pricing", props: { mark: "target" } }),
      node("l", { props: { mark: "link", href: "#pricing" } }),
    ]);

    const stored =
      planSaveAsPattern(doc, ["t", "l"], target).create?.document.nodes ?? [];
    const copiedTarget = marked(stored, "target");
    const copiedLink = marked(stored, "link");

    // The id moved, so a stored `#pricing` would address nothing at all — and
    // insert cannot repair it later, because its own map is keyed by the id
    // this copy already renamed.
    expect(copiedTarget.cssId).not.toBe("pricing");
    expect(copiedLink.props?.href).toBe(`#${copiedTarget.cssId}`);
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
    const plan = planSaveAsPattern(doc, ["b", "c"], target);

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

    const plan = planSaveAsPattern(doc, ["s1", "s2"], target);

    expect(plan.create?.document.nodes.map(n => n.props?.mark)).toEqual([
      "wanted-a",
      "wanted-b",
    ]);
  });
});

describe("what it refuses, and why", () => {
  it("refuses a selection with a block left out of the middle", () => {
    const doc = page([node("a"), node("b"), node("c")]);
    const plan = planSaveAsPattern(doc, ["a", "c"], target);

    expect(plan.problem).toBe("gap");
    expect(plan.create).toBeUndefined();
  });

  it("refuses blocks that sit in two different containers", () => {
    const doc = page([
      node("one", {}, { body: [node("a")] }),
      node("two", {}, { body: [node("b")] }),
    ]);

    expect(planSaveAsPattern(doc, ["a", "b"], target).problem).toBe("split");
  });

  it("refuses an empty selection", () => {
    expect(planSaveAsPattern(page([node("a")]), [], target).problem).toBe(
      "empty"
    );
  });

  it("refuses an id the document does not hold, as its own cause", () => {
    expect(
      planSaveAsPattern(page([node("a")]), ["a", "ghost"], target).problem
    ).toBe("unknown");
  });
});
