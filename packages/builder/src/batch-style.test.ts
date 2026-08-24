/**
 * What a selection shares, and what changing it costs.
 *
 * The op layer is tested in `ops.test.ts` and the single-node style write in
 * `style-values.test.ts`; nothing here re-asserts that a write writes. What is
 * only true HERE is what happens across MORE THAN ONE node: that a disagreement
 * is reported as its own answer rather than as an absence, that each block's op
 * is built from its own before-state, and that a group applies as one action or
 * not at all.
 *
 * @module batch-style.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import {
  batchStyleClearOps,
  batchStyleWriteOps,
  sharedValueAt,
} from "./batch-style";
import { applyOp } from "./ops";
import type { StyleAddress } from "./style-values";

const AT: StyleAddress = {
  state: "base",
  breakpoint: "base",
  property: "fontSize",
  path: [],
};

/** A node holding one value at {@link AT}, or nothing when none is given. */
function node(id: string, fontSize?: unknown): BlockNode {
  return {
    id,
    type: "acme/box",
    version: 1,
    props: {},
    ...(fontSize === undefined
      ? {}
      : { styles: { base: { base: { fontSize } } } }),
  } as unknown as BlockNode;
}

function doc(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as unknown as BlockDocument;
}

describe("what a selection shares at one address", () => {
  it("reports the value when every block holds it", () => {
    expect(sharedValueAt([node("a", "8px"), node("b", "8px")], AT)).toEqual({
      kind: "same",
      value: "8px",
    });
  });

  it("reports MIXED when they differ", () => {
    expect(sharedValueAt([node("a", "8px"), node("b", "12px")], AT)).toEqual({
      kind: "mixed",
    });
  });

  it("treats set-and-unset as a disagreement, not as unset", () => {
    /*
     * The case a naive "read the first one" would get wrong in the expensive
     * direction: it would show an empty control, and typing into an empty
     * control reads as "nothing here yet" when in fact it is about to overwrite
     * a value on half the selection.
     */
    expect(sharedValueAt([node("a", "8px"), node("b")], AT)).toEqual({
      kind: "mixed",
    });
    expect(sharedValueAt([node("a"), node("b", "8px")], AT)).toEqual({
      kind: "mixed",
    });
  });

  it("reports unset when NO block holds anything", () => {
    // The control on the pair above: agreeing on nothing is agreement.
    expect(sharedValueAt([node("a"), node("b")], AT)).toEqual({
      kind: "same",
      value: undefined,
    });
  });

  it("compares composite values by shape, not by key order", () => {
    /*
     * A style value is a tree — `padding` is four sides — and two blocks
     * holding equal trees hold equal values however separately those trees were
     * built. Comparing the text of `JSON.stringify` without sorting would call
     * these two a disagreement and put "Mixed" on a control whose blocks agree.
     */
    const at = { ...AT, property: "padding" };
    const composite = (id: string, styles: Record<string, string>) =>
      ({
        id,
        type: "acme/box",
        version: 1,
        props: {},
        styles: { base: { base: { padding: styles } } },
      }) as unknown as BlockNode;
    const left = composite("a", { blockStart: "1px", inlineStart: "2px" });
    const right = composite("b", { inlineStart: "2px", blockStart: "1px" });
    expect(sharedValueAt([left, right], at)).toEqual({
      kind: "same",
      value: { blockStart: "1px", inlineStart: "2px" },
    });
  });

  it("says nothing is mixed in an EMPTY selection", () => {
    // Nothing disagrees when there is nothing to disagree, and "Mixed" over no
    // blocks would describe a conflict that cannot exist.
    expect(sharedValueAt([], AT)).toEqual({ kind: "same", value: undefined });
  });
});

describe("the ops that change a whole selection", () => {
  it("builds one op per block that needs one", () => {
    const { ops, refused } = batchStyleWriteOps(
      [node("a", "8px"), node("b", "12px")],
      AT,
      "16px"
    );
    expect(ops).toHaveLength(2);
    expect(refused).toBeUndefined();
  });

  it("skips a block that already holds the value", () => {
    /*
     * Not a refusal and not an op. Setting a value half the selection already
     * had is the ordinary case, and an op per block regardless would put an
     * entry in the history that undoes to no visible effect on those blocks.
     */
    const { ops, refused } = batchStyleWriteOps(
      [node("a", "16px"), node("b", "12px")],
      AT,
      "16px"
    );
    expect(ops).toHaveLength(1);
    expect(refused).toBeUndefined();
  });

  it("builds each op from its OWN block's before-state", () => {
    /*
     * The defect this exists to prevent, and it is only visible through UNDO.
     * An op built once from the primary and repeated would carry the primary's
     * before-state into every inverse, so undoing the batch would restore the
     * primary's old value onto blocks that never held it.
     *
     * Driven through the real op layer in both directions rather than asserted
     * on the ops' shape: what matters is the document that comes back.
     */
    const withColour = {
      id: "a",
      type: "acme/box",
      version: 1,
      props: {},
      styles: { base: { base: { fontSize: "8px", color: "red" } } },
    } as unknown as BlockNode;
    const before = doc(withColour, node("b", "12px"));
    const { ops } = batchStyleWriteOps(before.nodes, AT, "16px");

    let working = before;
    for (const op of ops) working = applyOp(working, op).document;
    expect(sizesOf(working)).toEqual(["16px", "16px"]);

    /*
     * The separating property. Both blocks get the font size either way, so
     * asserting that alone passes on an op built from the wrong block. What
     * only the correct build produces is `b` WITHOUT the colour `a` happened to
     * be carrying — a style op patches the whole envelope, so the primary's
     * unrelated declarations travel with it.
     */
    expect(colourOf(working, "a")).toBe("red");
    expect(colourOf(working, "b")).toBeUndefined();
  });

  it("clears across the selection, skipping blocks with nothing to clear", () => {
    const { ops, refused } = batchStyleClearOps(
      [node("a", "8px"), node("b")],
      AT
    );
    expect(ops).toHaveLength(1);
    expect(refused).toBeUndefined();

    const applied = applyOp(doc(node("a", "8px"), node("b")), ops[0] as never);
    expect(sizesOf(applied.document)).toEqual([undefined, undefined]);
  });

  it("carries a warning the value layer reported about an ACCEPTED value", () => {
    /*
     * A warning is the validator explaining something about a value it took —
     * here a token reference the supplied table does not define, which renders
     * as nothing. `style-values` carries these for the reason its own comment
     * gives: a surface that dropped them presents an accepted-with-reservations
     * value as an unremarkable one. A batch that swallowed them would be the
     * same edit explaining less about itself the more blocks it touched.
     */
    const { ops, refused, warnings } = batchStyleWriteOps(
      [node("a"), node("b")],
      AT,
      { $token: "space.nosuch" } as never,
      { tokens: { kindOf: () => undefined } }
    );

    // Population before the property: the write was ACCEPTED, so this is a
    // warning about a value that is being stored rather than a refusal wearing
    // a different name.
    expect(refused).toBeUndefined();
    expect(ops).toHaveLength(2);
    expect(warnings.length).toBeGreaterThan(0);

    /*
     * Reported ONCE for a selection of two, not once per block. Every node is
     * asked about the same value under the same policy, so repeating it is
     * noise — and the count is what would silently grow with the selection if
     * the deduplication were dropped.
     */
    expect(warnings).toHaveLength(1);
  });

  it("keeps two findings that differ only in WHERE they are", () => {
    /*
     * The deduplication above is keyed on every field an issue carries, and
     * this is why the key cannot be narrowed to `code`. A composite value can
     * warn twice with the identical code and message about different
     * sub-values — `unknown-token` at `/padding/blockStart` and at
     * `/padding/blockEnd` — and merging those tells an author about one of the
     * two tokens that will render as nothing.
     *
     * Measured rather than reasoned: keying on `code` alone leaves ONE warning
     * here, and this assertion is what fails when it does.
     */
    const { refused, warnings } = batchStyleWriteOps(
      [node("a"), node("b")],
      { ...AT, property: "padding" },
      {
        blockStart: { $token: "space.a" },
        blockEnd: { $token: "space.b" },
      } as never,
      { tokens: { kindOf: () => undefined } }
    );

    expect(refused).toBeUndefined();
    // Both survive the selection AND the deduplication: two sub-values, two
    // findings, however many blocks were asked.
    expect(warnings).toHaveLength(2);
    expect(warnings.map(w => w.path).sort()).toEqual([
      "/padding/blockEnd",
      "/padding/blockStart",
    ]);
    // The population that makes the assertion above about the KEY rather than
    // about the codes: they are identical, so only the path separates them.
    expect(new Set(warnings.map(w => w.code)).size).toBe(1);
  });

  it("reports no warning for a token the site DOES define", () => {
    /*
     * The control that makes the assertion above evidence. Without it, a batch
     * layer that fabricated a warning for every write — or one whose fixture
     * warns for some unrelated reason — passes exactly the same way.
     */
    const { refused, warnings } = batchStyleWriteOps(
      [node("a"), node("b")],
      AT,
      { $token: "space.large" } as never,
      { tokens: { kindOf: () => "dimension" } }
    );

    expect(refused).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("refuses the WHOLE selection, naming no block, when the value cannot be used", () => {
    /*
     * All-or-nothing, and the name of this test used to say the opposite.
     *
     * It described the shape the module was first designed with — the refusing
     * block NAMED while the rest still moved — which is a partial batch, and
     * the implementation deliberately does not do it. The assertions below
     * always matched the real contract; only the explanation was left behind,
     * and a maintainer following it would have reintroduced partial writes
     * against a suite that kept passing.
     *
     * Why all-or-nothing is right here: every node is asked the SAME question,
     * because `styleWriteOp` refuses on the VALUE and the POLICY rather than on
     * anything about the receiving block. So a second answer would repeat the
     * first, and writing the blocks that agreed while the rest did not would
     * leave a selection half-styled from one gesture — with one undo entry that
     * only takes back the half that landed.
     */
    /*
     * `padding` is a composite — four sides — so a bare string is refused by the
     * value layer for every block. Chosen because it refuses DETERMINISTICALLY:
     * a fixture that only sometimes produces a refusal makes the assertions
     * below conditional, and a conditional assertion is satisfied by the
     * refusal never happening.
     */
    const at = { ...AT, property: "padding" };
    const { ops, refused } = batchStyleWriteOps(
      [node("a"), node("b")],
      at,
      "8px"
    );
    expect(refused).toContain("plain object");
    expect(ops).toEqual([]);
  });

  it("refuses the whole selection rather than styling half of it", () => {
    /*
     * A refusal is a property of the VALUE, not of any block: every node is
     * asked the same question with the same policy. Measured — a node carrying
     * an unrelated invalid stored value is still accepted — so there is no
     * fixture in which one block refuses and another does not, and writing the
     * agreeing half would leave a selection half-styled from one gesture.
     */
    const at = { ...AT, property: "padding" };
    const { ops, refused } = batchStyleWriteOps(
      [node("a"), node("b", "12px")],
      at,
      "8px"
    );
    expect(refused).toContain("plain object");
    expect(ops).toEqual([]);
  });

  it("accepts the same property when the value fits it", () => {
    // The control on the pair above: `padding` is not the problem, the string
    // was — so the refusal is about the value rather than about the property.
    const at = { ...AT, property: "padding" };
    const { ops, refused } = batchStyleWriteOps([node("a")], at, {
      blockStart: "8px",
    } as never);
    expect(refused).toBeUndefined();
    expect(ops).toHaveLength(1);
  });
});

/** The font size each node holds, in document order. */
function sizesOf(document: BlockDocument): (string | undefined)[] {
  return document.nodes.map(each => {
    const styles = each.styles as
      | { base?: { base?: { fontSize?: string } } }
      | undefined;
    return styles?.base?.base?.fontSize;
  });
}

/** The colour one node holds, for telling one block's op from another's. */
function colourOf(document: BlockDocument, id: string): string | undefined {
  const found = document.nodes.find(each => each.id === id);
  const styles = found?.styles as
    | { base?: { base?: { color?: string } } }
    | undefined;
  return styles?.base?.base?.color;
}
