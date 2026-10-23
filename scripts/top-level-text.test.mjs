// What topLevelOnly keeps and blanks. Each case is a token whose text can hold a
// bracket that is not one; reading that bracket as real moves the depth, which
// either hides a top-level declaration or exposes a nested one.
import { describe, expect, it } from "vitest";

import { topLevelOnly } from "./top-level-text.mjs";

/** The sample's text that survives, whitespace collapsed. */
const kept = code => topLevelOnly(code).replace(/\s+/g, " ").trim();

describe("topLevelOnly", () => {
  it("blanks what a block nests and keeps what follows it", () => {
    expect(kept("function f() { const hidden = 1; }\nconst top = 2;")).toBe(
      "function f() { } const top = 2;"
    );
  });

  it("keeps newlines, so line numbers in what it returns still hold", () => {
    const code = "f(\n  a,\n  b\n);\nconst top = 1;";
    expect(topLevelOnly(code).split("\n")).toHaveLength(5);
    expect(topLevelOnly(code).split("\n")[4]).toBe("const top = 1;");
  });

  it("reads a template substitution's braces as its own", () => {
    // A scanner that does not rescan templates reads the `}` closing `${b}`
    // as a brace, and the next backtick as a new template running to the end
    // of the file, which hid `top`.
    expect(kept("function f() { const t = `a${b}c`; }\nconst top = 2;")).toBe(
      "function f() { } const top = 2;"
    );
    // A substitution holding a template with a brace in its text. Read as
    // template text, the inner backtick closes the outer template and the `{`
    // opens a block that never closes, which hid `top`.
    expect(
      kept(
        "function f() { const t = `a${ `{` }b`; const hidden = 1; }\nconst top = 1;"
      )
    ).toBe("function f() { } const top = 1;");
  });

  it("treats a bracket inside a string as text", () => {
    expect(
      kept('function f() { const s = "}"; const hidden = {}; }\nconst top = 1;')
    ).toBe("function f() { } const top = 1;");
    expect(kept("const a = '{';\nconst b = 2;")).toBe(
      "const a = '{'; const b = 2;"
    );
  });

  it("treats a bracket inside a comment as text", () => {
    // A `}` in a comment would close the function early and expose `hidden`.
    // The comment before the closing brace belongs to that brace's token, at
    // the outer depth, so it stays: only what the block nests is blanked.
    const nested = kept(
      "function f() { // }\n  const hidden = 1; /* } */ }\nconst top = 2;"
    );
    expect(nested).not.toContain("hidden");
    expect(nested).toContain("} const top = 2;");
    // A `{` in a comment would open a block and hide `b`.
    expect(kept("// {\nconst a = 1;\n/* { */\nconst b = 2;")).toBe(
      "// { const a = 1; /* { */ const b = 2;"
    );
  });

  it("opens a regular expression where a value is expected, and divides after one", () => {
    // After `=` a slash opens a regular expression, so its `}` is text.
    expect(
      kept("function f() { const re = /}/; const hidden = 1; }\nconst top = 1;")
    ).toBe("function f() { } const top = 1;");
    // After a keyword that is not a value, likewise.
    expect(kept("function f() { return /}/.test(x); }\nconst top = 1;")).toBe(
      "function f() { } const top = 1;"
    );
    // After a value a slash divides, so the braces after it are real.
    expect(kept("const half = total / 2;\nconst b = { c: 1 } / 1;")).toBe(
      "const half = total / 2; const b = { } / 1;"
    );
    // After a member named like a keyword, or a non-null `!`, a slash looks
    // like one that opens an expression, but none closes on its line, so it
    // divides and the brace after it on the same line is real.
    expect(kept("function f() { return obj.from / 2; }\nconst top = 1;")).toBe(
      "function f() { } const top = 1;"
    );
    expect(kept("function f() { return value! / 2; }\nconst top = 1;")).toBe(
      "function f() { } const top = 1;"
    );
    // A slash in a character class does not end the expression.
    expect(kept("function f() { const re = /[/}]/; }\nconst top = 1;")).toBe(
      "function f() { } const top = 1;"
    );
  });

  it("ends an unterminated string at its line, as the compiler's scanner does", () => {
    // JSX text is scanned as code, so an apostrophe in it opens a string; one
    // that ran to the end of the file would swallow the closing brace and
    // blank every line after it.
    expect(
      kept("function f() {\n  return <p>Don't</p>;\n}\nconst top = 1;")
    ).toBe("function f() { } const top = 1;");
  });
});
