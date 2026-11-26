/**
 * The editor's words for its settings and the things an author makes, one
 * word per idea, beside the places' own names in `editor-words`.
 *
 * Each group is the word an author reads for one idea wherever it is drawn:
 * the right panel, the Design panel, the Add panel, the Page Builder plugin's
 * screens. A place drawing one of these reads it from here, so a rename is
 * one edit, and the retired-words test keeps the word it replaced from coming
 * back. Stored names, slugs, API keys and CSS names stay as they are; these
 * are only what an author reads.
 *
 * Several words here are not drawn yet: the place that draws the old word
 * switches to the glossary's when it is renamed, and the retired-words
 * test's list of texts still to rename shrinks with it.
 *
 * It imports only the places' names, so the scripts suite loads it with no
 * build.
 *
 * @module glossary/words
 */
import { EDITOR_WORDS } from "../editor-words";

/** The space between a container's blocks, and how they spread. */
export const GAP_WORDS = {
  gap: "Gap",
  rowGap: "Row gap",
  columnGap: "Column gap",
  hint: "Space between the blocks inside",
  // The Spread choice that pushes the blocks apart to fill the row.
  spreadOut: "Spread out",
  // The built-in gap variables. "Space between paragraphs" is not a gap and
  // keeps its name.
  defaultGap: "Default gap",
  gapBetweenColumns: "Gap between columns",
} as const;

/** A block's size, set in one place. */
export const SIZE_WORDS = {
  width: "Width",
  insideItsParent: "Inside its parent",
  // A container's width for its content, on a block that is not a Section.
  contentWidth: "Content width",
} as const;

/**
 * "Change for this box": a block's own value against its kind's, named by
 * the block's own name in lower case. A Section says "section".
 */
export function changeForThis(blockName: string): string {
  return `Change for this ${blockName.toLowerCase()}`;
}

/** The width ranges a page is designed at. "Breakpoint" is a search word only. */
export const SCREEN_SIZE_WORDS = {
  screenSizes: "Screen sizes",
  screenSize: "Screen size",
  edit: "Edit screen sizes",
  add: "Add screen size",
  save: "Save screen sizes",
  needsLargestWidth: "Give this screen size a largest width.",
  // The device buttons keep their names.
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
} as const;

/**
 * What each copy of a component may change. "Field" means a content field
 * only.
 */
export const PROPERTY_WORDS = {
  properties: "Properties",
  // The Page settings tab of a page's own extra fields.
  moreDetails: "More details",
} as const;

/** "Feature card · 2 properties". */
export function propertyCount(componentName: string, count: number): string {
  return `${componentName} · ${count} ${count === 1 ? "property" : "properties"}`;
}

/** "Let each page change Title". */
export function letEachPageChange(propertyName: string): string {
  return `Let each page change ${propertyName}`;
}

/** A block's value read from a content field. */
export const CONNECT_WORDS = {
  connect: "Connect to a field",
  disconnect: "Disconnect",
  toFix: "Connected fields to fix",
} as const;

/** "Connected to Title". */
export function connectedTo(fieldName: string): string {
  return `Connected to ${fieldName}`;
}

/**
 * The site's design values, which are "Variables" (`EDITOR_WORDS`). "CSS
 * variables" is said only where the CSS is copied ("Copy CSS variables", in
 * `DESIGN_ACTION_WORDS`).
 */
export const VARIABLE_WORDS = {
  import: "Import variables…",
  export: "Export variables (.json)",
  exported: "Variables exported",
} as const;

/** Position's choices, in their standard names, and the order blocks overlap in. */
export const POSITION_WORDS = {
  default: "Default",
  relative: "Relative",
  absolute: "Absolute",
  fixed: "Fixed",
  sticky: "Sticky",
  absoluteHint: "Placed on top of its parent, out of the flow.",
  overlapOrder: "Overlap order",
  overlapOrderHint: "Higher numbers sit in front.",
} as const;

/** How a picture fills its box. */
export const IMAGE_FIT_WORDS = {
  imageFit: "Image fit",
  cover: "Cover",
  contain: "Contain",
  stretch: "Stretch",
  originalSize: "Original size",
  shrinkIfTooBig: "Shrink if too big",
} as const;

/**
 * Where a click goes, against a page's own web address. "URL" is said only in
 * hints.
 */
export const LINK_WORDS = {
  link: "Link",
  linkPlaceholder: "Search pages or paste a link",
  address: "Address",
  tellSearchEngines: "Tell search engines",
} as const;

/** One verb per act; adding anything is "Add" (`EDITOR_WORDS`). */
export const VERB_WORDS = {
  saveDraft: "Save draft",
  addSavedSection: "Add a saved section",
  browseAll: "Browse all blocks and saved sections →",
} as const;

/** How much of a page a saved section is. "Section" means the Section block. */
export const SAVED_SECTION_SIZE_WORDS = {
  oneBlock: "One block",
  aFewBlocks: "A few blocks",
  fullWidthBand: "A full-width band",
} as const;

/**
 * The header and footer around pages. The site's own is "Site default"
 * wherever it is picked or listed.
 */
export const HEADER_FOOTER_WORDS = {
  headerAndFooter: "Header & footer",
  siteDefault: "Site default",
} as const;

/** "Header & footer: Landing", for any but the site default. */
export function headerAndFooterNamed(name: string): string {
  return `${HEADER_FOOTER_WORDS.headerAndFooter}: ${name}`;
}

/** The plain names for choices whose CSS names say nothing to an author. */
export const CHOICE_WORDS = {
  // background-attachment: fixed
  staysPutWhileScrolling: "Stays put while scrolling",
  // display: none
  noneHidden: "None (hidden)",
  // overflow: hidden
  cutOff: "Cut off",
  // A Button style drawn as a link.
  linkStyle: "Link style",
  // A block style tile a block no longer offers.
  notOffered: "Not offered",
} as const;

/** The Add panel's headings that were "Text". */
export const ADD_PANEL_WORDS = {
  textAndLists: "Text & lists",
  collections: "Collections",
  collectionTemplates: "Collection templates",
} as const;

/** The Box block's description. */
export const BOX_DESCRIPTION = "An empty box that holds other blocks.";

/** The top bar's toggles. */
export const PANEL_TOGGLE_WORDS = {
  rightPanel: "Right panel",
  showCssNames: "Show CSS names",
} as const;

/** "Content this page loads: 430 of 500". */
export function contentThisPageLoads(count: number, limit: number): string {
  return `Content this page loads: ${count} of ${limit}`;
}

/** Messages in the words above, for the places that said them in code words. */
export const MESSAGE_WORDS = {
  sideUsesVariable: "This side uses a variable. Change it in the Style tab.",
  duplicateAnchor:
    "Two blocks have the same anchor name. Change one in Advanced.",
  connectionChanged: "This connection changed. Try disconnecting again.",
} as const;

/**
 * The industry words that still find a renamed thing in "Find a setting",
 * the Add panel search and the command search, by the glossary word they
 * find.
 */
export const INDUSTRY_KEYWORDS: Readonly<
  Record<string, { readonly keywords: readonly string[] }>
> = {
  [EDITOR_WORDS.sharedStyles]: { keywords: ["class"] },
  [SCREEN_SIZE_WORDS.screenSizes]: { keywords: ["breakpoint"] },
  [POSITION_WORDS.overlapOrder]: { keywords: ["z-index"] },
  [IMAGE_FIT_WORDS.imageFit]: { keywords: ["object-fit"] },
  [EDITOR_WORDS.layers]: { keywords: ["navigator", "structure"] },
  [CONNECT_WORDS.connect]: { keywords: ["dynamic data", "bind"] },
  [ADD_PANEL_WORDS.collectionTemplates]: { keywords: ["template"] },
  [EDITOR_WORDS.variables]: { keywords: ["token"] },
  [EDITOR_WORDS.add]: { keywords: ["insert"] },
};
