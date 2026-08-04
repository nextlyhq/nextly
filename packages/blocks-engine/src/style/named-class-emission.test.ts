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
import { resolveNodeClasses } from "./named-class";
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
      viewportChain: [BP, "tablet"],
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

  it("tells an author with a malformed class that its name is not the problem", () => {
    // A perfectly good name on an entry missing its styles record. Reported as a name collision,
    // the advice is to rename it — which fixes nothing, and there is no other class to collide
    // with, so the author is sent looking for one that does not exist.
    const { warnings } = compile(doc({}), [
      { id: "c9", slug: "lonely", orderIndex: 0 } as never,
    ]);

    const codes = warnings.map(w => w.code);
    expect(codes).toContain("invalid-class");
    expect(codes).not.toContain("duplicate-class-name");
    expect(warnings.find(w => w.code === "invalid-class")?.message).toContain(
      "missing its id or its styles"
    );
  });

  it("still calls a genuine name collision a collision", () => {
    const { warnings } = compile(doc({}), [card, { ...feature, slug: "card" }]);

    expect(warnings.map(w => w.code)).toContain("duplicate-class-name");
    expect(warnings.map(w => w.code)).not.toContain("invalid-class");
  });
});

describe("the classes a renderer is told to apply", () => {
  it("includes the named classes, without which the whole tier is inert", () => {
    // A `.nx-c-card` rule reaches an element only if the element carries the token. Returning the
    // node class alone would emit the tier and leave every rule in it applying to nothing.
    const { css, classes } = compile(doc({ classes: ["c1"] }), [card]);

    expect(css).toContain(".nx-c-card");
    expect(classes.get("n1")?.split(" ")).toContain("nx-c-card");
  });

  it("does not put on a class the stylesheet dropped", () => {
    // The second `card` is never written, so its rules belong to the first. Applying it would
    // hand this node declarations from a class it does not reference.
    const { classes } = compile(doc({ classes: ["c2"] }), [
      card,
      { ...feature, slug: "card" },
    ]);

    expect(classes.get("n1")).toBe(classes.get("n1")?.split(" ")[0]);
  });

  it("orders the tokens by the library, not by the node's list", () => {
    const { classes } = compile(doc({ classes: ["c2", "c1"] }), [
      card,
      feature,
    ]);

    expect(classes.get("n1")?.split(" ").slice(1)).toEqual([
      "nx-c-card",
      "nx-c-feature",
    ]);
  });
});

describe("a class that reserves a name it cannot use", () => {
  it("does not let an array envelope hold a slug a real class needs", () => {
    // `[]` is an object, so a looser guard accepted it. It then produced no declarations, and the
    // valid class wanting that name was dropped as a duplicate — costing the styling of every
    // node referencing it, on account of an entry that styled nothing.
    const { css } = compile(doc({ classes: ["c2"] }), [
      { id: "c1", slug: "card", orderIndex: 0, styles: [] as never },
      {
        id: "c2",
        slug: "card",
        orderIndex: 1,
        styles: styles({ color: "blue" }),
      },
    ]);

    expect(css).toContain("color: blue");
  });
});

describe("two classes claiming one id", () => {
  it("writes and applies the same one, and says the id is what collided", () => {
    // A document references a class by id, so two entries sharing one make the reference
    // ambiguous. Told only that the NAME collided, an author renames a class and the reference
    // still reaches the other one.
    const { css, classes, warnings } = compile(doc({ classes: ["c1"] }), [
      {
        id: "c1",
        slug: "card",
        orderIndex: 0,
        styles: styles({ color: "blue" }),
      },
      {
        id: "c1",
        slug: "feature",
        orderIndex: 1,
        styles: styles({ color: "green" }),
      },
    ]);

    expect(css).toContain(".nx-c-card");
    expect(css).not.toContain(".nx-c-feature");
    expect(classes.get("n1")?.split(" ")).toContain("nx-c-card");
    expect(warnings.map(w => w.code)).toContain("duplicate-class-id");
  });
});

describe("a node referencing a class that was never written", () => {
  it("says so rather than dropping the reference in silence", () => {
    const { classes, warnings } = compile(doc({ classes: ["ghost"] }), [card]);

    expect(classes.get("n1")).toBe(classes.get("n1")?.split(" ")[0]);
    expect(warnings.map(w => w.code)).toContain("unknown-class");
  });
});

describe("two nodes sharing one id", () => {
  it("puts no named class on either, as their own rules are already refused", () => {
    // One map entry cannot tell them apart, so a class recorded here is either lost by the node
    // written second or applied to both — restyling a node that never referenced it.
    const { classes } = compilePageCss(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "same",
            type: "core/box",
            version: 1,
            props: {},
            classes: ["c1"],
          },
          {
            id: "same",
            type: "core/box",
            version: 1,
            props: {},
            classes: ["c1"],
          },
        ],
      } as never,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        namedClasses: [card],
        blockBases: {},
      } as never
    );

    expect(classes.get("same")).not.toContain("nx-c-card");
  });
});

describe("link colour, where two properties reach one element", () => {
  it("resolves a hovered link the way the stylesheet actually cascades it", () => {
    // Measured, not reasoned: page settings' hover rule and a class's plain link rule both come
    // to three class-selectors, so the later one wins — and the later one is the class. Asking
    // only about `linkColorHover` reports the page's red over a link the browser paints blue.
    const document = {
      formatVersion: 1,
      kind: "page",
      settings: { styles: { base: { [BP]: { linkColorHover: "red" } } } },
      nodes: [
        { id: "n1", type: "core/box", version: 1, props: {}, classes: ["c1"] },
      ],
    };
    const linkCard: NamedClass = {
      id: "c1",
      slug: "card",
      orderIndex: 0,
      styles: styles({ linkColor: "blue" }),
    };
    const { css } = compilePageCss(
      document as never,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        namedClasses: [linkCard],
        blockBases: {},
      } as never
    );

    // The stylesheet is the authority. Both rules match a hovered link; the class's is written
    // after, and neither outranks the other.
    expect(css.indexOf("a:hover")).toBeLessThan(css.indexOf(".nx-c-card a"));

    const resolved = resolveStyle("linkColorHover", "base", BP, {
      pageSettings: document.settings.styles as never,
      classes: [linkCard],
    });

    expect(resolved?.value).toBe("blue");
    expect(resolved?.source).toEqual({ tier: "class", id: "c1", slug: "card" });
  });

  it("still prefers a hover rule that does outrank the plain one", () => {
    // Within one tier the hover selector carries an extra pseudo-class, so it wins there however
    // the two are ordered in storage.
    const resolved = resolveStyle("linkColorHover", "base", BP, {
      node: styles({ linkColor: "blue", linkColorHover: "red" }),
    });

    expect(resolved?.value).toBe("red");
  });
});

describe("one bad library entry cannot spend the whole tier", () => {
  it("still writes a later class after an earlier one exhausts its own budget", () => {
    // Sharing one budget across the tier meant an unreferenced entry with enough invalid
    // properties refused every class after it unread — so a node referencing a perfectly good
    // class received its token and no declarations, styled by an entry it never mentions.
    const noisy: Record<string, unknown> = {};
    for (let index = 0; index < 200; index += 1) {
      noisy[`bogusProperty${index}`] = "nonsense";
    }

    const { css } = compile(doc({ classes: ["c2"] }), [
      { id: "c1", slug: "noisy", orderIndex: 0, styles: styles(noisy) },
      {
        id: "c2",
        slug: "good",
        orderIndex: 1,
        styles: styles({ color: "blue" }),
      },
    ]);

    expect(css).toContain(".nx-c-good");
    expect(css).toContain("color: blue");
  });
});

describe("warnings point at something an editor can find", () => {
  it("addresses a skipped class by its position in the stored library", () => {
    // A pointer built from the id does not resolve: the id is exactly what is unreliable about a
    // malformed entry, and may be missing or not a string at all.
    const { warnings } = compile(doc({}), [
      card,
      { id: "c2", slug: "card", orderIndex: 1, styles: styles({}) },
    ]);

    const skipped = warnings.find(w => w.code === "duplicate-class-name");
    expect(skipped?.path).toBe("/classes/1");
  });
});

describe("a node whose class list is not a list", () => {
  it("says so rather than normalizing it away", () => {
    const { warnings, classes } = compile(doc({ classes: "c1" as never }), [
      card,
    ]);

    expect(warnings.map(w => w.code)).toContain("invalid-classes");
    expect(classes.get("n1")).not.toContain("nx-c-card");
  });
});

describe("a class library that is not a library", () => {
  it("survives a stored library that is not a list at all", () => {
    // One site-settings record, read by every page compile. A spread over `{}` throws, which
    // would stop rendering every page on the site rather than costing the styling of classes
    // nobody can read.
    const compileBroken = () =>
      compilePageCss(doc({}), {
        breakpoints: FIXTURE_BREAKPOINTS,
        namedClasses: {},
        blockBases: {},
      } as never);

    expect(compileBroken).not.toThrow();
    expect(compileBroken().warnings.map(w => w.code)).toContain(
      "invalid-class-library"
    );
  });
});

describe("what an interactive state actually resolves to", () => {
  it("lets a later tier's base value beat an earlier tier's hover value", () => {
    // States are emitted as `:where(:hover)`, which carries NO specificity, so a base rule
    // written later still wins. A hovered element matches both, and asking only about `hover`
    // reports a value the browser overrides.
    const cardHover: NamedClass = {
      id: "c1",
      slug: "card",
      orderIndex: 0,
      styles: { hover: { [BP]: { color: "blue" } } } as never,
    };
    const { css } = compile(
      doc({ classes: ["c1"], styles: styles({ color: "red" }) }),
      [cardHover]
    );

    expect(css.indexOf(":where(:hover)")).toBeLessThan(
      css.lastIndexOf("color: red")
    );

    const resolved = resolveStyle("color", "hover", BP, {
      classes: [cardHover],
      node: styles({ color: "red" }),
    });
    expect(resolved?.value).toBe("red");
    expect(resolved?.source).toEqual({ tier: "local" });
  });

  it("still prefers the state over the base WITHIN one tier", () => {
    const resolved = resolveStyle("color", "hover", BP, {
      node: {
        base: { [BP]: { color: "red" } },
        hover: { [BP]: { color: "blue" } },
      } as never,
    });
    expect(resolved?.value).toBe("blue");
  });
});

describe("a class library the compiler cannot use whole", () => {
  it("does not resolve a class whose name another class already took", () => {
    const first = card;
    const second: NamedClass = { ...feature, slug: "card" };
    const library = [first, second];

    // The compiler writes only the first. Resolving the second would report its value while the
    // block actually receives the first's declarations from the shared selector.
    const resolvedFor = resolveNodeClasses([second.id], library);
    expect(resolvedFor).toHaveLength(0);
  });

  it("does not resolve a class with no styles record", () => {
    const broken = { id: "c9", slug: "broken", orderIndex: 0 } as never;
    expect(resolveNodeClasses(["c9"], [broken])).toHaveLength(0);
    // And asking it directly answers rather than throwing.
    expect(
      resolveStyle("color", "base", BP, { classes: [broken] })
    ).toBeUndefined();
  });

  it("spends a bad class's diagnostics without silencing the nodes", () => {
    // A site's class library is one document's configuration and every document's problem.
    // Sharing the node budget let one malformed global entry strip the styling from a page that
    // never referenced it.
    const noisy: NamedClass = {
      id: "noisy",
      slug: "noisy",
      orderIndex: 0,
      styles: {
        base: {
          [BP]: Object.fromEntries(
            Array.from({ length: 400 }, (_, i) => [`bogus${i}`, "nope"])
          ),
        },
      } as never,
    };

    const { css } = compile(doc({ styles: styles({ color: "red" }) }), [noisy]);

    expect(css).toContain("color: red");
  });
});
