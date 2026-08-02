import { describe, expect, it } from "vitest";

import { getStyleProperty } from "./catalog";
import { isStyleLeaf } from "./catalog-types";
import type { UrlLeaf } from "./catalog-types";
import { compileStyleValues, urlText } from "./declarations";

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
