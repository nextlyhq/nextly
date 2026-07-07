import { describe, expect, it } from "vitest";

import { sanitizeCustomCss } from "./css-sanitize";

const SCOPE = "nx-pb-page";

/**
 * Adversarial custom-CSS corpus (spec §14) — complements css-sanitize.test.ts. The
 * sanitizer must never emit `@import`, script/style tags, `javascript:` urls, or let a
 * value break out of its declaration/selector into an unscoped rule.
 */
describe("custom CSS adversarial corpus", () => {
  const clean = (css: string) => sanitizeCustomCss(css, SCOPE);

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

  it("strips <script> and </style> injection attempts", () => {
    const out = clean(
      "a{color:red}</style><script>alert(1)</script><style>b{}"
    ).toLowerCase();
    expect(out).not.toContain("<script");
    expect(out).not.toContain("</style");
  });

  it("returns a string (never throws) on deeply malformed input", () => {
    expect(typeof clean("a { b { c { d { color: }}}} ) ( @@ !!")).toBe(
      "string"
    );
  });
});
