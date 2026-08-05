/**
 * What a class tier puts in the stylesheet, and in what order.
 *
 * At one specificity the cascade IS source order, so where a class rule is written relative to
 * the block default and the node's own values is not a detail of the output — it is the whole
 * definition of which value an author sees. These tests assert against the emitted CSS for that
 * reason: the stylesheet is the only authority on what the browser does.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, NodeStyles } from "../document";
import { MAX_CLASSES_PER_NODE, MAX_NAMED_CLASSES } from "../document";
import { validate } from "../validation";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import { MAX_COMPILE_WARNING_PATH_BYTES } from "./warning-allowance";
import type { NamedClass } from "./named-class";
import { MAX_NAMED_CLASS_NAME_LENGTH } from "./named-class";

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

/**
 * Where a selector sits in the stylesheet, refusing one that is not there.
 *
 * `indexOf` answers -1 for an absent needle, and -1 is less than every real index, so an order
 * assertion written straight on `indexOf` holds whether or not the rule was ever emitted. Every
 * comparison below reads its positions through this, so a selector that stops being written
 * fails the test that depends on it instead of satisfying it.
 */
const at = (css: string, needle: string, last = false): number => {
  const index = last ? css.lastIndexOf(needle) : css.indexOf(needle);
  expect(index, `"${needle}" is not in the stylesheet`).toBeGreaterThan(-1);
  return index;
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

    expect(at(css, ".nx-c-card")).toBeLessThan(at(css, ".nx-c-feature"));
  });

  it("emits classes after the block default and before the node's own values", () => {
    const { css } = compile(doc({ styles: styles({ color: "red" }) }), [card], {
      "core/box": styles({ color: "black" }),
    });

    const blockDefault = at(css, ".nx-bt-core--box");
    const classRule = at(css, ".nx-c-card");
    const nodeRule = at(css, "color: red", true);

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

describe("tier order beats breakpoint order, in both halves", () => {
  it("emits the whole class tier before the whole node tier, across breakpoints", () => {
    // A class at a NARROW breakpoint and a node at a WIDER one. Both match at the narrow width,
    // and the node's rule is written later, so the node wins — even though its breakpoint is the
    // wider of the two. Tier grouping outranks breakpoint order because the tiers are emitted
    // whole, one after another, with the breakpoints nested inside each.
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

    expect(at(css, ".nx-c-card")).toBeLessThan(at(css, "color: red", true));
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
    expect(at(css, "a:hover")).toBeLessThan(at(css, ".nx-c-card a"));
  });
});

describe("one bad library entry cannot spend the whole tier", () => {
  it("still writes a later class after an earlier one exhausts its own budget", () => {
    // Each class writes on a budget of its own. Shared across the tier, one unreferenced entry
    // with enough invalid properties refuses every class after it unread, and a node referencing
    // a perfectly good class receives its token and no declarations.
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

describe("a link colour set on an ancestor", () => {
  it("beats the child's own class, because the compiler groups by tier", () => {
    // Measured, because it reads the other way round. `linkColor` writes a DESCENDANT rule, so a
    // parent's `.parent a` lands on this child's links directly rather than being inherited — and
    // the compiler emits every block default, then every class, then every node's own rules, so
    // the parent's LOCAL rule is written after the child's CLASS rule and wins.
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "parent",
          type: "core/box",
          version: 1,
          props: {},
          styles: styles({ linkColor: "red" }),
          slots: {
            default: [
              {
                id: "child",
                type: "core/box",
                version: 1,
                props: {},
                classes: ["c1"],
              },
            ],
          },
        },
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
        blockBases: { "core/box": styles({ linkColor: "green" }) },
      } as never
    );

    const classRule = css.indexOf(".nx-c-card a");
    const parentRule = css.lastIndexOf(" a { color: red }");
    expect(classRule).toBeGreaterThan(-1);
    expect(parentRule).toBeGreaterThan(classRule);
  });
});

describe("a class library too large to be real", () => {
  it("reads a bounded prefix and says it stopped", () => {
    // Site-level data read on EVERY page render, and the only unbounded read left on the path:
    // the document walk is capped and the warnings are capped, but a corrupt settings row was
    // still copied, sorted and scanned in full each time.
    const huge = Array.from(
      { length: MAX_NAMED_CLASSES + 5 },
      (_unused, index): NamedClass => ({
        id: `c${index}`,
        slug: `cls-${index}`,
        orderIndex: index,
        styles: styles({ color: "blue" }),
      })
    );

    const { css, warnings } = compile(doc({}), huge);

    expect(warnings.map(w => w.code)).toContain("invalid-class-library");
    expect(css).not.toContain(`.nx-c-cls-${MAX_NAMED_CLASSES + 1}`);
  });
});

describe("block defaults competing on a descendant selector", () => {
  it("orders them by type name, which is what the compiler emits", () => {
    // One block-default rule exists per TYPE, written in sorted order, so which of two wins on a
    // link inside a nested block is decided by the names — not by which block is the ancestor.
    // A parent typed `z/outer` is emitted after a child typed `a/inner`, so the parent wins.
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "outer",
          type: "z/outer",
          version: 1,
          props: {},
          slots: {
            default: [{ id: "inner", type: "a/inner", version: 1, props: {} }],
          },
        },
      ],
    };
    const blockBases = {
      "z/outer": styles({ linkColor: "red" }),
      "a/inner": styles({ linkColor: "blue" }),
    };
    const { css } = compilePageCss(
      document as never,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        namedClasses: [],
        blockBases,
      } as never
    );

    expect(at(css, ".nx-bt-a--inner a")).toBeLessThan(
      at(css, ".nx-bt-z--outer a")
    );
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

    expect(at(css, ":where(:hover)")).toBeLessThan(at(css, "color: red", true));
  });
});

describe("a class library the compiler cannot use whole", () => {
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

describe("a class carrying an enormous style envelope", () => {
  it("stops reading stored keys once the report is bounded", () => {
    // Site settings, read on every page render. The allowance bounds what is RETURNED, so the
    // walk has to consult it before `Object.keys(...).sort()` allocates and orders every key —
    // otherwise a class holding a huge map of stale breakpoint ids pays for that on every
    // compile however short the warning list ends up.
    //
    // Asserted deterministically rather than by a stopwatch, which is what makes this a test
    // rather than a flake. The bound slices before sorting, so it reads keys in STORED order;
    // unbounded, the sort runs first and `aaa-sorts-first` leads. Inserted last, it is therefore
    // reported only if every key was read.
    const stale: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      stale[`ghost-${index}`] = { color: "blue" };
    }
    stale["aaa-sorts-first"] = { color: "blue" };

    const { warnings } = compile(doc({}), [
      {
        id: "c1",
        slug: "card",
        orderIndex: 0,
        styles: { base: stale } as never,
      },
    ]);

    expect(warnings.some(w => w.path.includes("aaa-sorts-first"))).toBe(false);
    expect(warnings.some(w => w.path.includes("ghost-"))).toBe(true);
  });
});

describe("what a class style warning points at", () => {
  it("names the stored styles field, so an editor can open it", () => {
    // The envelope lives under `styles`. A pointer built without it reads
    // `/classes/0/base/base/bogus` and resolves to nothing.
    const { warnings } = compile(doc({}), [
      {
        id: "c1",
        slug: "card",
        orderIndex: 0,
        styles: styles({ color: "not a color" }),
      },
    ]);

    const objection = warnings.find(
      w => w.path.includes("bogus") || w.path.includes("color")
    );
    expect(objection?.path.startsWith("/classes/0/styles")).toBe(true);
  });
});

describe("diagnostics across a whole library", () => {
  it("bounds what is returned even though each class writes on its own budget", () => {
    // The per-class WRITE budget is what stops one bad entry silencing the others. It also means
    // each class can produce a full budget of diagnostics, so a large library multiplies them —
    // the returned list is bounded by the shared allowance instead.
    const noisy: Record<string, unknown> = {};
    for (let index = 0; index < 200; index += 1) {
      noisy[`bogusProperty${index}`] = "nonsense";
    }
    const library = Array.from({ length: 200 }, (_unused, index) => ({
      id: `c${index}`,
      slug: `cls-${index}`,
      orderIndex: index,
      styles: styles(noisy),
    }));

    const { warnings } = compile(doc({}), library as never);

    expect(warnings.length).toBeLessThan(1000);
  });
});

describe("a class name too long to be real", () => {
  it("refuses it, so it never reaches a selector", () => {
    // The library COUNT is capped and its bytes are not, so one corrupted entry with a
    // syntactically valid but enormous slug is copied into a selector on every page render.
    const enormous = `c${"a".repeat(MAX_NAMED_CLASS_NAME_LENGTH)}`;
    const { css, warnings } = compile(doc({}), [
      {
        id: "c1",
        slug: enormous,
        orderIndex: 0,
        styles: styles({ color: "blue" }),
      },
    ]);

    expect(css).not.toContain(enormous);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("a node listing more classes than a node can have", () => {
  it("reads a bounded prefix and says it stopped", () => {
    // Document data, unvalidated, walked on every render of the page holding it. The library cap
    // bounds site settings; this is the same read on the other side of it.
    const many = Array.from(
      { length: MAX_CLASSES_PER_NODE + 5 },
      (_unused, index) => `ghost-${index}`
    );
    const { warnings } = compile(doc({ classes: many }), [card]);

    expect(warnings.map(w => w.code)).toContain("too-many-classes");
    // Every id here is missing, so an unbounded read reports one per entry. The bound is what
    // makes the last of them unreachable.
    const missing = warnings.filter(w => w.code === "unknown-class").length;
    expect(missing).toBeLessThanOrEqual(MAX_CLASSES_PER_NODE);
  });

  it("is refused by a publish gate rather than silently truncated", () => {
    // A document that validates and then renders differently from what it says is the one
    // outcome the compiler's bound must not produce on its own: the extra class is stored,
    // reported nowhere, and never reaches the element.
    const many = Array.from(
      { length: MAX_CLASSES_PER_NODE + 1 },
      (_unused, index) => `c${index}`
    );
    const document = doc({ classes: many });
    const known = { has: (id: string) => many.includes(id) };

    const strict = validate(document, {
      mode: "strict",
      classes: known,
    } as never);
    const forgiving = validate(document, {
      mode: "forgiving",
      classes: known,
    } as never);

    expect(
      strict.filter(
        i => i.code === "too-many-classes" && i.severity === "error"
      )
    ).toHaveLength(1);
    // A document already stored this way stays readable, and still says what it lost.
    expect(
      forgiving.filter(
        i => i.code === "too-many-classes" && i.severity === "warning"
      )
    ).toHaveLength(1);
  });

  it("applies the classes inside the bound and none beyond it", () => {
    const filler = Array.from(
      { length: MAX_CLASSES_PER_NODE },
      (_unused, index) => `ghost-${index}`
    );
    const { classes } = compile(doc({ classes: [...filler, card.id] }), [card]);

    // `card` is real and would otherwise be applied; it sits one past the bound.
    expect(classes.get("n1")).not.toContain("nx-c-card");
  });
});

describe("a class holding a key larger than the whole warning allowance", () => {
  // A JSON-Pointer carries its key whole, deliberately: a shortened one resolves to nothing and a
  // dropped one resolves to the wrong value. What keeps that bounded is the document byte cap —
  // and a class library is site settings, outside it, read on every page render.
  //
  // The byte allowance is charged before a warning is admitted, which is what makes it a bound
  // rather than a running total: charged afterwards, the first warning is admitted whole however
  // large. Each kind of stored key is checked because each builds its own pointer.
  const enormous = (prefix: string) => `${prefix}${"x".repeat(100_000)}`;

  const warningsFor = (styles: Record<string, unknown>) =>
    compile(doc({}), [
      { id: "c1", slug: "card", orderIndex: 0, styles } as never,
    ]).warnings;

  const bounded = (styles: Record<string, unknown>): void => {
    const warnings = warningsFor(styles);
    const bytes = warnings.reduce((total, w) => total + w.path.length, 0);

    // Bounded by the allowance, not by the size of the stored key.
    expect(bytes).toBeLessThan(MAX_COMPILE_WARNING_PATH_BYTES);
    // And it says it stopped, rather than returning a shorter list that reads as complete.
    expect(warnings.map(w => w.code)).toContain("style-issues-truncated");
  };

  it("bounds the answer for an unusable state key", () => {
    bounded({ [enormous("s")]: { base: { color: "blue" } } });
  });

  it("bounds the answer for an unusable breakpoint id", () => {
    bounded({ base: { [enormous("b")]: { color: "blue" } } });
  });

  it("bounds the answer for an unusable property name", () => {
    bounded({ base: { [BP]: { [enormous("p")]: "blue" } } });
  });
});

describe("what a warning about one class reference points at", () => {
  it("names the entry that was dropped, not the whole list", () => {
    // An editor follows this pointer to highlight or remove the reference. Addressed to the
    // array, it names a list the author has to search, and a repair tool cannot act on it.
    const { warnings } = compile(doc({ classes: ["c1", "ghost"] }), [card]);

    const missing = warnings.find(w => w.code === "unknown-class");
    expect(missing?.path).toBe("/nodes/0/classes/1");
  });

  it("reports the same missing class once per node that lists it", () => {
    // The pointer names one stored reference, and a reference is per node. Deduped across the
    // document, the first node takes the only report and an author who follows that pointer and
    // repairs it hears nothing about the rest.
    const twoNodes = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "n1",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["ghost"],
        },
        {
          id: "n2",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["ghost"],
        },
      ],
    } as unknown as BlockDocument;

    const { warnings } = compile(twoNodes, [card]);
    const missing = warnings.filter(w => w.code === "unknown-class");

    expect(missing.map(w => w.path)).toEqual([
      "/nodes/0/classes/0",
      "/nodes/1/classes/0",
    ]);
  });

  it("still reports it once for a node that lists it twice", () => {
    const { warnings } = compile(doc({ classes: ["ghost", "ghost"] }), [card]);

    expect(warnings.filter(w => w.code === "unknown-class")).toHaveLength(1);
  });

  it("keeps two nodes apart when the document repeats an id", () => {
    // A forgiving compile reads documents whose node ids repeat. Keyed by id, two stored nodes
    // share one set and the second node's reference goes unreported — the collapse the per-node
    // split exists to prevent, reintroduced by choosing a key the document controls.
    const repeated = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "same",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["ghost"],
        },
        {
          id: "same",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["ghost"],
        },
      ],
    } as unknown as BlockDocument;

    const { warnings } = compile(repeated, [card]);

    expect(
      warnings.filter(w => w.code === "unknown-class").map(w => w.path)
    ).toEqual(["/nodes/0/classes/0", "/nodes/1/classes/0"]);
  });

  it("is refused by a publish gate when an id is too long to name a class", () => {
    // The compiler drops such a reference, so validation has to refuse it too — otherwise a
    // strict publish succeeds and the page renders without that class's styling. The caller's
    // lookup saying the id exists does not change it: no library entry can carry one that long.
    const enormous = "c".repeat(MAX_NAMED_CLASS_NAME_LENGTH + 1);
    const document = doc({ classes: [enormous] });
    const known = { has: () => true };

    const strict = validate(document, {
      mode: "strict",
      classes: known,
    } as never);
    const forgiving = validate(document, {
      mode: "forgiving",
      classes: known,
    } as never);

    expect(
      strict.filter(
        i =>
          i.code === "invalid-classes" &&
          i.severity === "error" &&
          i.path === "/nodes/0/classes/0"
      )
    ).toHaveLength(1);
    expect(
      forgiving.filter(
        i => i.code === "invalid-classes" && i.severity === "warning"
      )
    ).toHaveLength(1);
  });

  it("calls an id too long to name a class malformed", () => {
    // `isUsableNamedClass` caps an id, so no class can carry a longer one. Hashing it to dedupe
    // or to look it up reads the whole string, on every render, for a value nothing can match.
    const enormous = "c".repeat(MAX_NAMED_CLASS_NAME_LENGTH + 1);
    const { warnings } = compile(doc({ classes: [enormous] }), [card]);

    const reported = warnings.find(
      w => w.code === "invalid-classes" || w.code === "unknown-class"
    );
    expect(reported?.code).toBe("invalid-classes");
    expect(reported?.path).toBe("/nodes/0/classes/0");
  });

  it("calls a non-string entry malformed rather than unknown", () => {
    // No library can define `null`, so advising the author to add it there sends them to fix
    // something that cannot be fixed that way. Validation calls this shape malformed; so does it.
    const { warnings } = compile(doc({ classes: [null] }), [card]);

    const reported = warnings.find(
      w => w.code === "invalid-classes" || w.code === "unknown-class"
    );
    expect(reported?.code).toBe("invalid-classes");
    expect(reported?.path).toBe("/nodes/0/classes/0");
  });

  it("reports an over-long list under its own code", () => {
    // A shape error and an over-cap list need different repairs, so a consumer keying off the
    // code has to be able to tell them apart.
    const many = Array.from(
      { length: MAX_CLASSES_PER_NODE + 1 },
      (_unused, index) => `c${index}`
    );
    const { warnings } = compile(doc({ classes: many }), [card]);

    expect(warnings.map(w => w.code)).toContain("too-many-classes");
  });
});

describe("two malformed library entries that are the same value", () => {
  it("points at both, because they are two separate repairs", () => {
    // An entry identified by its VALUE cannot tell these apart: `null` equals `null`, so both
    // warnings addressed `/classes/0` and an editor following the pointer never reached the
    // second — it looks repaired while the library is still broken.
    const { warnings } = compile(doc({}), [null as never, null as never]);

    const paths = warnings
      .filter(w => w.code === "invalid-class-name")
      .map(w => w.path);
    expect(paths).toContain("/classes/0");
    expect(paths).toContain("/classes/1");
  });
});

describe("two missing class ids that begin alike", () => {
  it("reports both, because they are separate repairs", () => {
    // `describeValue` truncates, so a report keyed on the described form collapses ids sharing a
    // long prefix into one and leaves the second class unreported.
    //
    // Long enough to be truncated in a message, short enough that the ids stay inside the length
    // a class id may have — past that they are malformed rather than merely missing, which is a
    // different report and would not exercise this.
    const prefix = "ghost-".padEnd(MAX_NAMED_CLASS_NAME_LENGTH - 4, "x");
    const { warnings } = compile(
      doc({ classes: [`${prefix}-one`, `${prefix}-two`] }),
      [card]
    );

    expect(warnings.filter(w => w.code === "unknown-class")).toHaveLength(2);
  });
});

describe("many classes that each exhaust their own style budget", () => {
  it("says it stopped a fixed number of times, however large the library", () => {
    // The truncation marker is exempt from the allowance so it survives the bound it describes.
    // Exempt AND repeatable is the other failure: every map that hits its own style budget adds
    // one, so a large library answers with a marker per class.
    //
    // Two bounds can each announce once — the warning allowance and the per-map style budget —
    // so the invariant is that the count does not GROW with the library, not that it is one.
    const noisy: Record<string, unknown> = {};
    for (let index = 0; index < 400; index += 1) {
      noisy[`bogusProperty${index}`] = "nonsense";
    }
    const libraryOf = (count: number) =>
      Array.from({ length: count }, (_unused, index) => ({
        id: `c${index}`,
        slug: `cls-${index}`,
        orderIndex: index,
        styles: styles(noisy),
      }));
    const markers = (count: number) =>
      compile(doc({}), libraryOf(count) as never).warnings.filter(
        w => w.code === "style-issues-truncated"
      ).length;

    const small = markers(20);
    expect(small).toBeGreaterThan(0);
    expect(markers(200)).toBe(small);
  });
});

describe("a class whose name is too long", () => {
  it("is reported as a name problem, not as a missing id or styles", () => {
    // Refused by `isUsableNamedClass` for its length, it fell through to the structural branch
    // and told an author the id or styles were missing when the name was the whole of it.
    const { warnings } = compile(doc({}), [
      {
        id: "c1",
        slug: `c${"a".repeat(MAX_NAMED_CLASS_NAME_LENGTH)}`,
        orderIndex: 0,
        styles: styles({ color: "blue" }),
      },
    ]);

    expect(warnings.map(w => w.code)).toContain("invalid-class-name");
    expect(warnings.map(w => w.code)).not.toContain("invalid-class");
  });
});

describe("a stored class library with holes in it", () => {
  it("reports each hole at the position it sits in", () => {
    // Persisted data can arrive sparse, and `Array.prototype.map` preserves a sparse array's
    // holes — so positions derived that way carry holes where indexes should be, and every
    // warning built from one addresses `/classes/undefined`, which resolves to nothing.
    const sparse: NamedClass[] = [];
    sparse[2] = card;

    const { warnings } = compile(doc({}), sparse);
    const paths = warnings
      .filter(w => w.path.startsWith("/classes/"))
      .map(w => w.path);

    expect(paths).not.toContain("/classes/undefined");
    expect(paths).toEqual(["/classes/0", "/classes/1"]);
  });
});
