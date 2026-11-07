/**
 * The palette's headings, declared once.
 *
 * A block's `editor.category` is a free string, so nineteen definitions each
 * spelling their own would make "interactive" and "Interactive" two headings
 * with no error anywhere — the inserter groups by the value it is given and has
 * no vocabulary to check it against.
 *
 * These are also the ONE answer to how this library is grouped. `index.ts` used
 * to carry a second one in comments over `coreBlocks`, which agreed with
 * nothing enforcing it; that list's comments now describe the ORDERING
 * constraints they always also encoded — parent before child, so a resolver
 * built by iterating meets the container first — and the grouping is declared
 * here, on the blocks themselves, where the palette actually reads it.
 *
 * @module blocks/categories
 */

/**
 * What holds other blocks and shapes the page.
 *
 * Structure with no content of its own: removing one changes where things sit,
 * never what they say. Includes `core/divider` beside `core/spacer`, where the
 * agreed editor design puts it and where an author looks for a line between
 * sections; it still draws a semantic thematic break.
 */
export const LAYOUT = "layout";

/**
 * What the page says.
 *
 * Includes `core/collection-loop`, which lives here until there are enough
 * data-driven blocks to earn a heading of their own: one item under a heading
 * of its own reads as a mistake rather than as a category.
 */
export const CONTENT = "content";

/** Pictures, video and embedded external content. */
export const MEDIA = "media";

/**
 * What a visitor operates.
 *
 * `core/form` sits here rather than under anything data-driven: it is static
 * markup that posts to a URL, storing nothing and shipping no JavaScript of its
 * own. What makes a block interactive is that a visitor acts on it.
 */
export const INTERACTIVE = "interactive";

/**
 * Every category, in the order the palette should offer them.
 *
 * Declared rather than derived from the blocks, because the order is an
 * editorial judgement — layout first because a page starts as structure — and
 * deriving it from registration order would rearrange the palette whenever an
 * unrelated plugin loaded first.
 */
export const CORE_CATEGORIES: readonly [
  typeof LAYOUT,
  typeof CONTENT,
  typeof MEDIA,
  typeof INTERACTIVE,
] = [LAYOUT, CONTENT, MEDIA, INTERACTIVE] as const;

export type CoreCategory = (typeof CORE_CATEGORIES)[number];

/**
 * The core blocks in the order the Add panel offers them within a category:
 * the agreed editor design's order, most used first, rather than the
 * alphabet. Every core block is listed once; a test holds the two together.
 *
 * Separate from `coreBlocks`, whose order is load-bearing for another reason
 * (a container before its child), so neither has to bend to the other.
 */
export const CORE_PALETTE_ORDER: readonly string[] = [
  // Layout
  "core/section",
  "core/box",
  "core/columns",
  "core/column",
  "core/card",
  "core/spacer",
  "core/divider",
  // Text
  "core/heading",
  "core/text",
  "core/list",
  "core/quote",
  "core/rich-text",
  "core/table-of-contents",
  "core/collection-loop",
  // Media
  "core/image",
  "core/gallery",
  "core/embed",
  "core/icon",
  // Interactive
  "core/button",
  "core/accordion",
  "core/accordion-item",
  "core/form",
];
