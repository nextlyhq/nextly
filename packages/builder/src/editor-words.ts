/**
 * The editor's words: what an author calls each place in it, spelled once.
 *
 * Every surface that names one of these places reads it from here — the rail,
 * the inspector's tabs, the Add panel, the Design panel — so a rename is one
 * edit and two surfaces cannot call one place by two names. The words are
 * the author's, not the code's: "Shared styles" rather than classes,
 * "Variables" rather than tokens, "Sections" rather than patterns.
 *
 * The words for what a variable gives the places using it are here too, by
 * kind, for the same reason: "colour" rather than color, "size" rather than
 * dimension, said one way wherever a variable's loss is.
 *
 * @module editor-words
 */
import type { TokenKind } from "@nextlyhq/blocks-engine";

export const EDITOR_WORDS = {
  add: "Add",
  layers: "Layers",
  pages: "Pages",
  components: "Components",
  design: "Design",
  variables: "Variables",
  sharedStyles: "Shared styles",
  fonts: "Fonts",
  sections: "Sections",
  content: "Content",
  style: "Style",
  settings: "Settings",
  help: "Help",
  blocks: "Blocks",
  page: "Page",
} as const;

/** One place the editor names, by its key in {@link EDITOR_WORDS}. */
export type EditorWord = keyof typeof EDITOR_WORDS;

/**
 * What a place using a variable would lose with it, by the variable's kind:
 * "they would lose this colour". The author's words for each kind, not the
 * engine's, so a dimension is a size and anything without a plainer word is
 * a value.
 */
export const VARIABLE_LOSS_WORDS: Readonly<
  Record<TokenKind | "lineHeight", string>
> = {
  color: "colour",
  dimension: "size",
  fontFamily: "font",
  fontWeight: "font weight",
  number: "value",
  shadow: "shadow",
  duration: "value",
  custom: "value",
  // A type size's line height, removed on its own beside a size the site's
  // code supplies: a dimension, but what the places lose is its line height.
  lineHeight: "line height",
};
