/**
 * The compiler decides what the browser shows; the resolver tells an author where a value came
 * from. They read one order, expressed once, and these tests hold them to it — because a
 * provenance indicator that disagrees with the stylesheet is worse than none: it is confidently
 * wrong about the author's own page.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { NamedClass } from "./named-class";
import { resolveStyle } from "./resolve-style";

// The breakpoint id every fixture styles at. `base` is the widest in the shared set, which is
// what desktop-first means: it applies until a narrower one says otherwise.
const BP = "base";

const styles = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { [BP]: values } }) as unknown as NodeStyles;

const doc = (node: Record<string, unknown>): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: "core/box", version: 1, props: {}, ...node }],
  }) as unknown as BlockDocument;

const card: NamedClass = {
  id: "c1",
  slug: "card",
  orderIndex: 0,
  styles: styles({ color: "blue" }),
};
const feature: NamedClass = {
  id: "c2",
  slug: "feature",
  orderIndex: 1,
  styles: styles({ color: "green" }),
};

const compile = (
  document: BlockDocument,
  namedClasses: NamedClass[],
  blockBases = {}
) =>
  compilePageCss(document, {
    breakpoints: FIXTURE_BREAKPOINTS,
    namedClasses,
    blockBases,
  } as never);

describe("the class tier is emitted where it belongs in the cascade", () => {
  it("writes a rule for each class under its own name", () => {
    const { css } = compile(doc({}), [card, feature]);

    expect(css).toContain(".nx-c-card");
    expect(css).toContain(".nx-c-feature");
  });

  it("emits classes in library order, which is what makes one override another", () => {
    // At one specificity the cascade is source order, so the ORDER here is the whole mechanism.
    const { css } = compile(doc({}), [feature, card]);

    expect(css.indexOf(".nx-c-card")).toBeLessThan(
      css.indexOf(".nx-c-feature")
    );
  });

  it("emits classes after the block default and before the node's own values", () => {
    const { css } = compile(doc({ styles: styles({ color: "red" }) }), [card], {
      "core/box": styles({ color: "black" }),
    });

    const blockDefault = css.indexOf(".nx-bt-core--box");
    const classRule = css.indexOf(".nx-c-card");
    const nodeRule = css.lastIndexOf("color: red");

    expect(blockDefault).toBeLessThan(classRule);
    expect(classRule).toBeLessThan(nodeRule);
  });

  it("anchors every class rule to the page root, so nothing escapes the document", () => {
    const { css } = compile(doc({}), [card]);

    for (const line of css.split("\n").filter(l => l.includes(".nx-c-card"))) {
      expect(line).toContain(".nx-pb-page");
    }
  });

  it("refuses a class name that cannot be written to CSS, and says so", () => {
    const { css, warnings } = compile(doc({}), [
      { ...card, slug: "card, body" },
    ]);

    // Written, this would style every `body` on the page — a selector of the author's choosing.
    expect(css).not.toContain("body");
    expect(warnings.map(w => w.code)).toContain("invalid-class-name");
  });
});

describe("the resolver's answer matches what the compiler emitted", () => {
  it("agrees that the last class in library order wins", () => {
    const { css } = compile(doc({ classes: ["c1", "c2"] }), [card, feature]);
    const resolved = resolveStyle("color", "base", BP, {
      classes: [card, feature],
    });

    // The compiler puts feature last, so the browser shows green; the resolver must say so too.
    expect(css.indexOf(".nx-c-feature")).toBeGreaterThan(
      css.indexOf(".nx-c-card")
    );
    expect(resolved?.value).toBe("green");
    expect(resolved?.source).toEqual({
      tier: "class",
      id: "c2",
      slug: "feature",
    });
  });

  it("agrees that a node's own value beats every class", () => {
    const document = doc({ classes: ["c1"], styles: styles({ color: "red" }) });
    const { css } = compile(document, [card]);
    const resolved = resolveStyle("color", "base", BP, {
      classes: [card],
      node: styles({ color: "red" }),
    });

    expect(css.lastIndexOf("color: red")).toBeGreaterThan(
      css.indexOf(".nx-c-card")
    );
    expect(resolved?.source).toEqual({ tier: "local" });
  });

  it("agrees that a class beats the block default", () => {
    const { css } = compile(doc({ classes: ["c1"] }), [card], {
      "core/box": styles({ color: "black" }),
    });
    const resolved = resolveStyle("color", "base", BP, {
      blockBase: styles({ color: "black" }),
      classes: [card],
    });

    expect(css.indexOf(".nx-c-card")).toBeGreaterThan(
      css.indexOf(".nx-bt-core--box")
    );
    expect(resolved?.value).toBe("blue");
    expect(resolved?.source).toEqual({ tier: "class", id: "c1", slug: "card" });
  });
});

describe("tier order beats breakpoint order, in both halves", () => {
  it("emits the whole class tier before the whole node tier, across breakpoints", () => {
    // The case the agreement suite was missing: a class at a NARROW breakpoint and a node at a
    // WIDER one. Both match at the narrow width, and the node's rule is written later, so the
    // node wins — even though its breakpoint is the wider of the two.
    const cardAtTablet: NamedClass = {
      id: "c1",
      slug: "card",
      orderIndex: 0,
      styles: { base: { tablet: { color: "blue" } } } as never,
    };
    const { css } = compile(
      doc({ classes: ["c1"], styles: styles({ color: "red" }) }),
      [cardAtTablet]
    );

    expect(css.indexOf(".nx-c-card")).toBeLessThan(
      css.lastIndexOf("color: red")
    );

    const resolved = resolveStyle("color", "base", "tablet", {
      classes: [cardAtTablet],
      node: styles({ color: "red" }),
      breakpointChain: [BP],
    });

    // The resolver has to say what the stylesheet does, not what feels more specific.
    expect(resolved?.value).toBe("red");
  });

  it("writes only the first of two classes sharing a name, and says why", () => {
    const { css, warnings } = compile(doc({}), [
      card,
      { ...feature, slug: "card" },
    ]);

    // Emitted, both would land on one selector, so a node applying either would receive the
    // other's declarations and the later entry could override a class it never referenced.
    expect(css).toContain("color: blue");
    expect(css).not.toContain("color: green");
    expect(warnings.map(w => w.code)).toContain("duplicate-class-name");
  });

  it("survives a library entry that is not a record at all", () => {
    const { css, warnings } = compile(doc({}), [null as never, card]);

    expect(css).toContain(".nx-c-card");
    expect(warnings.map(w => w.code)).toContain("invalid-class-name");
  });
});
