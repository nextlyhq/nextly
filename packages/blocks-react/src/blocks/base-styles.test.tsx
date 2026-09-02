/**
 * A default a block declares must REACH the stylesheet.
 *
 * `baseStyles` looks like a plain object and is not one: the compiler accepts
 * only properties `STYLE_CATALOG` knows and DROPS the rest rather than passing
 * them through. So a block can declare a default, read as correct in review,
 * and compile to nothing — which is what happened to `core/columns`, whose
 * first version declared `flex: 1 1 240px`. The catalog carries flex CONTAINER
 * properties and no flex ITEM properties at all, so the row sized none of its
 * children and the block's own test, which asserted the declaration OBJECT,
 * stayed green throughout.
 *
 * That is the failure this file exists to make unrepeatable, and it is
 * deliberately not written as one assertion per block. A hand-copied expectation
 * per block covers the blocks somebody remembered; these are DERIVED from
 * `coreBlocks`, so a block added tomorrow with an unsupported property fails
 * here without anyone editing this file. Two questions are asked separately
 * because they fail for different reasons and have different remedies:
 *
 * 1. **Is every declared property in the catalog?** Names the property, so the
 *    remedy is to pick a supported one. This is the `flex` case.
 * 2. **Does the compiled stylesheet actually carry it?** A catalog property can
 *    still be dropped for a VALUE the grammar refuses, which the first question
 *    cannot see.
 */
import {
  blockPartClassName,
  blockTypeClassName,
  defaultSiteTokens,
  type TokenLookup,
  getStyleProperty,
  validateStyleValues,
} from "@nextlyhq/blocks-engine";
import type {
  AnyBlockDefinition,
  BlockDocument,
  BlockNode,
  NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { coreBlocks } from "./index";

/** The blocks that declare defaults at all. */
const DECLARING = (coreBlocks as AnyBlockDefinition[]).filter(
  block => block.baseStyles !== undefined
);

/**
 * The PART defaults, which this file did not inspect at all until now.
 *
 * `DECLARING` filters on `block.baseStyles`, and every case below walks that
 * one field — so a property declared on a part has never been checked against
 * the catalog or against the compiled sheet. That is not a hypothetical gap:
 * `core/form`'s submit was written with `justify-self`, which the catalog does
 * not carry, and the whole suite stayed green while the declaration was
 * dropped and the button ran the full width of its column.
 *
 * Parts are where a block styles something it renders INSIDE its root, which
 * is exactly where an author cannot reach with a style control — so a default
 * dropped here is one nobody can put back.
 */
const DECLARING_PARTS: (readonly [string, string, NodeStyles])[] = (
  coreBlocks as AnyBlockDefinition[]
).flatMap(block =>
  Object.entries(
    (block.parts ?? {}) as Record<string, { baseStyles?: NodeStyles }>
  ).flatMap(([partName, part]) =>
    part.baseStyles === undefined
      ? []
      : [[block.name, partName, part.baseStyles] as const]
  )
);

/**
 * Every style property a `NodeStyles` declares, across states and breakpoints.
 *
 * Walked rather than read from a known path: the shape is state → breakpoint →
 * values, and a block is free to declare a hover state or a second breakpoint.
 * Reading only `base.base` would silently stop inspecting anything else.
 */
function declaredProperties(styles: NodeStyles): string[] {
  const found = new Set<string>();
  for (const byBreakpoint of Object.values(styles)) {
    if (byBreakpoint === undefined) continue;
    for (const values of Object.values(byBreakpoint)) {
      if (values === undefined) continue;
      for (const property of Object.keys(values)) found.add(property);
    }
  }
  return [...found].sort();
}

/**
 * The CSS spelling of a catalog property name.
 *
 * Derived rather than looked up, because a catalog entry's own `cssProperty`
 * lives at a different depth for each shape it can take — a scalar declares one,
 * an object shape declares one per field — so reading it would need a walker
 * per shape. Every scalar entry in the catalog is the plain kebab-case of its
 * property name, and an object-shaped one is counted rather than named, which is
 * what {@link declarationsFor} does with the prefix this returns.
 */
/**
 * How many scalar leaves one declared property carries, across every state and
 * breakpoint it is declared in.
 *
 * A token reference is a leaf rather than a branch: `{ $token }` compiles to a
 * single `var()`, so descending into it would count a declaration twice.
 */
function countLeaves(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  if (typeof (value as { $token?: unknown }).$token === "string") return 1;
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (total, nested) => total + countLeaves(nested),
    0
  );
}

/**
 * Every branch of a declaration that bottoms out in NOTHING, as a dotted path.
 *
 * Recursive, and that is the whole of it. A top-level `border: {}` is easy to
 * spot by counting leaves; `border: { width: {}, style: "solid" }` is not,
 * because the surviving sibling keeps the total nonzero. That shape is what
 * removing all four of the form control's border widths actually leaves behind,
 * and the emitted-versus-expected comparison cannot see it either — both sides
 * fall together, so the counts still agree while the border stops drawing.
 *
 * A `{ $token }` is a leaf rather than a branch: it compiles to one `var()`, so
 * descending into it would report the token's own fields as empty.
 */
function emptyBranches(value: unknown, path: string): string[] {
  if (typeof value !== "object" || value === null) return [];
  if (typeof (value as { $token?: unknown }).$token === "string") return [];
  const entries = Object.entries(value as Record<string, unknown>);
  // The base case that matters: an object with no entries declares nothing,
  // wherever it sits.
  if (entries.length === 0) return [path];
  return entries.flatMap(([key, nested]) =>
    emptyBranches(nested, `${path}.${key}`)
  );
}

/**
 * Declared branches that carry no value, named per state and breakpoint.
 *
 * A separate question from "does every leaf reach the stylesheet", and separate
 * for a reason. That one compares TOTALS — leaves summed over every context
 * against declarations found under the block's selector — so a property empty in
 * one context and populated in another still totals correctly and passes.
 * `border: {}` in `hover` beside a real `border` in `base` is exactly that shape.
 *
 * This one needs no stylesheet at all: an empty branch is wrong where it is
 * written, whatever its siblings emit. `declaredProperties` lists a key whatever
 * its value, so without this `border: {}` was 0 emitted of 0 expected — not
 * "fewer than expected", and it passed. Emptying `BUTTON_BASE_STYLES.border`
 * removes the reset that keeps a `<button>` and an `<a>` the same shape, and
 * every suite stayed green.
 */
function emptyDeclarations(styles: NodeStyles): string[] {
  const empty: string[] = [];
  for (const [state, byBreakpoint] of Object.entries(styles)) {
    if (byBreakpoint === undefined) continue;
    for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
      if (values === undefined) continue;
      for (const [property, value] of Object.entries(
        values as Record<string, unknown>
      )) {
        for (const branch of emptyBranches(value, property)) {
          empty.push(`${branch} at ${state}/${breakpoint}`);
        }
      }
    }
  }
  return empty;
}

function leafCount(styles: NodeStyles, property: string): number {
  let total = 0;
  for (const byBreakpoint of Object.values(styles)) {
    if (byBreakpoint === undefined) continue;
    for (const values of Object.values(byBreakpoint)) {
      if (values === undefined) continue;
      if (!(property in values)) continue;
      total += countLeaves((values as Record<string, unknown>)[property]);
    }
  }
  return total;
}

/**
 * How many declarations inside THIS block's rule belong to the given css
 * property — its own expansions, and not a SIBLING property whose name happens
 * to extend it.
 *
 * `borderRadius` compiles to `border-radius`, which a plain `border-` prefix
 * counts as one of `border`'s own leaves. On `core/button` that inflated five
 * expected border declarations to six matches, so a border side that stopped
 * compiling still reached the expected count and the case passed while a
 * default it names was absent. Sibling properties the block also declares are
 * therefore subtracted by name.
 *
 * Scoped to the rule carrying the block's own selector, because the compiled
 * sheet holds every block in the document — a `padding` counted from a
 * neighbouring rule would report this block's as present.
 */
function declarationsFor(
  css: string,
  selector: string,
  cssName: string,
  siblings: readonly string[]
): number {
  const rules = css
    .split("}")
    .filter(rule => rule.includes(`.${selector}`))
    .join("}");
  const count = (name: string, expanded: boolean): number => {
    const tail = expanded ? "(-[a-z-]+)?" : "";
    return [
      ...rules.matchAll(new RegExp(`(^|[;{\\s])${name}${tail}\\s*:`, "g")),
    ].length;
  };
  const owned = siblings
    .filter(other => other !== cssName && other.startsWith(`${cssName}-`))
    .reduce((total, other) => total + count(other, true), 0);
  return count(cssName, true) - owned;
}

function cssNameOf(property: string): string {
  return property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/**
 * A document holding one instance of the block, nested where it must be.
 *
 * A block declaring `parent` is meaningless at the page root, and `core/column`
 * is exactly that — so placing every block at the root would compile the
 * column's default from a document the engine has reason to reject. The parent
 * is read off the block itself rather than listed here, so this keeps working
 * for the next block that confines itself.
 */
function documentFor(block: AnyBlockDefinition): BlockDocument {
  const target: BlockNode = {
    id: "target",
    type: block.name,
    version: block.version,
    props: {},
  };
  const parentName = block.parent?.[0];
  if (parentName === undefined) {
    return { formatVersion: 1, kind: "page", nodes: [target] };
  }
  const parent = (coreBlocks as AnyBlockDefinition[]).find(
    candidate => candidate.name === parentName
  );
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "parent",
        type: parentName,
        version: parent?.version ?? 1,
        props: {},
        slots: { children: [target] },
      },
    ],
  };
}

/** The stylesheet the renderer would emit for a page holding this block. */
function compiledCss(block: AnyBlockDefinition): string {
  const resolver: BlockResolver = {
    get: (name: string) =>
      (coreBlocks as AnyBlockDefinition[]).find(
        candidate => candidate.name === name
      ) as never,
  };
  // A style context is REQUIRED: `resolvePageStyles` compiles only under
  // `if (styleContext)` and returns empty css otherwise, which would report
  // every working default in the library as missing.
  //
  // `blockBases` is deliberately OMITTED so `blockBasesFor` DERIVES it from the
  // definitions. Supplying it would hand the compiler this file's own literal
  // and assert nothing about what the blocks declare.
  return (
    resolvePageStyles(
      documentFor(block),
      undefined,
      {
        breakpoints: {
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        },
      },
      resolver
    ).css ?? ""
  );
}

describe("every default the core library declares", () => {
  it("is declared by the blocks this file expects to inspect", () => {
    // The population assertion. Every case below is `it.each` over `DECLARING`,
    // so a filter that matched nothing would run zero cases and the file would
    // pass having inspected nothing at all.
    expect(DECLARING.map(block => block.name).sort()).toEqual([
      "core/accordion",
      "core/button",
      "core/card",
      "core/column",
      "core/columns",
      "core/divider",
      "core/embed",
      "core/form",
      "core/gallery",
      "core/image",
      "core/list",
      "core/quote",
      "core/spacer",
    ]);
  });

  it.each(DECLARING.map(block => [block.name, block] as const))(
    "%s declares only properties STYLE_CATALOG knows",
    (name, block) => {
      const declared = declaredProperties(block.baseStyles as NodeStyles);

      // Without this, a block whose `baseStyles` walked to nothing would report
      // no unknown properties and read exactly like a correct one.
      expect(declared.length, `${name} declared no properties`).toBeGreaterThan(
        0
      );

      expect(
        declared.filter(property => getStyleProperty(property) === undefined),
        `${name} declares a property the compiler does not know. It will be ` +
          `DROPPED silently rather than passed through, so the default has no ` +
          `effect. Note the catalog has flex CONTAINER properties and no flex ` +
          `ITEM properties at all.`
      ).toEqual([]);
    }
  );

  it("inspects every part that declares defaults", () => {
    /*
     * The population control for the case below. Without it, a walk that
     * returned nothing — a renamed `parts` field, a changed shape — would leave
     * the next assertion green while checking no part at all.
     */
    expect(
      DECLARING_PARTS.map(([block, part]) => `${block}#${part}`).sort()
    ).toEqual([
      "core/form#control",
      "core/form#submit",
      "core/image#caption",
      "core/quote#attribution",
      "core/quote#quotation",
    ]);
  });

  it.each(DECLARING_PARTS)(
    "%s part %s declares only properties STYLE_CATALOG knows",
    (name, part, styles) => {
      const declared = declaredProperties(styles);
      expect(
        declared.length,
        `${name} part ${part} declared no properties`
      ).toBeGreaterThan(0);
      expect(
        declared.filter(property => getStyleProperty(property) === undefined),
        `${name} part ${part} declares a property the compiler does not know. ` +
          `It will be DROPPED silently rather than passed through, so the ` +
          `default has no effect — and a part is markup an author cannot ` +
          `reach with a style control, so nobody can put it back. Note the ` +
          `catalog has flex and grid CONTAINER properties and no ITEM ` +
          `properties at all.`
      ).toEqual([]);
    }
  );

  it.each(DECLARING.map(block => [block.name, block] as const))(
    "%s declares no property with an empty value",
    (name, block) => {
      const empty = emptyDeclarations(block.baseStyles as NodeStyles);
      expect(
        empty,
        `${name} declares ${empty.join(", ")} with no value at all, which ` +
          `emits nothing while reading as a default the block carries.`
      ).toEqual([]);
    }
  );

  it.each(DECLARING_PARTS)(
    "%s part %s declares no property with an empty value",
    (name, part, styles) => {
      const empty = emptyDeclarations(styles);
      expect(
        empty,
        `${name} part ${part} declares ${empty.join(", ")} with no value at ` +
          `all — and a part is markup an author cannot reach with a style ` +
          `control, so nobody can put the missing default back.`
      ).toEqual([]);
    }
  );

  it("REPORTS an empty declaration, in one context beside a populated one", () => {
    /*
     * The positive control, and it is load-bearing rather than decorative:
     * every default in the library has at least one leaf, so the cases above
     * pass by finding nothing and would go on passing if `emptyDeclarations`
     * were deleted, returned early, or stopped descending.
     *
     * The fixture puts the empty composite in `hover` BESIDE a populated one in
     * `base`, which is the shape a totals comparison cannot see: the leaves sum
     * correctly, the declarations are all found, and the hover border is still
     * missing.
     */
    expect(
      emptyDeclarations({
        base: { base: { border: { style: "solid" } } },
        hover: { base: { border: {} } },
      } as NodeStyles)
    ).toEqual(["border at hover/base"]);

    /*
     * And the NESTED shape, which counting leaves cannot reach: the surviving
     * `style` keeps the total nonzero, and the emitted-versus-expected check
     * agrees with itself because both sides fall together. This is what
     * removing all four of the form control's border widths actually leaves.
     */
    expect(
      emptyDeclarations({
        base: {
          base: {
            border: {
              width: {},
              style: "solid",
              color: { $token: "color.border-strong" },
            },
          },
        },
      } as NodeStyles)
    ).toEqual(["border.width at base/base"]);

    // Must-differ: a populated declaration is silent, so the control is about
    // emptiness rather than about `border` being unreadable.
    expect(
      emptyDeclarations({
        base: { base: { border: { style: "solid" } } },
      } as NodeStyles)
    ).toEqual([]);
  });

  it.each(DECLARING_PARTS)(
    "%s part %s reaches the compiled stylesheet, property by property",
    (name, part, styles) => {
      /*
       * The second failure mode, which the membership case above cannot see: a
       * catalog property is STILL dropped when its value does not match the
       * grammar the catalog declares for it. The root styles have had this
       * check since they had the first one; parts had neither.
       */
      const block = (coreBlocks as AnyBlockDefinition[]).find(
        candidate => candidate.name === name
      ) as AnyBlockDefinition;
      const css = compiledCss(block);
      const selector = blockPartClassName(name, part);
      expect(css, `nothing was emitted for ${name} part ${part}`).toContain(
        selector
      );
      const declared = declaredProperties(styles);
      const expected = declared.map(property => ({
        property,
        leaves: leafCount(styles, property),
        emitted: declarationsFor(
          css,
          selector,
          cssNameOf(property),
          declared.map(cssNameOf)
        ),
      }));
      expect(
        expected.length,
        `${name} part ${part} declared no property to check`
      ).toBeGreaterThan(0);
      // A property declared with no value at all is a separate question, asked
      // per context by `emptyDeclarations` — this one is about leaves that went
      // in and did not come out.
      const missing = expected
        .filter(({ leaves, emitted }) => emitted < leaves)
        .map(
          ({ property, leaves, emitted }) =>
            `${property} (${emitted} of ${leaves} emitted)`
        );
      expect(
        missing,
        `${name} part ${part} declares ${missing.join(", ")} but the compiled ` +
          `stylesheet does not carry every leaf. A part is markup an author ` +
          `cannot reach with a style control, so a default dropped here is ` +
          `one nobody can put back.`
      ).toEqual([]);
    }
  );

  it.each(DECLARING.map(block => [block.name, block] as const))(
    "%s reaches the compiled stylesheet, property by property",
    (name, block) => {
      const css = compiledCss(block);
      const selector = blockTypeClassName(name);

      // Tied to THIS block's own selector. Non-empty CSS alone is satisfied by
      // any other block in the document — `core/column` is compiled inside
      // `core/columns`, which declares defaults of its own, so a column that
      // compiled to nothing would still see a populated stylesheet.
      expect(css, `nothing was emitted for ${name}`).toContain(selector);

      // A catalog property can still be DROPPED for a value whose grammar the
      // compiler refuses, and the membership check above cannot see that. Each
      // declared property is looked for by its own CSS name.
      const declared = declaredProperties(block.baseStyles as NodeStyles);

      // Checked by COUNT rather than by presence, for both shapes. One needle
      // of `padding-` is satisfied by any surviving side, so a
      // `padding.inlineStart` the compiler refused would hide behind the
      // `padding.blockEnd` beside it and the case would stay green while a
      // default it names is silently absent.
      //
      // A SCALAR is counted the same way, and used to be pinned at 1 on the
      // reasoning that one value compiles to one declaration. That holds per
      // state, not per property: `backgroundColor` in `base` and again in
      // `hover` is two declarations, both inside a rule carrying this block's
      // selector, so an expectation of 1 is satisfied by the base declaration
      // alone and a refused hover value is invisible. No default declares a
      // second state today, which is exactly why the shortcut looked sound —
      // it would have failed open on the first one that did. `leafCount`
      // already sums across every state and breakpoint, so it is simply asked.
      //
      // Counting sidesteps having to predict the expanded NAMES, which are not
      // a join of the path — `border.width.blockStart` compiles to
      // `border-block-start-width`, not `border-width-block-start`. How many
      // leaves went in is knowable without knowing what each one is called.
      const expected = declared.map(property => {
        const cssName = cssNameOf(property);
        return {
          property,
          leaves: leafCount(block.baseStyles as NodeStyles, property),
          emitted: declarationsFor(
            css,
            selector,
            cssName,
            declared.map(cssNameOf)
          ),
        };
      });

      // The population assertion for THIS case: a block that declared nothing
      // at all would check nothing and pass.
      expect(
        expected.length,
        `${name} declared no property to check`
      ).toBeGreaterThan(0);

      // A property declared with no value at all is a separate question, asked
      // per context by `emptyDeclarations` — this one is about leaves that went
      // in and did not come out.
      const missing = expected
        .filter(({ leaves, emitted }) => emitted < leaves)
        .map(
          ({ property, leaves, emitted }) =>
            `${property} (${emitted} of ${leaves} emitted)`
        );
      expect(
        missing,
        `${name} declares ${missing.join(", ")} but the compiled stylesheet ` +
          `does not carry every leaf. A catalog property is still dropped when ` +
          `its VALUE does not match the grammar the catalog declares for it, ` +
          `and one refused side of an object-shaped declaration is invisible ` +
          `beside the sides that survived.`
      ).toEqual([]);
    }
  );
});

describe("a token a default depends on must be one the site set defines", () => {
  /**
   * **This REPLACES a ratchet that forbade tokens outright**, and the swap is the
   * point rather than a relaxation.
   *
   * That ratchet existed because nothing emitted token CSS: `compileSiteSheet`
   * had no consumers, so `{ $token }` compiled to a `var()` with nothing behind
   * it and three shipped blocks rendered with their children touching. Its
   * stated expiry was "when the site stylesheet is wired into the render path",
   * and both render paths now emit it — a route by default and `PageRenderer` by
   * default. So it is deleted by the change that met its condition, exactly as
   * written, rather than weakened or exempted per block.
   *
   * What replaces it is the question that actually matters now. A token is only
   * as good as its DEFINITION: a default naming `color.nonesuch` compiles to a
   * `var()` that dangles for the same reason the old defect did, and neither the
   * catalog check nor the compiled-CSS check above can see it — the property is
   * legitimate and the declaration reaches the stylesheet carrying a `var()`
   * nobody defined.
   */
  /*
   * The KIND question, asked of the ENGINE'S OWN VALIDATOR rather than of a
   * union computed here.
   *
   * This was `tokenKindsForProperty(property)`, which returns the union across a
   * composite property's leaves. For `border` that union is `dimension | color`,
   * so a COLOUR token written into `border.width.blockStart` was accepted — the
   * property does take a colour, at a different leaf. Verified: that mutation
   * passed all 100 tests in these two suites.
   *
   * `validateStyleValues` answers this per LEAF, and refuses both an unknown
   * token and a kind the leaf does not take. It is asked DIRECTLY rather than
   * through `compileStyleValues`, which was the first attempt and reported
   * nothing: the compiler keeps only `severity === "error"` issues to decide
   * what to refuse, and a kind mismatch is a WARNING, so it emitted
   * `border-block-start-width: var(--site-color-border-strong)` with an empty
   * warnings list. Measured, which is why the control below exists.
   *
   * That is also why no production check catches this: the validator has the
   * answer, the compiler discards it, and a block default is compiled without a
   * token table in the first place.
   *
   * Consuming the owning module rather than restating it also retires the walker
   * this file used to carry: a second traversal of the catalog's shapes, living
   * in a test, is the drift this replaces.
   */
  const GUARANTEED_TOKENS: TokenLookup = {
    kindOf: name =>
      defaultSiteTokens().find(token => token.name === name)?.kind,
  };

  /** The validator's token complaints about ONE state/breakpoint's values. */
  function tokenIssuesAt(
    values: Readonly<Record<string, unknown>>,
    path: string
  ): string[] {
    return validateStyleValues(
      values,
      path,
      "strict",
      undefined,
      false,
      GUARANTEED_TOKENS
    )
      .filter(
        issue =>
          issue.code === "token-kind-mismatch" || issue.code === "unknown-token"
      )
      .map(issue => `${issue.path}: ${issue.message}`);
  }

  /** Every token complaint the VALIDATOR makes about one style envelope. */
  function tokenIssues(styles: NodeStyles): string[] {
    const issues: string[] = [];
    for (const [state, byBreakpoint] of Object.entries(styles)) {
      if (byBreakpoint === undefined) continue;
      for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
        if (values === undefined) continue;
        issues.push(...tokenIssuesAt(values, `${state}/${breakpoint}`));
      }
    }
    return issues;
  }

  it.each(DECLARING.map(block => [block.name, block] as const))(
    "%s writes each token at a leaf that accepts it",
    (name, block) => {
      expect(
        tokenIssues(block.baseStyles as NodeStyles),
        `${name} writes a token the compiler refuses at that leaf, so the ` +
          `declaration reaches the stylesheet carrying a var() the browser drops.`
      ).toEqual([]);
    }
  );

  it.each(DECLARING_PARTS)(
    "%s part %s writes each token at a leaf that accepts it",
    (name, part, styles) => {
      expect(
        tokenIssues(styles),
        `${name} part ${part} writes a token the compiler refuses at that leaf ` +
          `— and a part is markup an author cannot reach with a style control, ` +
          `so nobody can put the dropped declaration back.`
      ).toEqual([]);
    }
  );

  it("REPORTS a token written at a leaf that does not accept it", () => {
    /*
     * The control. Every case above passes by finding nothing, so a compile
     * that reported nothing at all — a missing token table, a renamed warning
     * code — would leave them all green having checked no leaf.
     *
     * `border.width` takes a dimension and `color.border-strong` is a colour,
     * which is the exact mutation that defeated the union form of this check.
     */
    expect(
      tokenIssues({
        base: {
          base: {
            border: {
              width: { blockStart: { $token: "color.border-strong" } },
            },
          },
        },
      } as NodeStyles)
    ).not.toEqual([]);

    // And the same leaf with the RIGHT kind is silent, so the control is about
    // the kind rather than about `border` being unreadable.
    expect(
      tokenIssues({
        base: { base: { border: { width: { blockStart: "1px" } } } },
      } as NodeStyles)
    ).toEqual([]);
  });

  it("REPORTS a token the guaranteed set does not define", () => {
    /*
     * The other half of what this check inherited. A separate membership walk
     * used to answer this — a `tokenNamesIn` traversal compared against a
     * `Set` of names — and two guards answering one question drift as
     * traversal or resolution changes. The validator answers both from one
     * implementation, so the membership walk is gone and its control lives
     * here.
     */
    expect(
      tokenIssues({
        base: { base: { backgroundColor: { $token: "color.nonesuch" } } },
      } as NodeStyles)
    ).not.toEqual([]);

    // Must-differ: a token the set DOES define is silent, so this is about the
    // name rather than about every token reference being reported.
    expect(
      tokenIssues({
        base: { base: { backgroundColor: { $token: "color.surface" } } },
      } as NodeStyles)
    ).toEqual([]);
  });
});
