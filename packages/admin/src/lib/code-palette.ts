/**
 * What a syntax palette can colour, and what each of those is worth.
 *
 * Two engines highlight code in this admin -- Lexical/Prism in the rich-text
 * field, CodeMirror/lezer everywhere else -- and they name their tokens
 * differently. Left to themselves each grows its own opinion of what a class
 * name or a namespace is worth, and the disagreement is invisible in review
 * because each looks right beside its own editor.
 *
 * So the decision lives here once, keyed by the CONSTRUCT rather than by either
 * tokenizer's vocabulary, and both engines derive from it. Neither can drift
 * from the other, because there is nothing to drift from.
 *
 * **The class strings are written out in full on purpose.** Tailwind discovers
 * utilities by scanning source text, so a class assembled at runtime --
 * `text-code-${construct}` -- is invisible to it and gets purged, leaving
 * rich-text code blocks unstyled with nothing at build time to say so. Every
 * class here is a literal for that reason; do not compose them.
 *
 * @module lib/code-palette
 */

/**
 * Each construct's theme token and its matching utility class.
 *
 * The two spellings are the same name in two namespaces -- `--nx-code-string`
 * is what CSS calls it, `text-code-string` is what Tailwind calls it -- and a
 * test holds them to that, so neither can be edited alone.
 */
export const CODE_CONSTRUCTS = {
  comment: { token: "--nx-code-comment", className: "text-code-comment" },
  keyword: { token: "--nx-code-keyword", className: "text-code-keyword" },
  string: { token: "--nx-code-string", className: "text-code-string" },
  number: { token: "--nx-code-number", className: "text-code-number" },
  function: { token: "--nx-code-function", className: "text-code-function" },
  operator: { token: "--nx-code-operator", className: "text-code-operator" },
  punctuation: {
    token: "--nx-code-punctuation",
    className: "text-code-punctuation",
  },
  variable: { token: "--nx-code-variable", className: "text-code-variable" },
  tag: { token: "--nx-code-tag", className: "text-code-tag" },
  deleted: { token: "--nx-code-deleted", className: "text-code-deleted" },
  inserted: { token: "--nx-code-inserted", className: "text-code-inserted" },
} as const;

export type CodeConstruct = keyof typeof CODE_CONSTRUCTS;

/** The construct's colour, for an engine that styles with CSS values. */
export function codeColor(construct: CodeConstruct): string {
  return `var(${CODE_CONSTRUCTS[construct].token})`;
}

/** The construct's colour, for an engine that styles with class names. */
export function codeClass(construct: CodeConstruct): string {
  return CODE_CONSTRUCTS[construct].className;
}
