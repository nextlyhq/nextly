/**
 * An Accordion's Icon, chosen in its Content tab: "+ / −", "Chevron" or
 * "None".
 *
 * Which icon the questions show is what the block shows, so it is a Content
 * choice, though it writes a style value: the accordion's own
 * `disclosureIcon` at its base values, whatever device or state the Style
 * tab is editing, as a Gallery's Columns tiles write its grid. How the icon
 * sits (Icon position) stays in Style.
 *
 * What the tiles read is the accordion's own base value, read as the engine
 * reads a keyword, else the block's default; a stored "browser", which is no
 * longer offered, draws the plus (`disclosure.ts`), so it reads as one.
 *
 * @module accordion-icon
 */
import {
  asciiLower,
  BASE_BREAKPOINT,
  decodeIdentifier,
  getBlock,
  trimCssWhitespace,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { chainedStyleOp } from "../../columns-layout";
import type { BuilderOp } from "../../op-vocabulary";
import { readStyleValue, type StyleAddress } from "../../style-values";

/** The Accordion's registered name. */
export const ACCORDION_BLOCK = "core/accordion";

/** The icons the Content tab offers, in its order. */
export const ACCORDION_ICONS = ["plus", "chevron", "none"] as const;

/** One of {@link ACCORDION_ICONS}. */
export type AccordionIcon = (typeof ACCORDION_ICONS)[number];

/** What each icon is called. */
export const ACCORDION_ICON_WORDS: Readonly<Record<AccordionIcon, string>> = {
  plus: "+ / −",
  chevron: "Chevron",
  none: "None",
};

/** The style key the choice writes. */
const PROPERTY = "disclosureIcon";

/** Where the choice writes: the accordion's own base values. */
const ADDRESS: StyleAddress = {
  state: "base",
  breakpoint: BASE_BREAKPOINT,
  property: PROPERTY,
  path: [],
};

/** A stored keyword as one of the offered icons, if it reads as one. */
function offeredIcon(value: unknown): AccordionIcon | undefined {
  if (typeof value !== "string") return undefined;
  const keyword = asciiLower(decodeIdentifier(trimCssWhitespace(value)));
  // The browser's marker is no longer drawn: a stored one draws the plus.
  if (keyword === "browser") return "plus";
  return ACCORDION_ICONS.find(each => each === keyword);
}

/** The icon the block's own defaults draw, read from its definition. */
function defaultIcon(type: string): AccordionIcon | undefined {
  const base = getBlock(type)?.baseStyles?.base?.[BASE_BREAKPOINT];
  return offeredIcon(base?.[PROPERTY]);
}

/**
 * The icon the tiles show as chosen: the accordion's own base value, else
 * the one reaching it from elsewhere at its base values (a shared style it
 * wears, read from the canvas's cascade by the caller), else its default.
 * `undefined` where the one in force is not an offered icon (a CSS-wide
 * keyword stored by hand), so no tile claims it.
 */
export function accordionIconOf(
  node: BlockNode,
  inherited?: string
): AccordionIcon | undefined {
  const stored = readStyleValue(node.styles, ADDRESS);
  if (stored !== undefined) return offeredIcon(stored);
  return inherited === undefined
    ? defaultIcon(node.type)
    : offeredIcon(inherited);
}

/** Choosing an icon, as ONE op; `null` where it changes nothing. */
export function planAccordionIcon(
  node: BlockNode,
  icon: AccordionIcon
): BuilderOp | null {
  return chainedStyleOp(node, [{ address: ADDRESS, value: icon }]);
}

/**
 * Removing the accordion's own icon, as ONE op, so what a shared style or
 * the block's default sets shows again; `null` where it holds none.
 */
export function planAccordionIconReset(node: BlockNode): BuilderOp | null {
  return chainedStyleOp(node, [{ address: ADDRESS, value: null }]);
}

/** Whether the accordion stores an icon of its own, for its section's dot. */
export function accordionIconHoldsValue(node: BlockNode): boolean {
  return readStyleValue(node.styles, ADDRESS) !== undefined;
}
