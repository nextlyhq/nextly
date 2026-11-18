/**
 * "Turn into" between the three blocks that hold words: Text, Rich text and
 * Heading.
 *
 * Each block declares its converters (`BlockDefinition.converters`); they are
 * written here, side by side, because each pair is one rule read from both
 * ends: what a Text's marks become in a Rich text, and what a Rich text must
 * be to become a Text. The engine's "Turn into" carries what every block keeps
 * whatever its type (its name, styles, block style, visibility, conditions);
 * these say only what the words become, and what is lost.
 *
 * - Text → Rich text keeps the words, bold, italic and links.
 * - Text or Rich text → Heading keeps the words; their formatting is removed,
 *   and said ("Bold and links are removed").
 * - Rich text → Text or Heading only when it is one paragraph or one heading,
 *   and otherwise says why. A heading's level is kept.
 * - Heading → Text or Rich text keeps the words, and a link to an address
 *   around them; a link to an entry cannot be held there and is removed, and
 *   said.
 *
 * @module blocks/text-conversions
 */
import {
  type BlockConversion,
  type BlockConverter,
  isRichTextNode,
  isRichTextValue,
  richTextToPlainText,
  type RichTextNode,
  type RichTextValue,
  toOneParagraph,
} from "@nextlyhq/blocks-engine";

import type { HeadingProps } from "./heading";
import type { ParagraphProps } from "./paragraph";
import { linksToEntry, text, url } from "./props";
import type { RichTextBlockProps } from "./rich-text";

/** The three blocks, by name. */
export const TEXT_BLOCK = "core/text";
export const RICH_TEXT_BLOCK = "core/rich-text";
export const HEADING_BLOCK = "core/heading";

/** What a turn says it loses, or why it refuses. */
export const TURN_INTO_WORDS = {
  marksRemoved: "Bold and links are removed",
  onlyLightMarks: "Only bold, italic and links are kept",
  linkRemoved: "The link is removed",
  relRemoved: "The link's relationship is removed",
  notOneBlockToText:
    "Only a Rich text with one paragraph or one heading can become Text.",
  notOneBlockToHeading:
    "Only a Rich text with one paragraph or one heading can become a Heading.",
} as const;

/** The level a heading is given when nothing says which. */
const DEFAULT_LEVEL = "h2";

/** A level a heading may have, as Rich text and Heading both store it. */
const LEVEL = /^h[1-6]$/;

/** A value of one block, rooted. */
function rooted(children: RichTextNode[]): RichTextValue {
  return { root: { type: "root", children } };
}

/**
 * Whether inline nodes carry anything beyond words and line breaks: a mark, an
 * inline style, a link. Walked with a stack, as every reader of stored rich
 * text is, since a value can nest deep.
 */
function hasFormatting(nodes: readonly unknown[]): boolean {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isRichTextNode(node)) continue;
    if (isFormatted(node)) return true;
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return false;
}

/** Whether one node is itself formatting: a link, a mark, an inline style. */
function isFormatted(node: RichTextNode): boolean {
  if (node.type === "link" || node.type === "autolink") return true;
  if (typeof node.format === "number" && node.format !== 0) return true;
  return typeof node.style === "string" && node.style.trim() !== "";
}

/** A paragraph's inline nodes, as a one-paragraph value holds them. */
function paragraphChildren(value: RichTextValue): RichTextNode[] {
  return value.root.children[0]?.children ?? [];
}

/** Words and their marks as a heading: the words, with what is lost said. */
function asHeading(
  inline: readonly unknown[],
  words: string,
  level: string
): BlockConversion {
  return {
    props: { text: words, level },
    ...(hasFormatting(inline) ? { dropped: TURN_INTO_WORDS.marksRemoved } : {}),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Text → Rich text: the paragraph as it is, marks and links included. */
const textToRichText: BlockConverter<ParagraphProps> = {
  carries: { text: "content" },
  convert: props => ({ props: { content: toOneParagraph(props.text).value } }),
};

/** Text → Heading: the words, on one line, with the marks removed. */
const textToHeading: BlockConverter<ParagraphProps> = {
  carries: { text: "text" },
  convert: props => {
    const value = toOneParagraph(props.text).value;
    return asHeading(
      paragraphChildren(value),
      richTextToPlainText(value),
      DEFAULT_LEVEL
    );
  },
};

/** What a Text can be turned into. */
export const TEXT_CONVERTERS: Readonly<
  Record<string, BlockConverter<ParagraphProps>>
> = {
  [RICH_TEXT_BLOCK]: textToRichText,
  [HEADING_BLOCK]: textToHeading,
};

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

/**
 * The passage's one paragraph or one heading, or `null` when it holds more
 * (two paragraphs, a list, a quote). An empty passage is one empty paragraph,
 * and a value that is not rich text is read as its words.
 */
function oneBlockOf(content: unknown): RichTextNode | null {
  if (!isRichTextValue(content)) {
    return toOneParagraph(content).value.root.children[0] ?? null;
  }
  const blocks = content.root.children;
  if (blocks.length === 0) return { type: "paragraph", children: [] };
  const [only] = blocks;
  if (blocks.length > 1 || !isRichTextNode(only)) return null;
  return only.type === "paragraph" || only.type === "heading" ? only : null;
}

/** Rich text → Text: its one block as a paragraph, light marks kept. */
const richTextToText: BlockConverter<RichTextBlockProps> = {
  carries: { content: "text" },
  convert: props => {
    const block = oneBlockOf(props.content);
    if (block === null) return { refused: TURN_INTO_WORDS.notOneBlockToText };
    const kept = toOneParagraph(rooted([{ ...block, type: "paragraph" }]));
    return {
      props: { text: kept.value },
      ...(kept.dropped ? { dropped: TURN_INTO_WORDS.onlyLightMarks } : {}),
    };
  },
};

/** Rich text → Heading: its one block's words, a heading's level kept. */
const richTextToHeading: BlockConverter<RichTextBlockProps> = {
  carries: { content: "text" },
  convert: props => {
    const block = oneBlockOf(props.content);
    if (block === null) {
      return { refused: TURN_INTO_WORDS.notOneBlockToHeading };
    }
    const tag = block.type === "heading" ? block.tag : undefined;
    return asHeading(
      block.children ?? [],
      richTextToPlainText(rooted([block])),
      typeof tag === "string" && LEVEL.test(tag) ? tag : DEFAULT_LEVEL
    );
  },
};

/** What a Rich text can be turned into. */
export const RICH_TEXT_CONVERTERS: Readonly<
  Record<string, BlockConverter<RichTextBlockProps>>
> = {
  [TEXT_BLOCK]: richTextToText,
  [HEADING_BLOCK]: richTextToHeading,
};

// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------

/**
 * A heading's words as one paragraph's nodes: inside a link where the heading
 * links to an address, and what is lost said where it links to an entry,
 * which a link in a passage cannot hold, or has a relationship a passage's
 * link cannot hold.
 */
function headingInline(props: HeadingProps): {
  readonly inline: RichTextNode[];
  readonly dropped?: string;
} {
  const words: RichTextNode = {
    type: "text",
    text: text(props.text),
    format: 0,
  };
  if (linksToEntry(props)) {
    return {
      inline: paragraphChildren(toOneParagraph(text(props.text)).value),
      dropped: TURN_INTO_WORDS.linkRemoved,
    };
  }
  const href = url(props.href);
  // As the Heading draws it: its words, however spaced, and in the lowercase
  // a link's relationships are read in.
  const rel = [
    ...new Set(text(props.rel).toLowerCase().split(/\s+/).filter(Boolean)),
  ].join(" ");
  const linked: RichTextNode[] =
    href === undefined
      ? [words]
      : [
          {
            type: "link",
            url: href,
            ...(props.target === "_blank" ? { target: "_blank" } : {}),
            ...(rel === "" ? {} : { rel }),
            children: [words],
          },
        ];
  // Through the one restriction, so the link is one a Text can hold and the
  // words are stored as every Text's are.
  const kept = toOneParagraph(
    rooted([{ type: "paragraph", children: linked }])
  );
  const inline = paragraphChildren(kept.value);
  const relKept = inline.some(node => node.type === "link" && node.rel === rel);
  return href === undefined || rel === "" || relKept
    ? { inline }
    : { inline, dropped: TURN_INTO_WORDS.relRemoved };
}

/** Heading → Text: the words, and a link to an address around them. */
const headingToText: BlockConverter<HeadingProps> = {
  carries: { text: "text" },
  convert: props => {
    const { inline, dropped } = headingInline(props);
    return {
      props: { text: rooted([{ type: "paragraph", children: inline }]) },
      ...(dropped === undefined ? {} : { dropped }),
    };
  },
};

/** Heading → Rich text: a heading of the same level inside the passage. */
const headingToRichText: BlockConverter<HeadingProps> = {
  carries: { text: "content" },
  convert: props => {
    const { inline, dropped } = headingInline(props);
    const tag =
      typeof props.level === "string" && LEVEL.test(props.level)
        ? props.level
        : DEFAULT_LEVEL;
    return {
      props: {
        content: rooted([{ type: "heading", tag, children: inline }]),
      },
      ...(dropped === undefined ? {} : { dropped }),
    };
  },
};

/** What a Heading can be turned into. */
export const HEADING_CONVERTERS: Readonly<
  Record<string, BlockConverter<HeadingProps>>
> = {
  [TEXT_BLOCK]: headingToText,
  [RICH_TEXT_BLOCK]: headingToRichText,
};
