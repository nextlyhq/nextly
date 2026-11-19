/**
 * Duplicating a block: the copy, and where it goes.
 *
 * The fixture that separates a correct duplication from a plausible one is a
 * CONTAINER holding children. A copy that re-ids only the top node passes every
 * single-block case and then gives the document two nodes sharing each child's
 * id — after which an edit aimed at the copy lands on the original, silently,
 * because every op addresses by id and takes the first match.
 *
 * @module duplicate-block.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { blockDuplication, COPY_SUFFIX } from "./duplicate-block";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(clearBlocks);

function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      { ...base, name: "acme/heading", editor: { label: "Heading" } },
      {
        ...base,
        name: "acme/box",
        editor: { label: "Box" },
        slots: { children: {} },
      },
    ] as never,
    { source: "duplicate-test" }
  );
}

function node(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: {}, ...extra } as BlockNode;
}

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** Every id in a subtree, so uniqueness can be asserted rather than sampled. */
function idsOf(node: BlockNode): string[] {
  return [
    node.id,
    ...Object.values(node.slots ?? {})
      .flat()
      .flatMap(idsOf),
  ];
}

describe("blockDuplication", () => {
  it("places the copy immediately after the original", () => {
    // Not at the end of the page. An author duplicating a card is building a row
    // of them, and a copy appended elsewhere is one they then have to find.
    register();
    const document = documentOf([
      node("a", "acme/heading"),
      node("b", "acme/heading"),
    ]);

    expect(blockDuplication(document, "a")?.at).toEqual({ index: 1 });
  });

  it("keeps the copy in the original's parent and slot", () => {
    register();
    const document = documentOf([
      node("box", "acme/box", {
        slots: { children: [node("kid", "acme/heading")] },
      }),
    ]);

    expect(blockDuplication(document, "kid")?.at).toEqual({
      parentId: "box",
      slot: "children",
      index: 1,
    });
  });

  it("re-ids the WHOLE subtree, not just the node", () => {
    // THE case. Ids are the only thing this editor addresses by, so a copy that
    // kept a child's id would give one id two nodes — and every op afterwards
    // reaches whichever the walk finds first.
    register();
    const document = documentOf([
      node("box", "acme/box", {
        slots: {
          children: [
            node("kid", "acme/heading"),
            node("box2", "acme/box", {
              slots: { children: [node("deep", "acme/heading")] },
            }),
          ],
        },
      }),
    ]);

    const copy = blockDuplication(document, "box")?.node;
    if (copy === undefined) throw new Error("expected a duplication");

    const original = ["box", "kid", "box2", "deep"];
    const copied = idsOf(copy);

    // Same shape — the control, without which "no shared ids" would pass on a
    // copy that dropped its children entirely.
    expect(copied).toHaveLength(original.length);
    expect(copied.filter(id => original.includes(id))).toEqual([]);
    expect(new Set(copied).size).toBe(copied.length);
  });

  it("drops the DOM id, which two elements must not share", () => {
    // `cssId` and `attributes.id` both become an HTML `id`, and two elements
    // carrying one breaks every `getElementById` and every in-page anchor.
    register();
    const document = documentOf([
      node("a", "acme/heading", {
        cssId: "hero",
        attributes: { id: "hero", "data-keep": "yes" },
      }),
    ]);

    const copy = blockDuplication(document, "a")?.node;

    expect(copy?.cssId).toBeUndefined();
    expect(copy?.attributes).toEqual({ "data-keep": "yes" });
  });

  it("suffixes a name the author gave", () => {
    // Two rows reading "Hero title" in the layers panel is the confusion naming
    // exists to remove.
    register();
    const document = documentOf([
      node("a", "acme/heading", { name: "Hero title" }),
    ]);

    expect(blockDuplication(document, "a")?.node.name).toBe(
      `Hero title${COPY_SUFFIX}`
    );
  });

  it("leaves an UNNAMED block's copy unnamed", () => {
    // Inventing "Heading copy" would put a name on a block whose author never
    // gave it one, and two rows reading "Heading" are what an author expects
    // from two headings.
    register();
    const document = documentOf([node("a", "acme/heading")]);

    expect(blockDuplication(document, "a")?.node.name).toBeUndefined();
  });

  it("carries the lock, so the copy is not quietly different", () => {
    register();
    const document = documentOf([node("a", "acme/heading", { locked: true })]);

    expect(blockDuplication(document, "a")?.node.locked).toBe(true);
  });

  it("names the block for an announcement, by the author's name where there is one", () => {
    register();
    expect(
      blockDuplication(
        documentOf([node("a", "acme/heading", { name: "Hero title" })]),
        "a"
      )?.label
    ).toBe("Hero title");
    expect(
      blockDuplication(documentOf([node("b", "acme/heading")]), "b")?.label
    ).toBe("Heading");
  });

  it("refuses with no selection or an id the document lost", () => {
    // An undo removing the selected node while the selection stands is routine,
    // not exotic.
    register();
    const document = documentOf([node("a", "acme/heading")]);

    expect(blockDuplication(document, null)).toBeNull();
    expect(blockDuplication(document, "gone")).toBeNull();
  });

  it("copies props rather than sharing them", () => {
    // A shallow copy would leave both blocks pointing at one props object, so
    // editing the copy would change the original with nothing to show for it.
    register();
    const document = documentOf([
      node("a", "acme/heading", { props: { text: "Hello" } }),
    ]);

    const copy = blockDuplication(document, "a")?.node;
    const original = document.nodes[0];

    expect(copy?.props).toEqual({ text: "Hello" });
    expect(copy?.props).not.toBe(original?.props);
  });
});
