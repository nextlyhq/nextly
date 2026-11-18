/**
 * What the Style tab's "Text style" picker reads and writes.
 *
 * A text style is a named class with the text role (`textStylesOf`), worn
 * from a block's class list beside its block style and shared style. A block
 * wears one at most: picking one writes or replaces that one entry and
 * leaves the block's other classes where they were, so the document's shape
 * is the one it already had.
 *
 * Pure, so the rules are testable without a DOM; `text-style-picker.tsx`
 * draws them.
 *
 * @module text-style-choice
 */
import {
  BASE_BREAKPOINT,
  findNode,
  isTextStyle,
  textStylesOf,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type StyleValue,
  type TokenMode,
} from "@nextlyhq/blocks-engine";

import { nodeHasRoom } from "./class-library";
import { lengthInPx } from "./fluid-size";
import { designReadOnlyReason, type LockView } from "./inspector";
import type { BuilderOp } from "./op-vocabulary";
import { sharedStyleName } from "./shared-style-library";
import { pairWords, valueText } from "./site-text-rows";

/** One text style as the picker lists it. */
export interface TextStyleOption {
  readonly id: string;
  /** Its name, as the author gave it. */
  readonly name: string;
  /** Its size and line height ("12 / 1.4"), its variables read. */
  readonly pair: string;
  /** What its sample text is drawn with. */
  readonly preview: TextStylePreview;
}

/** The inline style a sample is drawn with: only what could be read. */
export interface TextStylePreview {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  letterSpacing?: string;
  textTransform?: string;
}

/** The sizes a preview is drawn between, in px, so every row fits its line. */
const PREVIEW_PX = { min: 11, max: 20 } as const;

/** A style's values at the widest device, which the preview shows. */
function baseValues(styles: NodeStyles): Readonly<Record<string, StyleValue>> {
  const values: unknown = styles.base?.[BASE_BREAKPOINT];
  return typeof values === "object" && values !== null
    ? (values as Record<string, StyleValue>)
    : {};
}

/**
 * The site's text styles, in the order they override one another, each with
 * its name, pair and preview. Empty while the library is unread, or for a
 * site with none.
 */
export function textStyleOptions(
  library: readonly NamedClass[] | undefined,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): TextStyleOption[] {
  if (library === undefined) return [];
  const set = tokens ?? { tokens: [] };
  return textStylesOf(library).map(style => {
    const values = baseValues(style.styles);
    return {
      id: style.id,
      name: sharedStyleName(style),
      pair: pairWords(
        valueText(values.fontSize, set, mode),
        valueText(values.lineHeight, set, mode)
      ),
      preview: textStylePreview(style.styles, set, mode),
    };
  });
}

/**
 * The inline style a text style's sample is drawn with, at the widest
 * device: its font, weight, letter spacing and case as they are, and its
 * size scaled into a row's bounds so a display size still fits. A value that
 * reads no variable the site has is left out rather than guessed.
 */
export function textStylePreview(
  styles: NodeStyles,
  tokens: SiteTokenSet,
  mode: TokenMode
): TextStylePreview {
  const values = baseValues(styles);
  const read = (property: string): string | undefined =>
    valueText(values[property], tokens, mode);
  const preview: TextStylePreview = {};
  const family = read("fontFamily");
  if (family !== undefined) preview.fontFamily = family;
  const weight = read("fontWeight");
  if (weight !== undefined) preview.fontWeight = weight;
  const spacing = read("letterSpacing");
  if (spacing !== undefined) preview.letterSpacing = spacing;
  const transform = read("textTransform");
  if (transform !== undefined) preview.textTransform = transform;
  const size = read("fontSize");
  const px = size === undefined ? undefined : lengthInPx(size);
  if (px !== undefined) {
    const scaled = Math.min(
      PREVIEW_PX.max,
      Math.max(PREVIEW_PX.min, px * 0.55)
    );
    preview.fontSize = `${String(Math.round(scaled * 10) / 10)}px`;
  }
  return preview;
}

/**
 * The text style a block wears: the first of its classes that is one of the
 * site's usable text styles, or `undefined`.
 */
export function wornTextStyle(
  library: readonly NamedClass[] | undefined,
  classIds: readonly string[]
): NamedClass | undefined {
  if (library === undefined) return undefined;
  const styles = textStylesOf(library);
  for (const id of classIds) {
    const found = styles.find(style => style.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** A plan for the picker's write: the ops, or why there are none. */
export type TextStylePlan =
  | { readonly ok: true; readonly ops: BuilderOp[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The class list a pick leaves on a block: `id` in the place of the text
 * style it wore (or after its classes, where it wore none), and with `null`
 * no text style at all. Every class the library marks as a text style is
 * taken off, an unusable one too, so a block never ends wearing two.
 *
 * Refused for a block whose design is held, for an id that is not one of
 * the site's text styles, and where the block has no room for another class.
 */
export function planTextStyle(
  document: BlockDocument,
  nodeId: string,
  library: readonly NamedClass[],
  id: string | null,
  view?: LockView
): TextStylePlan {
  const held = designReadOnlyReason(document, nodeId, view);
  const node = findNode(document.nodes, nodeId);
  if (held !== undefined || node === undefined) {
    return {
      ok: false,
      reason: held ?? "This block is no longer on the page.",
    };
  }
  if (id !== null && !textStylesOf(library).some(style => style.id === id)) {
    return { ok: false, reason: "That text style is no longer on this site." };
  }
  const classes = node.classes ?? [];
  const isText = (classId: string): boolean =>
    library.some(entry => entry.id === classId && isTextStyle(entry));
  const at = classes.findIndex(isText);
  const kept = classes.filter(classId => !isText(classId));
  // The first text style worn is the place the pick takes: every class
  // before it is kept, so its index in `kept` is the same.
  const next =
    id === null
      ? kept
      : at === -1
        ? [...kept, id]
        : [...kept.slice(0, at), id, ...kept.slice(at)];
  if (sameIds(next, classes)) return { ok: true, ops: [] };
  if (at === -1 && id !== null && !nodeHasRoom(classes)) {
    return {
      ok: false,
      reason: "This block already lists as many styles as the page applies.",
    };
  }
  return {
    ok: true,
    ops: [
      next.length > 0
        ? { kind: "update", id: nodeId, patch: { classes: next } }
        : { kind: "update", id: nodeId, patch: {}, unset: ["classes"] },
    ],
  };
}

/** Two id lists by value. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((each, index) => each === b[index]);
}
