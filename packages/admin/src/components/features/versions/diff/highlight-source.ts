/**
 * Colour a source comparison from the language it is actually written in.
 *
 * The constructs come from `CODE_TAG_SPECS` — the same lezer-tag table
 * `code-highlight` feeds to CodeMirror — so a keyword is the same colour in a
 * comparison as in the editor beside it, and a retheme moves both. This module
 * records nothing about what a construct is worth and nothing about which tag
 * means which construct; it reuses both.
 *
 * The whole of each SIDE is parsed, not each line. A diff renders line by line,
 * which makes per-line parsing the obvious shortcut and a wrong one: a
 * Markdown fenced block, a Python docstring, a CSS block comment and a
 * TypeScript template literal all span lines, so a line read in isolation is
 * coloured as whatever it happens to look like on its own. That is the failure
 * mode a comparison can least afford — confidently wrong colour on text the
 * reader is scanning for a change.
 *
 * Loaded on demand by its caller. The grammars are the heaviest thing the
 * versions view could pull in, and a comparison of a plain text field must not
 * pay for them.
 *
 * @module components/features/versions/diff/highlight-source
 */

import { highlightTree, tagHighlighter } from "@lezer/highlight";

import { CODE_TAG_SPECS } from "@admin/lib/code-highlight";
import { codeLanguageSupport } from "@admin/lib/code-language";
import { CODE_CONSTRUCTS, type CodeConstruct } from "@admin/lib/code-palette";

import type { ConstructSpan } from "./source-runs";

/**
 * How much text is parsed before this declines to.
 *
 * A grammar parses the whole document to answer, and a code field has no size
 * limit of its own — so a pasted bundle would block the thread that is drawing
 * the comparison. Declining renders the text uncoloured, which is what an
 * unrecognised language already does.
 */
const MAX_PARSED = 200_000;

/**
 * The tag table as a highlighter that answers with CONSTRUCT NAMES.
 *
 * `code-highlight` builds a second highlighter from the same specs that answers
 * with colours, because CodeMirror styles by colour and this renders by class.
 * Both derive from `CODE_TAG_SPECS`, so neither can drift from the other: the
 * only thing duplicated is the output format.
 *
 * Specs carrying no construct are dropped rather than given one. They exist to
 * set weight or slant — Markdown's strong and emphasis modify whatever they sit
 * in and carry no colour of their own — and inventing one would repaint prose
 * that was deliberately left alone.
 */
const CONSTRUCT_HIGHLIGHTER = tagHighlighter(
  CODE_TAG_SPECS.flatMap(spec =>
    spec.construct === undefined
      ? []
      : [{ tag: spec.tag, class: spec.construct }]
  )
);

/** Whether a class the highlighter emitted names a construct we can paint. */
function toConstruct(classes: string): CodeConstruct | null {
  // A tag can match several specs, and the highlighter joins their classes with
  // a space. The first is the most specific match, which is the one to paint.
  const first = classes.split(" ")[0];
  if (first === undefined) return null;
  return Object.hasOwn(CODE_CONSTRUCTS, first)
    ? (first as CodeConstruct)
    : null;
}

/** Split one line's per-character marks into runs of equal construct. */
function lineSpans(
  line: string,
  marks: readonly (CodeConstruct | undefined)[],
  offset: number
): ConstructSpan[] {
  const spans: ConstructSpan[] = [];
  let start = 0;
  while (start < line.length) {
    const construct = marks[offset + start];
    let end = start + 1;
    while (end < line.length && marks[offset + end] === construct) end += 1;
    if (construct !== undefined)
      spans.push({ from: start, to: end, construct });
    start = end;
  }
  return spans;
}

/**
 * One side's constructs, per line, in that line's own columns.
 *
 * Null when nothing here can read the language, or when the text is past the
 * bound — both meaning "render this uncoloured" rather than "there is nothing
 * here", which the caller keeps distinct.
 */
export function highlightSource(
  text: string,
  language: string
): ConstructSpan[][] | null {
  if (text.length > MAX_PARSED) return null;
  const support = codeLanguageSupport(language);
  if (support === null) return null;

  // Marked per character, then run-length encoded per line. A construct can
  // span lines, so distributing the parser's absolute ranges across lines
  // directly needs the same walk with the boundaries handled by hand.
  const marks = new Array<CodeConstruct | undefined>(text.length).fill(
    undefined
  );
  highlightTree(
    support.language.parser.parse(text),
    CONSTRUCT_HIGHLIGHTER,
    (from, to, classes) => {
      const construct = toConstruct(classes);
      if (construct === null) return;
      for (let i = from; i < to; i += 1) marks[i] = construct;
    }
  );

  const spans: ConstructSpan[][] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    spans.push(lineSpans(line, marks, offset));
    // The newline the split consumed still occupies a column in `marks`.
    offset += line.length + 1;
  }
  return spans;
}
