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

/** What the node's text is drawn with: its own, its type's, its container's. */
function paintedBy(
  node: BlockNode,
  around: Painted,
  blocks: ResolvedPage["blocks"]
): Painted {
  const own = coloursIn(node.styles);
  // The block type's own look (a Button's blue), under the node's own.
  const type = coloursIn(blocks(node.type)?.baseStyles);
  const color = own.color ?? type.color ?? around.color;
  const background = own.background ?? type.background ?? around.background;
  const obscuring = contrastObscuringIn(node.styles);
  const opaque = (own.background ?? type.background) !== undefined;
  const look = node.props.look;
  return {
    ...(color === undefined ? {} : { color }),
    ...(background === undefined ? {} : { background }),
    chosen:
      around.chosen || own.color !== undefined || own.background !== undefined,
    // A background of its own covers what its container paints behind it.
    backdrop: obscuring.local !== undefined || (!opaque && around.backdrop),
    subtree: around.subtree || obscuring.subtree !== undefined,
    unknown:
      around.unknown ||
      (node.classes?.length ?? 0) > 0 ||
      (typeof look === "string" && look !== ""),
  };
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
  while (stack.length > 0) {
    const { node, around } = stack.pop() as { node: unknown; around: Painted };
    if (typeof node !== "object" || node === null || seen.has(node)) continue;
    seen.add(node);
    const block = node as BlockNode;
    if (typeof block.type !== "string" || typeof block.props !== "object") {
      continue;
    }
    const painted = paintedBy(block, around, page.blocks);
    if (TEXT_BLOCKS.has(block.type)) {
      const finding = contrastFinding(block, painted, page.tokens);
      if (finding !== undefined) found.push(finding);
    }
    const children = Object.values(block.slots ?? {}).flatMap(slot =>
      Array.isArray(slot) ? slot : []
    );
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
