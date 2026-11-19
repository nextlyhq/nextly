import { describe, expect, it } from "vitest";

import {
  cssTextProperties,
  remapTokenReferences,
  type TokenRemap,
} from "./token-remap";

/** A file written under `--acme-`, read on a site writing `--site-`. */
const acme: TokenRemap = {
  ids: new Map([["color.brand", "color.brand-2"]]),
  identities: ["color.brand", "space.m"],
  from: "--acme-",
  to: "--site-",
};

describe("remapTokenReferences", () => {
  it("points a $token and a var() of the file's variable at the id and prefix here", () => {
    expect(
      remapTokenReferences(
        {
          color: { $token: "color.brand" },
          boxShadow: "0 0 4px var(--acme-color-brand)",
          gap: ["var(--acme-space-m)", "var( --acme-space-m, 8px)"],
        },
        acme
      )
    ).toEqual({
      color: { $token: "color.brand-2" },
      boxShadow: "0 0 4px var(--site-color-brand-2)",
      gap: ["var(--site-space-m)", "var( --site-space-m, 8px)"],
    });
  });

  it("points CSS text, such as custom CSS, the same way", () => {
    expect(
      remapTokenReferences(
        "selector { color: var(--acme-color-brand); margin: var(--acme-space-m) }",
        acme
      )
    ).toBe(
      "selector { color: var(--site-color-brand-2); margin: var(--site-space-m) }"
    );
  });

  it("leaves a property the file's variables aren't written under, and one they begin", () => {
    const text =
      "var(--acme-color-brand-dark) var(--acme-other) var(--site-space-m) --acme-space-m";
    expect(remapTokenReferences(text, acme)).toBe(text);
  });

  it("points each reference once, never along a chain of renames", () => {
    const swap: TokenRemap = {
      ids: new Map([
        ["a", "b"],
        ["b", "c"],
      ]),
      identities: ["a", "b"],
      from: "--site-",
      to: "--site-",
    };
    expect(
      remapTokenReferences(
        { x: "var(--site-a) var(--site-b)", y: { $token: "a" } },
        swap
      )
    ).toEqual({ x: "var(--site-b) var(--site-c)", y: { $token: "b" } });
  });
});

describe("cssTextProperties", () => {
  it("names each property CSS text reads through var(), as the remap matches it", () => {
    expect([
      ...cssTextProperties(
        "selector { color: var(--site-color-brand); margin: var( --site-space-m, 4px) } .x { gap: var(--Other) }"
      ),
    ]).toEqual(["--site-color-brand", "--site-space-m"]);
  });

  it("names nothing in text with no var()", () => {
    expect(cssTextProperties("selector { --site-color-brand: red }").size).toBe(0);
  });
});
