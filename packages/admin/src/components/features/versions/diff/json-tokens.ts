/**
 * Split one line of JSON into coloured tokens.
 *
 * A comparison renders line by line, so it needs a tokenizer that works on a
 * line in isolation rather than a parser that needs the whole document. The
 * lines come from the engine's own canonical printer, so they are well-formed
 * by construction; anything else is passed through uncoloured rather than
 * guessed at.
 *
 * Deliberately NOT Prism, which the editors use. Prism arrives through
 * `@lexical/code-prism`, which this package lazy-loads precisely so that
 * Lexical does not land in every bundle that renders a field — and it is not a
 * declared dependency of this package, so importing it would rely on a
 * hoisting accident. Forty lines here keeps the comparison free of both.
 *
 * The construct names ARE shared with the editors: they come from
 * `code-palette`, so a string is the same colour in a comparison as in the
 * editor beside it, and a retheme moves both.
 *
 * @module components/features/versions/diff/json-tokens
 */

import type { CodeConstruct } from "@admin/lib/code-palette";

/** One run of a line. `construct` absent means "colour it like ordinary text". */
export interface JsonToken {
  text: string;
  construct?: CodeConstruct;
}

/** Matches one JSON string literal, honouring backslash escapes. */
const STRING = /^"(?:[^"\\]|\\.)*"/;
/** Matches one JSON number, including sign and exponent. */
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WHITESPACE = /^\s+/;
const LITERAL = /^(?:true|false|null)\b/;
const PUNCTUATION = /^[{}[\],:]/;

/**
 * Every token shape that does not depend on context, in the order they are
 * tried. A table rather than a chain of branches, so adding one is data.
 *
 * None of these regexes carries the `g` flag: a shared global regex advances
 * `lastIndex` between calls and would answer differently depending on what was
 * matched a moment earlier.
 */
const MATCHERS: readonly { pattern: RegExp; construct?: CodeConstruct }[] = [
  // Uncoloured: whitespace carries no construct, and giving it one would paint
  // the gaps between tokens.
  { pattern: WHITESPACE },
  { pattern: LITERAL, construct: "keyword" },
  { pattern: NUMBER, construct: "number" },
  { pattern: PUNCTUATION, construct: "punctuation" },
];

/**
 * Whether a string literal ending here is a property KEY rather than a value:
 * a key is the token immediately before a colon. Looking ahead is what
 * separates this from splitting the line on `:`, which mis-reads a colon inside
 * a URL or a template.
 */
function isKeyAt(line: string, end: number): boolean {
  return /^\s*:/.test(line.slice(end));
}

/** The first context-free token at the head of `rest`, or null. */
function matchToken(rest: string): JsonToken | null {
  for (const { pattern, construct } of MATCHERS) {
    const found = pattern.exec(rest);
    if (!found) continue;
    return construct === undefined
      ? { text: found[0] }
      : { text: found[0], construct };
  }
  return null;
}

/**
 * Consume one character the grammar does not describe, merging it into a
 * preceding uncoloured run. A line this tokenizer cannot read still renders its
 * own text rather than disappearing.
 */
function pushUnknownChar(tokens: JsonToken[], char: string): void {
  const previous = tokens[tokens.length - 1];
  if (previous && previous.construct === undefined) {
    previous.text += char;
    return;
  }
  tokens.push({ text: char });
}

export function tokenizeJsonLine(line: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let index = 0;

  while (index < line.length) {
    const rest = line.slice(index);

    // Strings are matched first and separately, because whether one is a key or
    // a value depends on what follows it.
    const str = STRING.exec(rest);
    if (str) {
      const end = index + str[0].length;
      tokens.push({
        text: str[0],
        // A key is a name, so it takes the construct the editors give a
        // property name rather than the one they give a string value.
        construct: isKeyAt(line, end) ? "function" : "string",
      });
      index = end;
      continue;
    }

    const token = matchToken(rest);
    if (token) {
      tokens.push(token);
      index += token.text.length;
      continue;
    }

    const char = rest[0];
    if (char === undefined) break;
    pushUnknownChar(tokens, char);
    index += 1;
  }

  return tokens;
}
