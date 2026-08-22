import { describe, expect, it } from "vitest";

import {
  CATALOG_IN_EMISSION_ORDER,
  getStyleProperty,
  STYLE_CATALOG,
} from "./catalog";
import { isStyleLeaf } from "./catalog-types";
import type { UnionShape, UrlLeaf } from "./catalog-types";
import { compileStyleValues, urlText } from "./declarations";
import { styleUnionVariant } from "./validate-style-value";

/** The union a catalog property declares, for the arm-choice tests. */
function unionShapeOf(property: string): UnionShape {
  const entry = getStyleProperty(property);
  if (entry === undefined) throw new Error(`no catalog property ${property}`);
  const shape = entry.shape;
  if (isStyleLeaf(shape) || shape.kind !== "union") {
    throw new Error(`${property} is no longer a union`);
  }
  return shape;
}

/** The url leaf `background.url` stores its value at. */
function backgroundUrlLeaf(): UrlLeaf {
  const entry = getStyleProperty("background");
  if (entry === undefined || isStyleLeaf(entry.shape)) {
    throw new Error("background is expected to be a composite");
  }
  if (entry.shape.kind !== "object")
    throw new Error("expected an object shape");
  const leaf = entry.shape.fields.url;
  if (leaf === undefined || !isStyleLeaf(leaf) || leaf.kind !== "url") {
    throw new Error("expected a url leaf");
  }
  return leaf;
}

describe("a url is written as a quoted CSS string", () => {
  it("has a url leaf to write, so the rest of this suite means something", () => {
    expect(backgroundUrlLeaf().cssProperty).toBe("background-image");
  });

  it("escapes a quote and a backslash", () => {
    const leaf = backgroundUrlLeaf();
    expect(urlText(leaf, '/a".png')).toBe('url("/a\\".png")');
    expect(urlText(leaf, "/a\\b.png")).toBe('url("/a\\\\b.png")');
  });

  it("escapes a raw line terminator, which closes a CSS string", () => {
    // Unreachable through `compileStyleValues`, which refuses the value first.
    // Escaped regardless, because a function whose job is to produce a quoted
    // CSS string should produce one for any input rather than only for the
    // inputs its current caller happens to allow.
    const leaf = backgroundUrlLeaf();
    expect(urlText(leaf, "a\nb")).toBe('url("a\\a b")');
    expect(urlText(leaf, "a\rb")).toBe('url("a\\d b")');
    expect(urlText(leaf, "a\fb")).toBe('url("a\\c b")');
  });

  it("leaves a keyword unwrapped", () => {
    expect(urlText(backgroundUrlLeaf(), "none")).toBe("none");
  });

  it("closes on nothing the value contains", () => {
    // Reached through the public entry, so this asserts what actually gets
    // written rather than what a helper would write in isolation.
    const { declarations } = compileStyleValues(
      { background: { url: "/a.png" } },
      "/styles"
    );
    expect(declarations[0]?.value).toBe('url("/a.png")');
  });
});

describe("which arm of a union a value is written through", () => {
  /*
   * ONE answer, shared with validation and with the editor. The walk used to
   * take the first arm that wrote any bytes, and `scalarText` reads no leaf
   * kind for a number — so `fontWeight: 700` was written through the KEYWORD
   * arm while the validator and the inspector both judged it under the number
   * one. That produced identical CSS, because every catalog union's arms write
   * the same property today, which is exactly why nothing caught it.
   *
   * These tests pin the choice where it is OBSERVABLE. Measured while writing
   * them: forcing the walk to the LAST arm of every union left all 1311 engine
   * tests green, so the arm the compiler picks had no coverage at all.
   */
  it("writes a scalar through the SCALAR arm, not the composite one", () => {
    // The one place the choice changes the bytes. A string handed to the
    // corners arm addresses named fields it does not have, so it places
    // nothing — the declaration would simply be missing from the stylesheet.
    const out = compileStyleValues({ borderRadius: "4px" }, "/styles");

    expect(out.declarations).toEqual([
      { property: "border-radius", value: "4px" },
    ]);
  });

  it("writes a composite through the COMPOSITE arm, not the scalar one", () => {
    // The other direction, so a walk that had simply been pinned to the second
    // arm would fail the test above and pass this one rather than passing both.
    const out = compileStyleValues(
      { borderRadius: { startStart: "4px" } },
      "/styles"
    );

    expect(out.declarations).toEqual([
      { property: "border-start-start-radius", value: "4px" },
    ]);
  });

  it("agrees with the resolver the editor draws its control from", () => {
    // The property that matters more than any single value: the compiler and
    // the editor ask ONE function. Asserted against `styleUnionVariant` rather
    // than against a table written here, because a table would be a second
    // answer to the same question, which is the defect this pins shut.
    const shape = unionShapeOf("borderRadius");

    expect(styleUnionVariant(shape, "4px")).toBe(0);
    expect(styleUnionVariant(shape, { startStart: "4px" })).toBe(1);
  });
});

describe("a union that writes nothing still explains itself", () => {
  it("keeps the objection of the arm that matched, not of the first tried", () => {
    // `borderRadius` is one scalar OR four named corners, and the two arms are
    // structurally disjoint: handed an object, the scalar arm places nothing and
    // says nothing, because an object is not a value it could have read. Only
    // the corner arm can object, so keeping the first arm's silence would return
    // neither the declaration nor the reason it is missing.
    const out = compileStyleValues(
      { borderRadius: { startStart: { $token: "not a token name!" } } },
      "/styles"
    );
    expect(out.declarations).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.warnings.map(issue => issue.path).join(" ")).toContain(
      "borderRadius"
    );
  });

  it("still keeps the FIRST objection when more than one arm can object", () => {
    // Two arms that can both read the value is the other shape of the same
    // union, and there the first objection is the one that explains it.
    const out = compileStyleValues({ borderRadius: "not a length" }, "/styles");
    expect(out.declarations).toEqual([]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });
});

describe("compiling one map directly is bounded too", () => {
  it("makes its own issue budget when a caller supplies none", () => {
    // The two-argument form is the natural way to reach this, and without a
    // budget an untrusted map produced a warning for every invalid property,
    // each repeating `basePath` — the amplification the allowance exists to
    // stop, reachable simply by not passing one.
    const values = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [
        `notAProperty${index}`,
        "1px",
      ])
    );
    const out = compileStyleValues(values, "/nodes/0/styles/base/base");
    expect(out.declarations).toEqual([]);
    expect(out.warnings.length).toBeLessThan(1_000);
  });
});

describe("the emitter walks the catalog, not the stored map", () => {
  it("carries every catalog property, so nothing stops being emitted", () => {
    // The substitution is only sound if the two walks cover the same set. A property missing from
    // this list is one the compiler silently stops writing, on every page, for every site.
    expect(
      CATALOG_IN_EMISSION_ORDER.map(entry => entry.property).sort()
    ).toEqual(STYLE_CATALOG.map(entry => entry.property).sort());
  });

  it("orders declarations by property name, whatever order they were stored in", () => {
    // Emitted output is bytes a page caches and a diff is read against, so the order has to be a
    // property of the catalog rather than of the order values happened to be stored in.
    const out = compileStyleValues(
      { width: "10px", color: "red", background: { color: "blue" } },
      "/nodes/0/styles/base/base"
    );

    const properties = out.declarations.map(d => d.property);
    expect(properties).toEqual([...properties].sort());
  });

  it("emits the same declarations with unknown keys mixed in", () => {
    // Held below the style budget on purpose: at 200 unknown properties the map is refused whole
    // and the emit walk never runs, so a larger fixture would assert nothing about this walk.
    const real = { color: "red", width: "10px" };
    const junk = Object.fromEntries(
      Array.from({ length: 150 }, (_unused, index) => [
        `notAProperty${index}`,
        "1px",
      ])
    );

    const clean = compileStyleValues(real, "/p");
    const noisy = compileStyleValues({ ...junk, ...real }, "/p");

    expect(noisy.declarations).toEqual(clean.declarations);
  });
});
