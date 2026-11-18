/**
 * A block's custom CSS scoped to the block: the author writes `selector` where
 * the block goes, and the compile puts the block's own selector there. The
 * stored CSS keeps `selector`, so a copied, moved or exported block carries
 * CSS that still scopes to wherever it lands.
 */
import { describe, expect, it } from "vitest";

import { scopeBlockCss } from "./custom-css-scope";

const BLOCK = ".nx-pb-page.nx-pb-page .nx-n-abc";

/** The scoped CSS, failing the test with the refusals if there were any. */
function scoped(css: string): string {
  const result = scopeBlockCss(css, BLOCK);
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.refusals)}`);
  }
  return result.css;
}

describe("scopeBlockCss", () => {
  it("puts the block's selector where `selector` is", () => {
    expect(scoped("selector { border: 4px solid blue; }")).toBe(
      `${BLOCK} { border: 4px solid blue; }`
    );
  });

  it("keeps a state and a descendant after it", () => {
    expect(scoped("selector:hover { color: red; }")).toBe(
      `${BLOCK}:hover { color: red; }`
    );
    expect(scoped("selector h2 { margin: 0; }")).toBe(
      `${BLOCK} h2 { margin: 0; }`
    );
  });

  it("scopes every selector of a list", () => {
    expect(scoped("selector a, selector:focus-within { outline: 0; }")).toBe(
      `${BLOCK} a, ${BLOCK}:focus-within { outline: 0; }`
    );
  });

  it("scopes rules inside @media, @supports and @container, nested too", () => {
    const css = [
      "@media (min-width: 40em) {",
      "  @supports (display: grid) { selector { display: grid; } }",
      "  selector p { font-size: 1.25rem; }",
      "}",
      "@container (min-width: 20em) { selector { gap: 1rem; } }",
    ].join("\n");
    expect(scoped(css)).toBe(
      [
        "@media (min-width: 40em) {",
        `  @supports (display: grid) { ${BLOCK} { display: grid; } }`,
        `  ${BLOCK} p { font-size: 1.25rem; }`,
        "}",
        `@container (min-width: 20em) { ${BLOCK} { gap: 1rem; } }`,
      ].join("\n")
    );
  });

  it("leaves everything but the selectors as the author wrote it", () => {
    const css =
      "selector{color:red}\n/* a note */\nselector  em { font-style: normal }";
    expect(scoped(css)).toBe(
      `${BLOCK}{color:red}\n/* a note */\n${BLOCK}  em { font-style: normal }`
    );
  });

  it("refuses a rule that does not start from `selector`, naming its line", () => {
    const result = scopeBlockCss(
      "selector { color: red; }\n\nh2 { color: blue; }",
      BLOCK
    );
    expect(result).toEqual({
      ok: false,
      refusals: [
        { line: 3, reason: "A rule in a block's CSS starts with selector." },
      ],
    });
  });

  it("refuses one selector of a list that does not start from `selector`", () => {
    const result = scopeBlockCss("selector, body { color: red; }", BLOCK);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0]?.line).toBe(1);
  });

  it("refuses `selector` written later in a selector rather than first", () => {
    expect(scopeBlockCss("main selector { color: red; }", BLOCK).ok).toBe(
      false
    );
  });

  it.each(["selector + p", "selector ~ *", "selector:hover + p"])(
    "refuses %s, which reaches past the block to its neighbours",
    rule => {
      expect(scopeBlockCss(`${rule} { color: red; }`, BLOCK)).toEqual({
        ok: false,
        refusals: [
          {
            line: 1,
            reason:
              "A rule in a block's CSS can't reach the blocks beside it (+ or ~).",
          },
        ],
      });
    }
  );

  it("keeps a child combinator, which stays inside the block", () => {
    expect(scoped("selector > a { color: red; }")).toBe(
      `${BLOCK} > a { color: red; }`
    );
  });

  it("keeps a sibling step taken inside the block", () => {
    // `h2 + p` is two elements both inside the block: the step that left the
    // block's own element was the descendant one.
    expect(scoped("selector h2 + p { margin: 0; }")).toBe(
      `${BLOCK} h2 + p { margin: 0; }`
    );
    expect(scoped("selector > a ~ b { color: red; }")).toBe(
      `${BLOCK} > a ~ b { color: red; }`
    );
  });

  it("refuses a rule inside @media that does not start from `selector`", () => {
    const result = scopeBlockCss(
      "@media print {\n  selector { color: black; }\n  p { color: gray; }\n}",
      BLOCK
    );
    expect(result).toEqual({
      ok: false,
      refusals: [
        { line: 3, reason: "A rule in a block's CSS starts with selector." },
      ],
    });
  });

  it("refuses an at-rule a block's CSS cannot scope, naming it and its line", () => {
    const result = scopeBlockCss(
      "selector { color: red; }\n@font-face { font-family: X; }",
      BLOCK
    );
    expect(result).toEqual({
      ok: false,
      refusals: [
        { line: 2, reason: "@font-face isn't allowed in a block's CSS." },
      ],
    });
  });

  it("scopes nothing in empty CSS", () => {
    expect(scoped("")).toBe("");
    expect(scoped("  /* nothing */ ")).toBe("  /* nothing */ ");
  });
});
