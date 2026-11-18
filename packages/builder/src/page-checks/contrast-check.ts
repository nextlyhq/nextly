/**
 * The contrast check: text whose colour against its background falls below
 * WCAG AA, 4.5:1, or 3:1 for a heading, which is large text.
 *
 * Judged only where both colours are known, and only where the author chose
 * one of them on the block or a container around it: the site's own text on
 * its own background is the site's design, not one block's. A colour a
 * block takes from a shared style or a block style isn't known here, so that
 * block isn't judged. Text over an image or a gradient, or under opacity, a
 * filter or a blend, has no colour to measure, so it is skipped and the list
 * says so, never guessed.
 *
 * Measured with the editor's own reading of colours (`contrastOf`), in light
 * mode and again in dark mode where the site's variables give either colour
 * a different value there.
 *
 * @module page-checks/contrast-check
 */
import {
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import {
  contrastObscuringIn,
  contrastOf,
  contrastRatioText,
} from "../style-colour";

import type { PageCheck, PageCheckResult, ResolvedPage } from "./page-checks";
import { eachRichTextNode } from "./rich-text-parts";

/** The blocks that draw text, each judged against its background. */
const TEXT_BLOCKS: ReadonlySet<string> = new Set([
  "core/text",
  "core/heading",
  "core/rich-text",
  "core/button",
  "core/quote",
  "core/list",
]);

/** The block drawn as large text, held to 3:1. */
const LARGE_TEXT = "core/heading";

/** The site's text and background, where nothing on the page sets them. */
const SITE_TEXT: StyleValue = { $token: "color.text" } as StyleValue;
const SITE_BACKGROUND: StyleValue = {
  $token: "color.background",
} as StyleValue;

/** What a block's text is drawn with, read down from the page. */
interface Painted {
  readonly color?: StyleValue;
  readonly background?: StyleValue;
  /** Whether the author set either colour here or on a container. */
  readonly chosen: boolean;
  /**
   * Whether an image, gradient or shadow is painted behind the text, which
   * an opaque background in front of it covers.
   */
  readonly backdrop: boolean;
  /** Whether opacity, a filter or a blend alters everything inside. */
  readonly subtree: boolean;
  /** Whether a colour comes from somewhere this check can't read. */
  readonly unknown: boolean;
}

/** A node's text colour and background at its base state and width. */
interface Colours {
  readonly color?: StyleValue;
  readonly background?: StyleValue;
}

/** The colours set in one node's styles, at its base state and width. */
function coloursIn(styles: NodeStyles | undefined): Colours {
  const values = styles?.base?.base as
    | Readonly<Record<string, StyleValue | undefined>>
    | undefined;
  return {
    ...(values?.color === undefined ? {} : { color: values.color }),
    ...(values?.backgroundColor === undefined
      ? {}
      : { background: values.backgroundColor }),
  };
}

/** The block type's own look (a Button's blue), as the site has edited it. */
function typeColours(
  type: string,
  { blocks, siteLooks }: Pick<ResolvedPage, "blocks" | "siteLooks">
): Colours {
  const site = coloursIn(siteLooks[type]);
  const base = coloursIn(blocks(type)?.baseStyles);
  const color = site.color ?? base.color;
  const background = site.background ?? base.background;
  return {
    ...(color === undefined ? {} : { color }),
    ...(background === undefined ? {} : { background }),
  };
}

/**
 * What stands over the block's colours, from every tier it is drawn with:
 * its own styles, the site's edit of its type's look and the type's own.
 */
function obscuringOf(
  node: BlockNode,
  { blocks, siteLooks }: Pick<ResolvedPage, "blocks" | "siteLooks">
): { readonly local?: string; readonly subtree?: string } {
  const tiers = [
    node.styles,
    siteLooks[node.type],
    blocks(node.type)?.baseStyles,
  ].map(contrastObscuringIn);
  const local = tiers.find(tier => tier.local !== undefined)?.local;
  const subtree = tiers.find(tier => tier.subtree !== undefined)?.subtree;
  return {
    ...(local === undefined ? {} : { local }),
    ...(subtree === undefined ? {} : { subtree }),
  };
}

/**
 * Whether the block draws any words: text it stores, words in its rich text,
 * or text bound to a field, which the entry gives. One with none has no
 * text to read, so nothing to judge.
 */
function drawsWords(node: BlockNode): boolean {
  if (Object.keys(node.bindings ?? {}).length > 0) return true;
  if (WORD_PROPS.some(prop => hasText(node.props[prop]))) return true;
  let words = false;
  eachRichTextNode(node, part => {
    if (hasText(part.text)) words = true;
  });
  return words;
}

/** Whether a value is text with something in it. */
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** The props a text block keeps its plain words in: a Heading's, a Button's. */
const WORD_PROPS: readonly string[] = ["text", "label"];

/** Whether a block's colours come from somewhere this check can't read. */
function unreadable(node: BlockNode): boolean {
  const look = node.props.look;
  if ((node.classes?.length ?? 0) > 0) return true;
  if (typeof look === "string" && look !== "") return true;
  return colouredInline(node);
}

/** The first colour set, nearest first. */
function nearest(
  ...colours: readonly (StyleValue | undefined)[]
): StyleValue | undefined {
  return colours.find(colour => colour !== undefined);
}

/** What the node's text is drawn with: its own, its type's, its container's. */
function paintedBy(
  node: BlockNode,
  around: Painted,
  page: Pick<ResolvedPage, "blocks" | "siteLooks">
): Painted {
  const own = coloursIn(node.styles);
  const type = typeColours(node.type, page);
  const color = nearest(own.color, type.color, around.color);
  const background = nearest(
    own.background,
    type.background,
    around.background
  );
  const obscuring = obscuringOf(node, page);
  // A background of its own covers what its container paints behind it.
  const covered = nearest(own.background, type.background) !== undefined;
  return {
    ...(color === undefined ? {} : { color }),
    ...(background === undefined ? {} : { background }),
    chosen:
      around.chosen || own.color !== undefined || own.background !== undefined,
    backdrop: obscuring.local !== undefined || (!covered && around.backdrop),
    subtree: around.subtree || obscuring.subtree !== undefined,
    unknown: around.unknown || unreadable(node),
  };
}

/** Inline styles that change what colour a run of text is drawn in. */
const INLINE_COLOUR = /(^|;)\s*(color|background(-color)?|opacity)\s*:/i;

/**
 * Whether the block's rich text gives some of its runs a colour, background
 * or opacity of their own: its text is then not one pair, so it isn't judged
 * as one.
 */
function colouredInline(node: BlockNode): boolean {
  let coloured = false;
  eachRichTextNode(node, part => {
    if (typeof part.style === "string" && INLINE_COLOUR.test(part.style)) {
      coloured = true;
    }
  });
  return coloured;
}

/** Text this many px or more is large, as WCAG counts it (18pt). */
const LARGE_PX = 24;

/** A font size in px, where the stored value says it plainly. */
function fontSizePx(value: unknown): number | undefined {
  if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value.trim());
    if (match === null) return undefined;
    return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
  }
  if (typeof value === "object" && value !== null) {
    const { value: size, unit } = value as { value?: unknown; unit?: unknown };
    if (typeof size !== "number") return undefined;
    if (unit === "px") return size;
    return unit === "rem" ? size * 16 : undefined;
  }
  return undefined;
}

/**
 * Whether the block's text is large, held to 3:1: a size of its own that
 * reaches 24px, or, with none, a Heading at level 1 or 2, which the site's
 * type sizes draw large. A size it sets that can't be read isn't large.
 */
function isLargeText(node: BlockNode): boolean {
  const values = node.styles?.base?.base as
    | Readonly<Record<string, unknown>>
    | undefined;
  if (values?.fontSize !== undefined) {
    const px = fontSizePx(values.fontSize);
    return px !== undefined && px >= LARGE_PX;
  }
  const level = node.props.level;
  return node.type === LARGE_TEXT && (level === "h1" || level === "h2");
}

/** The ratio a block's text needs. */
function threshold(node: BlockNode): number {
  return isLargeText(node) ? 3 : 4.5;
}

const WHY =
  "People with low vision, or reading in bright light, may not be able to read it.";

/** The block's finding, or none where its text reads or can't be judged. */
function contrastFinding(
  node: BlockNode,
  painted: Painted,
  tokens: SiteTokenSet | undefined
): PageCheckResult | undefined {
  if (painted.unknown) return undefined;
  if (painted.backdrop || painted.subtree) {
    return {
      nodeId: node.id,
      part: "skipped",
      what: "Contrast not checked: text over an image or gradient",
      why: "The colours behind the text can change across the picture, so no one ratio can be measured.",
      todo: "Check the text reads well over the whole picture, or give it a solid background.",
    };
  }
  if (!painted.chosen) return undefined;
  const color = painted.color ?? SITE_TEXT;
  const background = painted.background ?? SITE_BACKGROUND;
  const light = contrastOf(color, background, tokens, "light");
  if (light === undefined) return undefined;
  const dark = contrastOf(color, background, tokens, "dark");
  const needs = threshold(node);
  const lightFails = light.ratio < needs;
  // Dark mode is its own answer only where the colours differ there.
  const darkFails =
    dark !== undefined && dark.ratio !== light.ratio && dark.ratio < needs;
  if (!lightFails && !darkFails) return undefined;
  const what = lightFails
    ? `Text contrast is too low: ${contrastRatioText(light)}${
        darkFails && dark !== undefined
          ? ` (${contrastRatioText(dark)} in dark mode)`
          : ""
      }`
    : `Text contrast is too low in dark mode: ${contrastRatioText(dark ?? light)}`;
  return {
    nodeId: node.id,
    what,
    why: WHY,
    todo: `Use a darker text colour or a lighter background, for at least ${String(needs)}:1.`,
    fix: { tab: "style", id: "color" },
  };
}

/** Every text block whose contrast is too low, or which couldn't be judged. */
/** A stored entry read as a block, or none where it can't be. */
function asBlock(entry: unknown): BlockNode | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const block = entry as BlockNode;
  return typeof block.type === "string" && typeof block.props === "object"
    ? block
    : undefined;
}

/** A block's children in drawing order, across its slots. */
function childrenOf(block: BlockNode): unknown[] {
  return Object.values(block.slots ?? {}).flatMap(slot =>
    Array.isArray(slot) ? slot : []
  );
}

/** The block's finding, where it is a text block that draws words. */
function judged(
  block: BlockNode,
  painted: Painted,
  page: ResolvedPage
): PageCheckResult | undefined {
  if (!TEXT_BLOCKS.has(block.type) || !drawsWords(block)) return undefined;
  return contrastFinding(block, painted, page.tokens);
}

function contrastFindings(page: ResolvedPage): PageCheckResult[] {
  const found: PageCheckResult[] = [];
  const start: Painted = {
    chosen: false,
    backdrop: false,
    subtree: false,
    unknown: false,
  };
  const stack: { node: unknown; around: Painted }[] = [...page.drawn]
    .reverse()
    .map(node => ({ node, around: start }));
  const seen = new Set<unknown>();
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const block = seen.has(next.node) ? undefined : asBlock(next.node);
    if (block === undefined) continue;
    seen.add(block);
    const painted = paintedBy(block, next.around, page);
    const finding = judged(block, painted, page);
    if (finding !== undefined) found.push(finding);
    const children = childrenOf(block);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], around: painted });
    }
  }
  return found;
}

/** Text that is hard to read against its background, in light and dark. */
export const CONTRAST_CHECK: PageCheck = {
  id: "contrast",
  group: "accessibility",
  run: contrastFindings,
};
