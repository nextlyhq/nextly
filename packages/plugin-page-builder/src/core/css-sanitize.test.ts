import { describe, it, expect } from "vitest";

import { sanitizeBlockCss, sanitizeCustomCss } from "./css-sanitize";

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

  it("cannot end the style element it is emitted into", () => {
    // The property that matters, stated directly. An earlier version of this
    // test asserted that the text "<script" was absent, which described how the
    // sanitizer happened to work rather than what it guarantees: it stripped
    // four literal tag spellings and did nothing about `<img onerror=…>`.
    //
    // Nothing can close the element now, so markup left in the text is inert:
    // inside a `<style>`, only `</style` ends the raw-text run. `<` is not
    // escaped wholesale because `@media (400px<width)` is valid CSS and
    // escaping there would break the query.
    const out = sanitizeCustomCss(
      ".hero { color: red } </style><script>alert(1)</script>",
      SCOPE
    );
    expect(out).not.toContain("</style");
    expect(out).not.toContain("</script");
    expect(out).toContain(`.${SCOPE} .hero`);
  });

  it("escapes markup an author hid behind a CSS escape", () => {
    // `csstree.generate` decodes escapes, so this reaches the page as literal
    // `</style>` even though the source contains no markup. Filtering the input
    // cannot see it; only the generated text can.
    const out = sanitizeCustomCss(
      `.a { content: "\\3c /style>\\3c img src=x onerror=alert(1)>" }`,
      SCOPE
    );
    expect(out).not.toContain("</style");
    expect(out).toContain("\\3c /style>");
  });

  it("keeps an escaped sequence meaning the same thing", () => {
    // `\3c` and `<` are one character to a CSS parser, so the author still gets
    // what they wrote; only the bytes the HTML parser sees change.
    expect(sanitizeCustomCss(`.a { content: "</div>" }`, SCOPE)).toContain(
      `content:"\\3c /div>"`
    );
  });

  it("leaves the angle brackets that valid CSS needs", () => {
    expect(sanitizeCustomCss(".a > .b { color: red }", SCOPE)).toContain(
      ".b{color:red}"
    );
    const range = sanitizeCustomCss(
      "@media (400px < width < 800px) { .a { color: red } }",
      SCOPE
    );
    expect(range).toContain("400px < width < 800px");
  });

  it("scopes a rule without rewriting what is inside a pseudo-class", () => {
    // `:not()`, `:is()` and `:has()` hold selectors of their own. Prefixing
    // those asks a different question than the author did: `.a:has(> .b)`
    // scoped inside becomes `.a:has(.scope > .b)`, which no longer means "has a
    // child .b".
    expect(sanitizeCustomCss(".a:not(.b) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:not(.b){color:red}`
    );
    expect(sanitizeCustomCss(".a:is(.b, .c) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:is(.b,.c){color:red}`
    );
    expect(sanitizeCustomCss(".a:has(> .b) { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a:has(>.b){color:red}`
    );
  });

  it("scopes every part of a selector list", () => {
    expect(sanitizeCustomCss(".a, .b { color: red }", SCOPE)).toBe(
      `.${SCOPE} .a,.${SCOPE} .b{color:red}`
    );
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

describe("sanitizeBlockCss", () => {
  it("rewrites the `selector` keyword to the block scope class", () => {
    const out = sanitizeBlockCss("selector { color: red; }", "nx-pb-abc");
    expect(out).toContain(".nx-pb-abc");
    expect(out).toContain("color:red");
    expect(out).not.toMatch(/(^|[^-.])selector\b/);
  });

  it("scopes descendant selectors under the block", () => {
    const out = sanitizeBlockCss(
      "selector .title { font-weight: 700; }",
      "nx-pb-abc"
    );
    expect(out).toContain(".nx-pb-abc");
    expect(out).toContain(".title");
  });

  it("scopes a bare selector under the block too", () => {
    const out = sanitizeBlockCss("p { margin: 0; }", "nx-pb-abc");
    expect(out).toMatch(/\.nx-pb-abc\s+p/);
  });

  it("drops dangerous declarations", () => {
    const out = sanitizeBlockCss(
      "selector { background: url(javascript:alert(1)); }",
      "nx-pb-abc"
    );
    expect(out).not.toContain("javascript");
  });

  it("does not double-scope a selector already prefixed with the block class", () => {
    const out = sanitizeBlockCss("selector { color: red; }", "nx-pb-abc");
    expect(out).not.toMatch(/\.nx-pb-abc\s+\.nx-pb-abc/);
  });
});
