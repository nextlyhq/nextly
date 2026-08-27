/**
 * Which grammar reads a given code language.
 *
 * One table, because two surfaces need the same answer and they must not
 * disagree about it: the code field's editor picks a grammar to parse as you
 * type, and a version comparison picks one to colour what it prints. Two maps
 * would agree on the day they were written and drift after — and the drift
 * would be invisible, because each looks correct beside its own caller.
 *
 * It answers with the grammar ALONE. An editor also wants linting, bracket
 * matching and completion, which a comparison has no use for; those stay with
 * the editor, where the `LanguageSupport` returned here supplies the parser
 * they hang off.
 *
 * A language absent from the table answers null rather than falling back to a
 * near neighbour. Colouring SQL with a JavaScript grammar paints some of it
 * wrongly, and a reader has no way to tell which parts — worse than leaving it
 * uncoloured, which at least says nothing.
 *
 * @module lib/code-language
 */

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { LanguageSupport } from "@codemirror/language";
import type { CodeLanguage } from "nextly/config";

/**
 * Constructed on demand rather than held as values: a `LanguageSupport` carries
 * parser state, so sharing one instance between an editor and a comparison
 * rendering at the same time would have them reading each other's.
 *
 * `satisfies` rather than a type annotation, so a misspelled language is a
 * compile error while the table stays indexable by a plain string below.
 */
const GRAMMARS = {
  // Shipped by one grammar with flags, which is how the package exposes them:
  // TypeScript is JavaScript's parser told to admit type syntax.
  javascript: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  html: () => html(),
  // scss and less are supersets: the CSS grammar reads the parts they share and
  // leaves their own syntax uncoloured, which is the honest half-answer. A
  // wrong grammar would colour that syntax as something it is not.
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  python: () => python(),
  sql: () => sql(),
  yaml: () => yaml(),
  markdown: () => markdown(),
  xml: () => xml(),
} satisfies Partial<Record<CodeLanguage, () => LanguageSupport>>;

/** The grammar for a language, or null when nothing here reads it. */
export function codeLanguageSupport(language: string): LanguageSupport | null {
  const table: Record<string, (() => LanguageSupport) | undefined> = GRAMMARS;
  return table[language]?.() ?? null;
}
