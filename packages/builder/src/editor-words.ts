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
  blockStyles: "Block styles",
  fonts: "Fonts",
  // The Type tab's section setting every page's text.
  siteText: "Site text",
  // The Type tab's named looks of text, which any block can wear.
  textStyles: "Text styles",
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
 * The top bar's light and dark preview: its name for assistive technology,
 * which stays the same pressed or not, and its tooltip, which says that
 * nothing a visitor sees changes with it.
 */
export const DARK_PREVIEW_WORDS = {
  name: "Preview in dark mode",
  tooltip: "Preview only. Visitors see what their own device is set to.",
} as const;

/**
 * The Type tab's two site-wide fonts: their names, what each says while it
 * writes nothing, and the line under Headings when its font has no bold.
 */
export const FONT_ROLE_WORDS = {
  body: "Body font",
  heading: "Headings font",
  ownFont: "Your site's own font",
  sameAsBody: "Same as body",
  addBold: "Add Bold",
} as const;

/** The line under Headings when its font has no bold of its own. */
export function noBoldWords(family: string): string {
  return `${family} has no Bold, so browsers draw a fake bold`;
}

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

/**
 * The Design panel's ⋯ menu of site-wide actions, and the words of what an
 * export reports. Each item says what it makes; "DTCG" is only ever the hint
 * beside the one that writes that format.
 */
export const DESIGN_ACTION_WORDS = {
  more: "More design actions",
  importTokens: "Import design tokens…",
  exportTokens: "Export design tokens (.json)",
  exportTokensHint: "DTCG 2025.10",
  exportFigma: "Export for Figma",
  copyCss: "Copy CSS variables",
  notExported: "What wasn't exported",
  kept: "Kept for Nextly only",
  leftOut: "Left out",
  withoutData: "Exported without its extra data",
  textStyles: "Text styles",
  alsoInFile: "Also in the file",
  missingFonts: "Fonts this site doesn't have",
  addFromGoogle: "Add from Google Fonts",
  fontAdded: "Added",
  uploadFont: "Upload its font file in Fonts to use it.",
  /** Why a shadow or a text style is not in the Figma files. */
  figmaStyles:
    "Figma keeps these as effect styles and text styles; the variables they use are in the file",
} as const;
