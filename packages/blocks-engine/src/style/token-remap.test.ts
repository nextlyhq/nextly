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

  it("leaves quoted strings, comments and an unquoted url() as written", () => {
    const literals = [
      'selector::after { content: "var(--acme-color-brand)"; }',
      "selector::after { content: 'say var(--acme-space-m)'; }",
      'selector { background: url("/i/var(--acme-color-brand).svg"); }',
      "selector { background: url(/i/var(--acme-color-brand).svg); }",
      "selector { background: URL(/i/var(--acme-color-brand).svg); }",
      "/* was var(--acme-color-brand) */ selector { color: red; }",
      'selector { content: "an \\"escaped var(--acme-space-m)" }',
    ];
    for (const text of literals) {
      expect(remapTokenReferences(text, acme), text).toBe(text);
      expect(cssTextProperties(text).size, text).toBe(0);
    }
    // A reference after a literal still is one.
    expect(
      remapTokenReferences(
        '/* a */ selector { content: "x"; color: var(--acme-color-brand); }',
        acme
      )
    ).toBe(
      '/* a */ selector { content: "x"; color: var(--site-color-brand-2); }'
    );
  });

  it("reads a name, and var itself, as CSS reads them: escapes decoded", () => {
    // `\72` is "r": the browser reads `--acme-color-brand` here, so the
    // reference is pointed, written plainly under this site's name.
    expect(
      remapTokenReferences(
        String.raw`selector { color: var(--acme-colo\72-brand) }`,
        acme
      )
    ).toBe("selector { color: var(--site-color-brand-2) }");
    expect(
      remapTokenReferences(String.raw`0 0 4px v\61 r(--acme-space-m)`, acme)
    ).toBe(String.raw`0 0 4px v\61 r(--site-space-m)`);
    // A fallback is read too, as the browser substitutes it.
    expect(
      remapTokenReferences(
        String.raw`var(--other, var(--acme-sp\61 ce-m))`,
        acme
      )
    ).toBe("var(--other, var(--site-space-m))");
  });

  it("points a local declaration of a carried property with its reads, so the override still holds", () => {
    expect(
      remapTokenReferences(
        "selector { --acme-color-brand: red; color: var(--acme-color-brand); }",
        acme
      )
    ).toBe(
      "selector { --site-color-brand-2: red; color: var(--site-color-brand-2); }"
    );
    // Escaped as the browser reads it, like a read.
    expect(
      remapTokenReferences(String.raw`selector { --acme-sp\61 ce-m: 2px }`, acme)
    ).toBe("selector { --site-space-m: 2px }");
    // A declaration of a property no variable in the file is written under
    // is the author's own, and stays as it is, as does its read.
    const own =
      "selector { --acme-other: red; --acme-color-brand-dark: blue; color: var(--acme-other); }";
    expect(remapTokenReferences(own, acme)).toBe(own);
    // A declaration names no variable the file carries: the export lists
    // only what the CSS reads.
    expect(
      cssTextProperties("selector { --site-color-brand: red }").size
    ).toBe(0);
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

  it("names a property by its decoded name, as the remap points it", () => {
    expect([
      ...cssTextProperties(
        String.raw`selector { color: var(--site-colo\72-brand) } .x { margin: v\61 r(--site-space-m) }`
      ),
    ]).toEqual(["--site-color-brand", "--site-space-m"]);
  });

  it("names nothing in text with no var()", () => {
    expect(cssTextProperties("selector { --site-color-brand: red }").size).toBe(0);
  });
});
