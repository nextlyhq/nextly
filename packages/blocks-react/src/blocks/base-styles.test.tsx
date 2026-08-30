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
  blockTypeClassName,
  defaultSiteTokens,
  getStyleProperty,
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
 * property name, which is what {@link isScalarDeclaration} confines this to.
 */
function cssNameOf(property: string): string {
  return property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/**
 * Whether every declaration of a property is a single value rather than a
 * per-side or per-corner object.
 *
 * An object-shaped declaration compiles to SEVERAL css properties with names of
 * their own — `borderRadius` given corners emits `border-start-start-radius`
 * and its three siblings, none of which is the kebab-case of `borderRadius`. So
 * those are excluded from the name check rather than checked wrongly; the
 * membership assertion still covers them, and a token reference stays IN,
 * because it compiles to one `var()` under the property's own name.
 */
function isScalarDeclaration(styles: NodeStyles, property: string): boolean {
  for (const byBreakpoint of Object.values(styles)) {
    if (byBreakpoint === undefined) continue;
    for (const values of Object.values(byBreakpoint)) {
      if (values === undefined) continue;
      if (!(property in values)) continue;
      const value: unknown = (values as Record<string, unknown>)[property];
      const isObject = typeof value === "object" && value !== null;
      const isToken =
        isObject && typeof (value as { $token?: unknown }).$token === "string";
      if (isObject && !isToken) return false;
    }
  }
  return true;
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
      "core/form",
      "core/gallery",
      "core/image",
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
      const scalars = declaredProperties(block.baseStyles as NodeStyles).filter(
        property =>
          isScalarDeclaration(block.baseStyles as NodeStyles, property)
      );

      // The population assertion for THIS case: a block whose declarations were
      // all object-shaped would check nothing and pass.
      expect(
        scalars.length,
        `${name} declared no scalar-valued property to check`
      ).toBeGreaterThan(0);

      const missing = scalars.filter(
        property => !css.includes(`${cssNameOf(property)}:`)
      );
      expect(
        missing,
        `${name} declares ${missing.join(", ")} but the compiled stylesheet ` +
          `does not carry it. A catalog property is still dropped when its ` +
          `VALUE does not match the grammar the catalog declares for it.`
      ).toEqual([]);
    }
  );
});

/**
 * Every token reference a `NodeStyles` makes, at any depth.
 *
 * Walked to the leaf rather than read one level down: a token may sit inside an
 * object-shaped declaration — a per-corner radius, a per-side border colour —
 * and a check that only inspected top-level values would report those clean.
 */
function tokenNamesIn(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.$token === "string") return [record.$token];
  return Object.values(record).flatMap(tokenNamesIn);
}

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
  it.each(DECLARING.map(block => [block.name, block] as const))(
    "%s names only tokens the guaranteed set defines",
    (name, block) => {
      const guaranteed = new Set(defaultSiteTokens().map(token => token.name));
      const named = tokenNamesIn(block.baseStyles);

      // A block naming no token passes vacuously, which is correct — but the
      // population is asserted below so this file cannot pass having inspected
      // nothing.
      const undefinedTokens = named.filter(token => !guaranteed.has(token));

      expect(
        undefinedTokens,
        `${name} depends on ${undefinedTokens.join(", ")}, which no guaranteed ` +
          `token defines. The reference compiles to a var() with nothing behind ` +
          `it, so the property silently falls back to its initial value — the ` +
          `same failure as the tokens nothing emitted, one level in.`
      ).toEqual([]);
    }
  );

  it("inspects at least one block that DOES depend on a token", () => {
    // The population control. Every case above passes by finding nothing, so a
    // library that stopped using tokens entirely — or a walker that returned
    // nothing — would leave the whole describe green while checking no token at
    // all. `core/card` is the reason this check exists.
    const withTokens = DECLARING.filter(
      block => tokenNamesIn(block.baseStyles).length > 0
    ).map(block => block.name);

    expect(withTokens).toContain("core/card");
  });

  it("detects a token reference at any depth, including inside an object", () => {
    // The walker's own control, and the nested form is the one that matters:
    // `core/card`'s border colour sits INSIDE an object-shaped declaration, so a
    // shallow reader would report it clean.
    expect(
      tokenNamesIn({ base: { base: { gap: { $token: "space.4" } } } })
    ).toEqual(["space.4"]);
    expect(
      tokenNamesIn({
        base: { base: { border: { color: { $token: "color.border" } } } },
      })
    ).toEqual(["color.border"]);
  });
});
