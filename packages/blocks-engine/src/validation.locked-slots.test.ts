/**
 * A locked slot holds the blocks it starts with, judged where a save is.
 *
 * Driven through the real registry and the real expander, because what a save
 * requires has to be what an insert creates: a hand-written list of starting
 * types would restate the expander's resolution rather than observe it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { expandSlotDefaults, makeNode } from "./tree";
import { validateDocument } from "./validation";
import type { ValidationContext } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

const leaf = (name: string) => ({ ...base, name });

const container = (name: string, slots: Record<string, unknown>) => ({
  ...base,
  name,
  slots,
});

beforeEach(() => {
  registerBlocks(
    [
      leaf("acme/heading"),
      leaf("acme/text"),
      leaf("acme/button"),
      leaf("acme/card"),
      leaf("acme/cta"),
      container("acme/hero", {
        content: {
          defaultBlock: [
            { type: "acme/heading" },
            { type: "acme/text" },
            { type: "acme/button" },
          ],
          lock: "all",
        },
      }),
      container("acme/grid", {
        items: {
          defaultBlock: [
            { type: "acme/card" },
            { type: "acme/card" },
            { type: "acme/cta" },
          ],
          lock: "insert",
        },
      }),
      container("acme/panel", { body: {} }),
      // Starts its body with a panel and declares no lock of its own.
      container("acme/lined-panel", {
        body: { defaultBlock: [{ type: "acme/panel" }] },
      }),
      container("acme/open-panel", { body: { lock: false } }),
      container("acme/frame", {
        main: { defaultBlock: [{ type: "acme/panel" }], lock: "all" },
      }),
      container("acme/open-frame", {
        main: { defaultBlock: [{ type: "acme/open-panel" }], lock: "all" },
      }),
      container("acme/deep-frame", {
        main: { defaultBlock: [{ type: "acme/lined-panel" }], lock: "all" },
      }),
      container("acme/sealed-frame", {
        main: {
          defaultBlock: [{ type: "acme/open-panel" }],
          lock: "contentOnly",
        },
      }),
      // Its second starting child names a type nothing registers, which the
      // expander drops rather than creating a placeholder.
      container("acme/partial", {
        main: {
          defaultBlock: [
            { type: "acme/heading" },
            { type: "acme/unregistered" },
          ],
          lock: "all",
        },
      }),
      container("acme/bare", { main: { lock: "all" } }),
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

/** A block as inserting it places it, with the children its slots start with. */
function placed(type: string): BlockNode {
  return makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
}

function leafNode(type: string): BlockNode {
  return makeNode(type, 1, {});
}

function page(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

/** The children stored under one slot, for a test to rearrange in place. */
function slotOf(node: BlockNode, slot: string): BlockNode[] {
  const children = node.slots?.[slot];
  if (children === undefined) throw new Error(`no "${slot}" slot stored`);
  return children;
}

/** The first child stored under one slot. */
function firstIn(node: BlockNode, slot: string): BlockNode {
  const child = slotOf(node, slot)[0];
  if (child === undefined) throw new Error(`the "${slot}" slot is empty`);
  return child;
}

function issuesOf(doc: BlockDocument, ctx: Partial<ValidationContext> = {}) {
  return validateDocument(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    mode: "strict",
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
    ...ctx,
  }).issues;
}

function lockIssues(doc: BlockDocument, ctx: Partial<ValidationContext> = {}) {
  return issuesOf(doc, ctx).filter(
    issue => issue.code === "locked-slot-altered"
  );
}

describe("a locked slot", () => {
  it("accepts every locked block exactly as inserting it places it", () => {
    const doc = page(
      placed("acme/hero"),
      placed("acme/grid"),
      placed("acme/frame"),
      placed("acme/deep-frame"),
      placed("acme/sealed-frame"),
      placed("acme/partial"),
      placed("acme/bare")
    );
    // The positive control, taken against the WHOLE issue list: a rule that
    // refused every locked slot would satisfy each refusal below.
    expect(issuesOf(doc)).toEqual([]);
  });

  it("refuses a slot locked all that lost a block, naming the block, the slot and its starting blocks", () => {
    const hero = placed("acme/hero");
    slotOf(hero, "content").splice(1, 1);

    const issues = lockIssues(page(hero));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: "/nodes/0/slots/content",
      severity: "error",
    });
    expect(issues[0]?.message).toContain(
      'The "content" slot of a "acme/hero" is locked "all", so it holds "acme/heading", "acme/text", "acme/button", in that order. It holds "acme/heading", "acme/button".'
    );
  });

  it("refuses a block added to a locked slot", () => {
    const hero = placed("acme/hero");
    slotOf(hero, "content").push(leafNode("acme/text"));

    expect(lockIssues(page(hero)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/content",
    ]);
  });

  it("refuses reordering a slot locked all, and accepts it in a slot locked insert", () => {
    const hero = placed("acme/hero");
    slotOf(hero, "content").reverse();
    const grid = placed("acme/grid");
    slotOf(grid, "items").reverse();

    expect(lockIssues(page(hero, grid)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/content",
    ]);
  });

  it("refuses a block added to or removed from a slot locked insert", () => {
    const fewer = placed("acme/grid");
    slotOf(fewer, "items").pop();
    const more = placed("acme/grid");
    slotOf(more, "items").push(leafNode("acme/card"));

    expect(lockIssues(page(fewer, more)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/items",
      "/nodes/1/slots/items",
    ]);
  });

  it("refuses a locked slot whose blocks were removed along with the slot itself", () => {
    const hero = placed("acme/hero");
    delete hero.slots;

    const issues = lockIssues(page(hero));

    // Anchored at the node, because the slot it names is not in the document.
    expect(issues.map(issue => issue.path)).toEqual(["/nodes/0"]);
    expect(issues[0]?.message).toContain("It holds none.");
  });

  it("holds a locked slot that starts with nothing to holding nothing", () => {
    const bare = placed("acme/bare");
    bare.slots = { main: [leafNode("acme/text")] };

    const issues = lockIssues(page(bare));

    expect(issues.map(issue => issue.path)).toEqual(["/nodes/0/slots/main"]);
    expect(issues[0]?.message).toContain("so it holds no blocks.");
  });

  it("requires only the starting blocks an insert could have created", () => {
    const partial = placed("acme/partial");
    // What the expander actually made, which is what the save may require.
    expect(slotOf(partial, "main").map(child => child.type)).toEqual([
      "acme/heading",
    ]);
    expect(lockIssues(page(partial))).toEqual([]);

    slotOf(partial, "main").push(leafNode("acme/unregistered"));

    expect(lockIssues(page(partial))).toHaveLength(1);
  });

  it("passes its lock down to a slot that declares none", () => {
    const frame = placed("acme/frame");
    firstIn(frame, "main").slots = { body: [leafNode("acme/text")] };

    expect(lockIssues(page(frame)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/main/0/slots/body",
    ]);
  });

  it("passes its lock down through every level that declares none", () => {
    const frame = placed("acme/deep-frame");
    // Two levels below the locked slot: the lined panel's body holds what it
    // starts with, and the panel inside that starts empty, so its body must
    // stay empty too.
    firstIn(firstIn(frame, "main"), "body").slots = {
      body: [leafNode("acme/text")],
    };

    expect(lockIssues(page(frame)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/main/0/slots/body/0/slots/body",
    ]);
  });

  it("lets a slot that declares false hold what an author puts in it", () => {
    const frame = placed("acme/open-frame");
    firstIn(frame, "main").slots = {
      body: [leafNode("acme/text"), leafNode("acme/card")],
    };

    expect(lockIssues(page(frame))).toEqual([]);
  });

  it("does not let a slot that declares false loosen contentOnly around it", () => {
    const frame = placed("acme/sealed-frame");
    firstIn(frame, "main").slots = { body: [leafNode("acme/text")] };

    expect(lockIssues(page(frame)).map(issue => issue.path)).toEqual([
      "/nodes/0/slots/main/0/slots/body",
    ]);
  });

  it("refuses in forgiving mode too, because a lock is not a value to preserve", () => {
    const hero = placed("acme/hero");
    slotOf(hero, "content").pop();

    expect(
      lockIssues(page(hero), { mode: "forgiving" }).map(issue => issue.severity)
    ).toEqual(["error"]);
  });

  it("reports a malformed node rather than throwing while it judges locks", () => {
    // The node check reports these; the lock check must not be the one to trip
    // over them, or a rejected document becomes a server error.
    for (const nodes of [[null], [42], ["text"], [{ id: "a" }]]) {
      const doc = {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes,
      };
      expect(() => issuesOf(doc as unknown as BlockDocument)).not.toThrow();
      expect(issuesOf(doc as unknown as BlockDocument).length).toBeGreaterThan(
        0
      );
    }
  });

  it("checks no lock when the caller supplies no definitions", () => {
    const hero = placed("acme/hero");
    slotOf(hero, "content").pop();

    // The documented fail-open, pinned so a caller that omits the source is
    // visibly unguarded rather than silently so.
    expect(lockIssues(page(hero), { definitions: undefined })).toEqual([]);
    // The same document, with the source, is refused.
    expect(lockIssues(page(hero))).toHaveLength(1);
  });
});
