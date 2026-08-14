/**
 * A page saved before `core/columns` restricted its slot must still LOOK the same.
 *
 * The claim is about published output, so the end-to-end case renders through `PageRenderer` and
 * reads the markup a visitor receives. Asserting only on the transform would prove the tree was
 * rewritten and say nothing about whether the page still draws as it did, which is the entire
 * point of the change.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";

import { normalizeLegacySlots } from "../normalize-legacy";
import { defaultBlockRegistry } from "../registry";
import { makeNode } from "../tree";
import { validateDocument } from "../validate";
import { PageRenderer } from "../../render/PageRenderer";
import "../../render/blocks";

import type { BlockDocument, BlockNode } from "../types";

const node = (type: string, slots?: Record<string, BlockNode[]>): BlockNode =>
  makeNode(type, {}, undefined, slots);

/** What a page saved before the restriction holds: ordinary blocks directly in the row. */
function legacyRow(): BlockNode {
  return node("core/columns", {
    default: [makeNode("core/heading", { text: "left" })],
  });
}

/** The same page as it would be authored today. */
function modernRow(): BlockNode {
  return node("core/columns", {
    default: [
      node("core/column", {
        default: [makeNode("core/heading", { text: "left" })],
      }),
    ],
  });
}

const docOf = (root: BlockNode): BlockDocument => ({ version: 1, root });

describe("a legacy columns row", () => {
  it("is genuinely legacy — the stored shape is one the write path refuses", () => {
    // The precondition. Without it every assertion below could be describing a document that was
    // always fine, and the transform would be rewriting nothing of consequence.
    expect(validateDocument(docOf(legacyRow()), defaultBlockRegistry)).not.toBe(
      true
    );
  });

  it("has its children carried into the column that now draws the layout", () => {
    const normalized = normalizeLegacySlots(legacyRow(), defaultBlockRegistry);
    const children = normalized.slots?.default ?? [];
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("core/column");
    expect(children[0].slots?.default[0].type).toBe("core/heading");
  });

  it("draws the heading inside a column rather than directly in the row", () => {
    // The property a VISITOR sees. `core/column` is what supplies the flex item the old renderer
    // wrapped each child in, so the heading being nested inside one is what keeps the published
    // layout unchanged.
    const markup = renderToStaticMarkup(
      <PageRenderer document={docOf(legacyRow())} />
    );
    const rowIndex = markup.indexOf("display:flex");
    const headingIndex = markup.indexOf("left");
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeGreaterThan(rowIndex);
    // A div opens between the row and the heading — the column. Without normalization the heading
    // is the row's immediate child and this distance collapses.
    expect(markup.slice(rowIndex, headingIndex)).toContain("<div");
  });

  it("gives the wrapper the SAME id on every pass, so hydration matches", () => {
    // This transform runs on the server and again on the client for one stored document, and a
    // node's id drives its scoped CSS class. A random id differs between the passes, so the markup
    // and the stylesheet disagree and React reports a mismatch on a page nobody edited.
    const stored = legacyRow();
    const a = normalizeLegacySlots(stored, defaultBlockRegistry);
    const b = normalizeLegacySlots(stored, defaultBlockRegistry);
    const idOf = (n: BlockNode) => n.slots?.default[0].id;
    expect(idOf(a)).toBe(idOf(b));
    // And distinguishable from a stored id, so it is obvious where it came from.
    expect(idOf(a)).toContain("legacy-wrap:");
  });

  it("gives two different children two different wrappers", () => {
    // Derived-but-colliding would be worse than random: two nodes sharing a scoped class means one
    // block's styles applied to another.
    const root = node("core/columns", {
      default: [
        makeNode("core/heading", { text: "a" }),
        makeNode("core/heading", { text: "b" }),
      ],
    });
    const out = normalizeLegacySlots(root, defaultBlockRegistry);
    const [x, y] = out.slots?.default ?? [];
    // That these ARE the synthetic wrappers, before comparing them. Two distinct ids is also what
    // a normalizer returning the tree untouched produces — the two original headings — so the
    // comparison alone passes on the one outcome this test exists to exclude.
    expect(x.type).toBe("core/column");
    expect(y.type).toBe("core/column");
    expect(x.id).toContain("legacy-wrap:");
    expect(y.id).toContain("legacy-wrap:");
    expect(x.id).not.toBe(y.id);
  });

  it("does not reuse an id the stored document already holds", () => {
    // The prefix is a label, not a guarantee. Ids arrive from plugins and hand-authored JSON as
    // well as `crypto.randomUUID()`, so a stored node may legitimately be called `legacy-wrap:x`.
    // A duplicate is not cosmetic: the style compiler keys nodes BY ID, so two nodes sharing one
    // produce a single selector and the author's styles land on the synthetic column.
    const legacyChild = makeNode("core/heading", { text: "a" });
    const collider: BlockNode = {
      ...makeNode("core/heading", { text: "b" }),
      id: `legacy-wrap:${legacyChild.id}`,
    };
    const root = node("core/container", {
      default: [node("core/columns", { default: [legacyChild] }), collider],
    });

    const out = normalizeLegacySlots(root, defaultBlockRegistry);

    // The wrapper was actually built, and holds the legacy child. Without this the uniqueness
    // check below is satisfied by a normalizer that did nothing at all: the stored ids were
    // already distinct, so "no duplicates" is true of the input as well as of a correct output.
    const wrapper = out.slots?.default[0].slots?.default[0];
    expect(wrapper?.type).toBe("core/column");
    expect(wrapper?.slots?.default[0].id).toBe(legacyChild.id);

    const ids: string[] = [];
    const walk = (n: BlockNode) => {
      ids.push(n.id);
      for (const kids of Object.values(n.slots ?? {})) kids.forEach(walk);
    };
    walk(out);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a collision the SAME way on every pass", () => {
    // The collision path must stay hydration-safe too: suffixed rather than randomised, so the
    // server and the client agree on a document neither of them edited.
    const legacyChild = makeNode("core/heading", { text: "a" });
    const collider: BlockNode = {
      ...makeNode("core/heading", { text: "b" }),
      id: `legacy-wrap:${legacyChild.id}`,
    };
    const root = node("core/container", {
      default: [node("core/columns", { default: [legacyChild] }), collider],
    });
    const idOf = (n: BlockNode) => n.slots?.default[0].slots?.default[0].id;

    // The VALUE, pinned before the two passes are compared against each other. `toBe` between two
    // reads is satisfied by `undefined === undefined`, so a normalizer that produced no wrapper —
    // or a path expression that stopped matching the tree — agrees with itself perfectly and the
    // test reports stability it never observed.
    //
    // `#2` is what `freeId` appends when the derived id is already taken, and the id it would have
    // taken is exactly the collider's — which is what the fixture was built to occupy. Expressed
    // from `collider.id` rather than by respelling the prefix, so the two cannot disagree.
    const first = idOf(normalizeLegacySlots(root, defaultBlockRegistry));
    expect(first).toBe(`${collider.id}#2`);
    expect(idOf(normalizeLegacySlots(root, defaultBlockRegistry))).toBe(first);
  });

  it("leaves a document already in the current shape untouched, by IDENTITY", () => {
    // Identity rather than equality, because every page saved since the change takes this path on
    // every render. Rebuilding a tree that did not need it would cost each of them a full walk's
    // worth of allocation for nothing.
    const root = modernRow();
    expect(normalizeLegacySlots(root, defaultBlockRegistry)).toBe(root);
  });

  it("is idempotent, so a second pass finds nothing to do", () => {
    const once = normalizeLegacySlots(legacyRow(), defaultBlockRegistry);
    expect(normalizeLegacySlots(once, defaultBlockRegistry)).toBe(once);
  });

  it("makes the normalized tree one the write path would accept", () => {
    // Pairs with the precondition: the transform does not merely change the tree, it produces the
    // shape the restriction asks for. Note this is what a READER sees — the stored document is
    // deliberately untouched, and the repair banner still reports it.
    const normalized = normalizeLegacySlots(legacyRow(), defaultBlockRegistry);
    expect(validateDocument(docOf(normalized), defaultBlockRegistry)).toBe(
      true
    );
  });

  it("does not wrap where the WRAPPER itself may not sit there", () => {
    // The eligibility decision is shared with the repair banner, so read-time normalization
    // cannot wrap a child in a container the outer slot would refuse. Before it was shared, this
    // transform checked only the wrapper's inner slot and produced a page the write path rejects
    // while the banner declined the identical wrap.
    const inColumn = defineBlock({
      name: "acme/incolumn",
      version: 1,
      description: "Belongs in a column.",
      example: { props: {} },
      parent: ["core/column"],
      render: () => null,
    });
    registerBlocks([inColumn], { source: "@acme/blocks" });
    try {
      // `core/column` may only sit in `core/columns`; this is a `core/cover`.
      const root = node("core/cover", { default: [makeNode("acme/incolumn")] });
      const out = normalizeLegacySlots(root, defaultBlockRegistry);
      expect(out).toBe(root);
    } finally {
      clearBlocks();
    }
  });

  it("leaves a refused child alone where the slot names no single wrapper", () => {
    // `core/container` restricts nothing, so there is no wrapper to choose and nothing to do. The
    // control that stops this transform being read as "wrap everything".
    const root = node("core/container", {
      default: [makeNode("core/heading")],
    });
    expect(normalizeLegacySlots(root, defaultBlockRegistry)).toBe(root);
  });
});
