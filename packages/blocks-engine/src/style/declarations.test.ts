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
