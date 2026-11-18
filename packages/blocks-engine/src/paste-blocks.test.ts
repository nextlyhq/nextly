/**
 * Pasting copied blocks as fresh copies, through the same refusals the op
 * layer makes. `applyOps` runs the planned ops wherever the plan succeeds, so
 * a plan the apply would refuse shows up as a failing test.
 */
import { describe, expect, it } from "vitest";

import { planPasteBlocks } from "./composition-planners";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  tokenRef,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { applyOps, type BuilderOp } from "./ops";
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

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const anyParent = { parentsOf: () => undefined };

function idsIn(nodes: BlockNode[]): string[] {
  const out: string[] = [];
  walkNodes(nodes, each => out.push(each.id));
  return out;
}

/**
 * The forest with each block's own id blanked, to compare what else was kept.
 * Only block ids: a reference that happens to be called `id` (a media item's,
 * inside props) is compared as stored, so a copy that rewrote it fails.
 */
function withoutIds(nodes: readonly BlockNode[]): unknown {
  const copy = JSON.parse(JSON.stringify(nodes)) as BlockNode[];
  walkNodes(copy, each => {
    (each as { id: string }).id = "*";
  });
  return copy;
}

/** Apply a plan's ops, or fail the test with the refusal. */
function pasted(
  document: BlockDocument,
  blocks: BlockNode[],
  at: Parameters<typeof planPasteBlocks>[2]
): BlockDocument {
  const plan = planPasteBlocks(document, blocks, at, anyParent);
  if (plan.pageOps === undefined) throw new Error(`refused: ${plan.problem}`);
  return applyOps(document, plan.pageOps as BuilderOp[]).document;
}

/** A heading wearing every kind of reference a page can hold to the site. */
const referencing = (): BlockNode =>
  node(
    "card",
    {
      // A shared style and a block style, both as class ids.
      classes: ["cls_hero", "look:core/box:outline"],
      // A Design variable.
      styles: { base: { desktop: { color: tokenRef("t-accent") } } },
    },
    {
      children: [
        node("pic", {
          type: "core/image",
          // A media item from the library.
          props: { image: { id: "media-42", url: "/media/42.webp" } },
        }),
        node("placed", {
          type: COMPONENT_INSTANCE_TYPE,
          // A component, by its id in the library.
          props: { componentId: "cmp-pricing" },
        }),
        node("title", {
          type: "core/heading",
          props: { text: "Own text" },
          bindings: { text: { $bind: "title", source: "item" } },
        }),
      ],
    }
  );

describe("pasting copied blocks", () => {
  it("keeps every reference to the site and changes only the ids", () => {
    const copied = [referencing()];
    const result = pasted(page([node("a")]), copied, { index: 1 });
    const landed = result.nodes.slice(1);
    // Shared style, block style, variable, media, component and binding all
    // read back exactly as copied.
    expect(withoutIds(landed)).toEqual(withoutIds(copied));
    // And every id is new, so the copy is not the original.
    expect(idsIn(landed).some(id => idsIn(copied).includes(id))).toBe(false);
  });

  it("pastes the same blocks twice into one page with no id held twice", () => {
    const copied = [node("hero", { cssId: "hero" }, { children: [node("x")] })];
    const once = pasted(page(copied), copied, { index: 1 });
    const twice = pasted(once, copied, { index: 2 });
    const ids = idsIn(twice.nodes);
    expect(new Set(ids).size).toBe(ids.length);
    // The rendered DOM id is renamed only for the copies, where it would clash.
    const cssIds = twice.nodes.map(each => each.cssId);
    expect(new Set(cssIds).size).toBe(3);
    expect(cssIds[0]).toBe("hero");
  });

  it("re-identifies the roots together, so a reference between them follows the copy", () => {
    const label = node("label", {
      type: "core/heading",
      props: { text: "Name" },
      cssId: "name-label",
    });
    const field = node("field", {
      attributes: { "aria-labelledby": "name-label" },
    });
    const result = pasted(page([label, field]), [label, field], { index: 2 });
    const [, , labelCopy, fieldCopy] = result.nodes;
    expect(labelCopy?.cssId).not.toBe("name-label");
    expect(fieldCopy?.attributes?.["aria-labelledby"]).toBe(labelCopy?.cssId);
  });

  it("lands inside a container at the position asked for", () => {
    const box = node("box", {}, { children: [node("first")] });
    const result = pasted(page([box]), [node("copied")], {
      parentId: "box",
      slot: "children",
      index: 1,
    });
    expect(result.nodes[0]?.slots?.children).toHaveLength(2);
  });

  it("keeps a copied block's lock once it has landed", () => {
    const result = pasted(page([]), [node("held", { locked: true })], {
      index: 0,
    });
    expect(result.nodes[0]?.locked).toBe(true);
  });

  it("drops the record of a saved section the original was inserted from", () => {
    const fromSection = node("from", {
      origin: { from: "pattern", id: "hero-pattern", digest: "abc" },
    });
    const result = pasted(page([]), [fromSection], { index: 0 });
    expect(result.nodes[0]?.origin).toBeUndefined();
  });

  it("refuses a place the nesting rule refuses, and changes nothing", () => {
    const onlyInColumns = { parentsOf: () => ["core/columns"] };
    const plan = planPasteBlocks(
      page([]),
      [node("col")],
      { index: 0 },
      onlyInColumns
    );
    expect(plan.problem).toBe("restricted-at-root");
  });

  it("refuses a destination locked in Layers", () => {
    const box = node("box", { locked: true }, { children: [] });
    const plan = planPasteBlocks(
      page([box]),
      [node("copied")],
      { parentId: "box", slot: "children", index: 0 },
      anyParent
    );
    expect(plan.problem).toBe("destination-locked");
  });

  it("refuses blocks the op layer would not carry", () => {
    const broken = { id: "b", type: "core/box", props: {} } as BlockNode;
    const plan = planPasteBlocks(page([]), [broken], { index: 0 }, anyParent);
    expect(plan.problem).toBe("invalid-node");
  });

  it("refuses nothing to paste", () => {
    const plan = planPasteBlocks(page([]), [], { index: 0 }, anyParent);
    expect(plan.problem).toBe("empty");
  });
});
