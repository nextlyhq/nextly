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
    expect(x.id).not.toBe(y.id);
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

  it("leaves a refused child alone where the slot names no single wrapper", () => {
    // `core/container` restricts nothing, so there is no wrapper to choose and nothing to do. The
    // control that stops this transform being read as "wrap everything".
    const root = node("core/container", {
      default: [makeNode("core/heading")],
    });
    expect(normalizeLegacySlots(root, defaultBlockRegistry)).toBe(root);
  });
});
