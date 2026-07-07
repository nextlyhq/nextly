import { describe, it, expect } from "vitest";

import { sanitizeCustomCss } from "./css-sanitize";

const SCOPE = "nx-pb-page-abc";

describe("sanitizeCustomCss", () => {
  it("scopes a simple rule under the page root", () => {
    const out = sanitizeCustomCss(".hero { color: red }", SCOPE);
    expect(out).toContain(`.${SCOPE} .hero`);
    expect(out).toContain("color:red");
  });

  it("drops declarations with javascript: / expression()", () => {
    const js = sanitizeCustomCss(
      ".a { background: url(javascript:alert(1)) }",
      SCOPE
    );
    expect(js.toLowerCase()).not.toContain("javascript:");
    const expr = sanitizeCustomCss(".a { width: expression(alert(1)) }", SCOPE);
    expect(expr.toLowerCase()).not.toContain("expression(");
  });

  it("strips @import", () => {
    const out = sanitizeCustomCss(
      '@import url("evil.css"); .a { color: red }',
      SCOPE
    );
    expect(out.toLowerCase()).not.toContain("@import");
    expect(out).toContain(`.${SCOPE} .a`);
  });

  it("strips raw </style> and <script> tags", () => {
    const out = sanitizeCustomCss(
      ".hero { color: red } </style><script>alert(1)</script>",
      SCOPE
    );
    expect(out).not.toContain("</style");
    expect(out).not.toContain("<script");
    expect(out).toContain(`.${SCOPE} .hero`);
  });

  it("preserves @media and scopes the rules inside it", () => {
    const out = sanitizeCustomCss(
      "@media (max-width: 640px) { .a { color: red } }",
      SCOPE
    );
    expect(out).toContain("@media");
    expect(out).toContain(`.${SCOPE} .a`);
  });

  it("does not throw on malformed CSS and still scopes recoverable rules", () => {
    const out = sanitizeCustomCss(".a { color: red }}} .b { x: 1 }", SCOPE);
    expect(typeof out).toBe("string");
    expect(out).toContain(`.${SCOPE}`);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeCustomCss("", SCOPE)).toBe("");
  });
});
