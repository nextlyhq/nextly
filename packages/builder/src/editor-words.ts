/**
 * The editor's words: what an author calls each place in it, spelled once.
 *
 * Every surface that names one of these places reads it from here — the rail,
 * the inspector's tabs, the Add panel, the Design panel — so a rename is one
 * edit and two surfaces cannot call one place by two names. The words are
 * the author's, not the code's: "Shared styles" rather than classes,
 * "Variables" rather than tokens, "Sections" rather than patterns.
 *
 * @module editor-words
 */

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
