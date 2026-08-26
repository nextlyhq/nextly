/**
 * Guards the JSON tokenizer used to colour a source comparison.
 *
 * Two properties matter. It must never LOSE text: concatenating the tokens has
 * to reproduce the input exactly, or a comparison would silently render
 * something other than what it compared. And it must name constructs from the
 * shared palette vocabulary rather than inventing colours, so a code field and
 * the editors beside it agree on what a string looks like.
 */
import { describe, expect, it } from "vitest";

import { tokenizeJsonLine } from "../json-tokens";

/** The round-trip property, asserted everywhere: tokens rebuild the line. */
function rebuilt(line: string): string {
  return tokenizeJsonLine(line)
    .map(t => t.text)
    .join("");
}

describe("tokenizeJsonLine — never loses text", () => {
  it.each([
    '  "readingTime": 4,',
    '  "featured": true',
    "{",
    "}",
    '  "series": "local-dev",',
    '  "nested": { "a": [1, 2] }',
    '  "escaped": "a \\" quote",',
    "",
    "   ",
    "not json at all",
  ])("rebuilds %j exactly", line => {
    expect(rebuilt(line)).toBe(line);
  });
});

describe("tokenizeJsonLine — construct naming", () => {
  it("names a property key and its string value differently", () => {
    const tokens = tokenizeJsonLine('  "series": "local-dev",');
    const key = tokens.find(t => t.text === '"series"');
    const value = tokens.find(t => t.text === '"local-dev"');
    expect(key?.construct).toBe("function");
    expect(value?.construct).toBe("string");
  });

  it("names a number", () => {
    const tokens = tokenizeJsonLine('  "readingTime": 42,');
    expect(tokens.find(t => t.text === "42")?.construct).toBe("number");
  });

  it("names a negative and a fractional number", () => {
    expect(
      tokenizeJsonLine('  "x": -1.5').find(t => t.text === "-1.5")?.construct
    ).toBe("number");
  });

  it("names booleans and null as keywords", () => {
    const tokens = tokenizeJsonLine('  "a": true, "b": false, "c": null');
    for (const literal of ["true", "false", "null"]) {
      expect(tokens.find(t => t.text === literal)?.construct).toBe("keyword");
    }
  });

  it("names punctuation", () => {
    const tokens = tokenizeJsonLine("{");
    expect(tokens[0]?.construct).toBe("punctuation");
  });

  it("leaves whitespace unclassified rather than colouring it", () => {
    const tokens = tokenizeJsonLine('  "a": 1');
    expect(tokens[0]?.text).toBe("  ");
    expect(tokens[0]?.construct).toBeUndefined();
  });

  it("does not mistake a colon INSIDE a string for a key separator", () => {
    // The property that separates a real tokenizer from a split on ':'.
    const tokens = tokenizeJsonLine('  "url": "https://example.com/x"');
    const value = tokens.find(t => t.text === '"https://example.com/x"');
    expect(value?.construct).toBe("string");
  });

  it("does not treat a brace inside a string as punctuation", () => {
    const tokens = tokenizeJsonLine('  "tpl": "{{ name }}"');
    expect(tokens.find(t => t.text === '"{{ name }}"')?.construct).toBe(
      "string"
    );
  });
});
