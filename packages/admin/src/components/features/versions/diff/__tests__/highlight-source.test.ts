/**
 * Guards the syntax colouring of a source comparison.
 *
 * This replaces the hand-written JSON tokenizer that used to live in
 * `json-tokens.ts`. That reader knew one language, so a code field written in
 * any other rendered as plain text however carefully its language was
 * configured — and it had already drifted from the shared palette, colouring
 * `true`, `false` and `null` as keywords where every editor in the admin
 * colours them as numbers. Both are answered by reading the real grammar.
 *
 * Three properties matter. Text must survive colouring exactly, or a comparison
 * shows something other than what it compared. Constructs must come from the
 * shared vocabulary, so a string looks the same here as in the editor beside
 * it. And a construct spanning several LINES must stay one construct, which is
 * the property per-line parsing cannot have.
 */
import { describe, expect, it } from "vitest";

import { highlightSource } from "../highlight-source";
import { paintRun, type ConstructSpan } from "../source-runs";

/** Every construct covering one line, as `construct` per column. */
function marksOf(
  spans: ConstructSpan[],
  width: number
): (string | undefined)[] {
  const out = new Array<string | undefined>(width).fill(undefined);
  for (const span of spans) {
    for (let i = span.from; i < span.to; i += 1) out[i] = span.construct;
  }
  return out;
}

/** The construct covering the first occurrence of `needle` in `line`. */
function constructAt(
  text: string,
  language: string,
  lineIndex: number,
  needle: string
): string | undefined {
  const spans = highlightSource(text, language);
  const line = text.split("\n")[lineIndex] ?? "";
  const at = line.indexOf(needle);
  expect(at).toBeGreaterThanOrEqual(0);
  return marksOf(spans?.[lineIndex] ?? [], line.length)[at];
}

describe("paintRun — never loses text", () => {
  it.each([
    '  "readingTime": 4,',
    '  "featured": true',
    "{",
    '  "escaped": "a \\" quote",',
    "",
    "   ",
  ])("rebuilds %j exactly with no constructs", line => {
    expect(
      paintRun(line, [], 0)
        .map(r => r.text)
        .join("")
    ).toBe(line);
  });

  it("rebuilds a run exactly when constructs cover part of it", () => {
    const spans: ConstructSpan[] = [{ from: 2, to: 6, construct: "string" }];
    expect(
      paintRun("ab cdef gh", spans, 0)
        .map(r => r.text)
        .join("")
    ).toBe("ab cdef gh");
  });

  it("reads spans against the column the run starts at", () => {
    // A run beginning mid-line is handed the whole line's spans, so it has to
    // subtract its own offset. Getting this wrong colours the right characters
    // of the wrong word, which reads as a working highlighter.
    const spans: ConstructSpan[] = [{ from: 4, to: 7, construct: "keyword" }];
    const runs = paintRun("let x", spans, 4);
    expect(runs.map(r => r.text).join("")).toBe("let x");
    expect(runs[0]).toMatchObject({ text: "let", construct: "keyword" });
  });

  it("ignores a span that falls entirely outside the run", () => {
    const spans: ConstructSpan[] = [{ from: 40, to: 50, construct: "keyword" }];
    const runs = paintRun("abc", spans, 0);
    expect(runs).toEqual([{ text: "abc" }]);
  });
});

describe("highlightSource — reads the configured language", () => {
  it("colours a property name and a string value differently in json", () => {
    const json = '{\n  "title": "hello"\n}';
    expect(constructAt(json, "json", 1, '"title"')).toBe("function");
    expect(constructAt(json, "json", 1, '"hello"')).toBe("string");
  });

  it("colours a json literal from the shared palette, not as a keyword", () => {
    // The drift the hand-written tokenizer carried: `true`, `false` and `null`
    // are number-coloured everywhere else in this admin, because they are the
    // same kind of literal as the numbers they sit among.
    const json = '{\n  "featured": true\n}';
    expect(constructAt(json, "json", 1, "true")).toBe("number");
  });

  it("colours SQL, which used to render as plain text", () => {
    const sql = "SELECT id\nFROM posts";
    expect(constructAt(sql, "sql", 0, "SELECT")).toBe("keyword");
  });

  it("colours python", () => {
    const py = "def run():\n    return 1";
    expect(constructAt(py, "python", 0, "def")).toBe("keyword");
  });

  it("colours typescript", () => {
    const ts = "const a = 1;\nconst b = 2;";
    expect(constructAt(ts, "typescript", 0, "const")).toBe("keyword");
  });

  it("refuses a language nothing here reads, rather than guessing at one", () => {
    // Colouring Rust with a JavaScript grammar paints some of it wrongly and a
    // reader cannot tell which parts, which is worse than colouring none.
    expect(highlightSource("fn main() {}", "rust")).toBeNull();
    expect(highlightSource("hello", "plaintext")).toBeNull();
  });

  it("declines a document past its size bound instead of blocking on it", () => {
    expect(highlightSource("a".repeat(200_001), "json")).toBeNull();
  });
});

describe("highlightSource — constructs that span lines", () => {
  it("keeps a css block comment a comment on its SECOND line", () => {
    // The property per-line parsing cannot have. Read alone, `color: red;`
    // is a declaration and colours as one — inside a comment it is prose, and
    // a comparison that colours it as code says the opposite of the truth.
    const css = "a {\n  /* note:\n     color: red; */\n  top: 0;\n}";
    expect(constructAt(css, "css", 2, "color")).toBe("comment");
  });

  it("still colours real code after the comment closes", () => {
    // The control: a highlighter that marked everything after a comment opener
    // as comment would pass the test above and be useless.
    const css = "a {\n  /* note:\n     color: red; */\n  top: 0;\n}";
    expect(constructAt(css, "css", 3, "top")).toBe("function");
  });

  it("keeps a python docstring a string on its second line", () => {
    const py = 'def f():\n    """line one\n    line two"""\n    return 1';
    expect(constructAt(py, "python", 2, "line two")).toBe("string");
  });

  it("gives every line of the document an entry, blank ones included", () => {
    // Lines are looked up by index, so a missing entry would shift every
    // construct after it onto the wrong line.
    const json = '{\n\n  "a": 1\n}';
    expect(highlightSource(json, "json")).toHaveLength(4);
  });
});
