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
 * never what they say.
 */
export const LAYOUT = "layout";

/**
 * What the page says.
 *
 * Includes `core/divider`, which is a semantic thematic break rather than
 * spacing — `core/spacer` is the layout counterpart, pure space with no
 * meaning. And `core/collection-loop`, which lives here until there are enough
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
export const CORE_CATEGORIES = [LAYOUT, CONTENT, MEDIA, INTERACTIVE] as const;

export type CoreCategory = (typeof CORE_CATEGORIES)[number];
