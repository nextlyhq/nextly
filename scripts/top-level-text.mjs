/**
 * A documentation sample's text with everything nested inside a bracket
 * blanked, so a pattern anchored at a line start reads top-level declarations
 * only.
 *
 * Tokenised here rather than parsed, because the samples it reads are often not
 * programs: a fence with a `{ ... }` placeholder or a partial snippet is
 * documentation, and a parser answers it with nothing at all. Only what deciding
 * bracket depth needs is recognised: brackets, and the tokens whose text can
 * hold a bracket that is not one — strings, comments, template literals and
 * regular expressions. Everything else is a run of characters whose only use is
 * deciding whether a following `/` divides or opens a regular expression.
 *
 * Counting characters instead read a brace inside a string or a comment as a
 * real one, in both directions: `function setup() { const marker = "}"; const
 * hidden = {}; }` closed early and left `hidden` looking page-scoped.
 */

const OPENS = new Set(["{", "(", "["]);
const CLOSES = new Set(["}", ")", "]"]);

/**
 * The words TypeScript scans as keywords. After any of them a `/` opens a
 * regular expression (`return /x/`), except after the few that are values,
 * which `DIVISION_FOLLOWS` lists.
 */
const KEYWORDS = new Set([
  "abstract",
  "accessor",
  "any",
  "as",
  "assert",
  "asserts",
  "async",
  "await",
  "bigint",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "defer",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "global",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "intrinsic",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "out",
  "override",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "satisfies",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "using",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Tokens after which a `/` is division; after anything else it opens a regular
 * expression. Without this `const re = /}/` contributes a closing brace and the
 * rest of the enclosing block reads as top level.
 */
const DIVISION_FOLLOWS = new Set([
  "identifier",
  "number",
  "string",
  "template",
  "regex",
  ")",
  "]",
  "}",
  "this",
  "super",
  "true",
  "false",
  "null",
  "++",
  "--",
]);

/**
 * Whitespace and comments, which no token's depth depends on. A `//` always
 * starts a comment, where a regular expression could otherwise begin.
 */
const TRIVIA = /(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))+/y;

/**
 * Each token's extent from a position. A string, and a regular expression, that
 * is never closed ends at its line, as the compiler's scanner ends one: JSX
 * text is scanned as code, so an apostrophe in it opens a string, and one that
 * ran on would swallow the brace closing its block.
 */
const LEXEMES = [
  ["string", /(["'])(?:\\[\s\S]|(?!\1)[^\\\n])*\1?/y],
  ["number", /(?:[0-9]|\.[0-9])[\w.]*/y],
  ["word", /[A-Za-z_$\u0080-￿][\w$\u0080-￿]*/y],
  ["++", /\+\+/y],
  ["--", /--/y],
];

/** A regular expression literal: an unescaped `/` outside a class ends it. */
const REGEX =
  /\/(?:\\[^\n]|\[(?:\\[^\n]|[^\]\\\n])*\]?|[^/\\\n[])*(?:\/[a-z]*)?/iy;

/** A template literal's text up to its closing backtick or a `${`. */
const TEMPLATE_TEXT = /(?:\\[\s\S]|[^`\\$]|\$(?!\{))*/y;

/** Where a sticky `pattern` stops matching from `at`; `at` if it does not. */
function matchEnd(pattern, code, at) {
  pattern.lastIndex = at;
  return pattern.test(code) ? pattern.lastIndex : at;
}

/** +1 for an opening bracket, -1 for a closing one, 0 for anything else. */
function bracketDelta(text) {
  if (OPENS.has(text)) return 1;
  return CLOSES.has(text) ? -1 : 0;
}

/**
 * The end of a template literal, its `${ }` substitutions included: a
 * substitution is code, read token by token to its own matching brace, so a
 * brace or a backtick inside it neither closes the template nor counts here.
 */
function templateEnd(code, start) {
  let at = start + 1;
  while (at < code.length) {
    at = matchEnd(TEMPLATE_TEXT, code, at);
    // Stopped at the closing backtick, at a `${`, or at the end of the code.
    if (code[at] !== "$") return Math.min(at + 1, code.length);
    at = substitutionEnd(code, at + 2);
  }
  return code.length;
}

/** The index just past the bracket closing a substitution whose code starts at `start`. */
function substitutionEnd(code, start) {
  let depth = 0;
  for (const token of tokens(code, start)) {
    depth += bracketDelta(token.text);
    if (depth < 0) return token.end;
  }
  return code.length;
}

/** A template literal, or a regular expression where a `/` cannot divide. */
function delimitedAt(code, start, previous) {
  if (code[start] === "`") {
    return { kind: "template", end: templateEnd(code, start) };
  }
  if (code[start] === "/" && !DIVISION_FOLLOWS.has(previous)) {
    return { kind: "regex", end: matchEnd(REGEX, code, start) };
  }
  return undefined;
}

/** A string, a number, a word, `++` or `--`; else one punctuation character. */
function lexemeAt(code, start) {
  for (const [kind, pattern] of LEXEMES) {
    const end = matchEnd(pattern, code, start);
    if (end > start) return { kind: kindOf(kind, code.slice(start, end)), end };
  }
  return { kind: code[start], end: start + 1 };
}

/** A word is its keyword when it is one, and an identifier otherwise. */
function kindOf(kind, text) {
  if (kind !== "word") return kind;
  return KEYWORDS.has(text) ? text : "identifier";
}

/**
 * The tokens from `start`, comments and whitespace skipped: `{ kind, text,
 * start, end }`, where `text` is the token's source.
 */
function* tokens(code, start = 0) {
  let at = matchEnd(TRIVIA, code, start);
  let previous = "";
  while (at < code.length) {
    const { kind, end } = delimitedAt(code, at, previous) ?? lexemeAt(code, at);
    yield { kind, text: code.slice(at, end), start: at, end };
    previous = kind;
    at = matchEnd(TRIVIA, code, end);
  }
}

/** Every character from `from` to `to` replaced by a space, newlines kept. */
function blank(chars, from, to) {
  for (let i = from; i < to; i += 1) {
    if (chars[i] !== "\n") chars[i] = " ";
  }
}

/**
 * The sample with every character nested inside a bracket blanked, newlines
 * kept so line numbers hold. A closing bracket belongs to the depth it returns
 * to and an opening one to the depth it leaves, so both stay visible while
 * their contents, and the comments and whitespace before each nested token, do
 * not.
 */
export function topLevelOnly(code) {
  const chars = code.split("");
  let depth = 0;
  let previousEnd = 0;
  for (const token of tokens(code)) {
    const delta = bracketDelta(token.text);
    const at = Math.max(0, depth + Math.min(delta, 0));
    if (at > 0) blank(chars, previousEnd, token.end);
    depth = at + Math.max(delta, 0);
    previousEnd = token.end;
  }
  return chars.join("");
}
