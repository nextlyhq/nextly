/**
 * The editor's words: what an author calls each place in it, spelled once.
 *
 * Every surface that names one of these places reads it from here — the rail,
 * the inspector's tabs, the Add panel, the Design panel — so a rename is one
 * edit and two surfaces cannot call one place by two names. The words are
 * the author's, not the code's: "Shared styles" rather than classes,
 * "Variables" rather than tokens, "Saved sections" rather than patterns.
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
  // The Design panel's tabs, by kind.
  colours: "Colours",
  type: "Type",
  spacing: "Spacing",
  styles: "Styles",
  variables: "Variables",
  sharedStyles: "Shared styles",
  fonts: "Fonts",
  sections: "Saved sections",
  content: "Content",
  style: "Style",
  advanced: "Advanced",
  settings: "Settings",
  help: "Help",
  blocks: "Blocks",
  page: "Page",
} as const;

/** One place the editor names, by its key in {@link EDITOR_WORDS}. */
export type EditorWord = keyof typeof EDITOR_WORDS;

/**
 * The verb for each conversion between a selection, a saved section and a
 * component, spelled once. The bar, its ⋯ menu, the right-click menu and the
 * command palette all name these three with these words, so an author meets
 * one verb for one act wherever they look for it.
 */
export const CONVERSION_WORDS = {
  saveAsSection: "Save as section…",
  turnIntoComponent: "Turn into component…",
  detachFromComponent: "Detach from component",
} as const;

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
