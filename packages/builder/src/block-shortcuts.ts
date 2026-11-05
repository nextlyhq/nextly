/**
 * Shortcuts over a block's Style values: a Section's height, a Button's size
 * and its full width. Each writes the ordinary Style value at the device and
 * state being edited, and reads back from what is stored there, so a value
 * set any other way shows as none of its choices rather than as a wrong one.
 *
 * @module block-shortcuts
 */
import {
  getBlock,
  isTokenRef,
  type BlockNode,
  type BreakpointId,
  type StyleState,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { chainedStyleOp } from "./columns-layout";
import type { BuilderOp } from "./ops";
import { readStyleValue } from "./style-values";

/** The core blocks these shortcuts belong to. */
export const SECTION_BLOCK = "core/section";
export const BUTTON_BLOCK = "core/button";

/** Where a shortcut writes: the state and the device being edited. */
export interface ShortcutAt {
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
}

/** A value stored at the edited address, for one top-level property. */
function storedAt(
  node: BlockNode,
  at: ShortcutAt,
  property: string
): StyleValue | undefined {
  return readStyleValue(node.styles, { ...at, property, path: [] });
}

/** One write, or with `null` a clear, of a property at the edited address. */
function written(
  node: BlockNode,
  at: ShortcutAt,
  steps: readonly (readonly [string, StyleValue | null])[]
): BuilderOp | null {
  return chainedStyleOp(
    node,
    steps.map(([property, value]) => ({
      address: { ...at, property, path: [] },
      value,
    }))
  );
}

// --- a Section's height

/** At least the screen's height: `svh`, so a phone's toolbar hides none of it. */
const FULL_SCREEN = "100svh";

export type HeightChoice = "auto" | "screen";

/** Auto while no min height is set here, Full screen for its own, else none. */
export function heightOf(
  node: BlockNode,
  at: ShortcutAt
): HeightChoice | undefined {
  const stored = storedAt(node, at, "minHeight");
  if (stored === undefined) return "auto";
  return stored === FULL_SCREEN ? "screen" : undefined;
}

/** Full screen writes its min height here; Auto clears it. */
export function planHeight(
  node: BlockNode,
  choice: HeightChoice,
  at: ShortcutAt
): BuilderOp | null {
  return written(node, at, [
    ["minHeight", choice === "screen" ? FULL_SCREEN : null],
  ]);
}

// --- a Button's size

export type SizeChoice = "small" | "medium" | "large";

/**
 * How Small and Large differ from the button's own: its padding tokens
 * scaled, so the sizes follow the site's design and keep their order, and
 * its text in em, relative to what it inherits.
 */
const SIZES = {
  small: { times: 0.75, text: "0.875em" },
  large: { times: 1.25, text: "1.125em" },
} as const;

/** The block's own padding, side by side, as its definition sets it. */
function basePadding(node: BlockNode): Record<string, unknown> | undefined {
  const base = (
    getBlock(node.type)?.baseStyles as
      | { base?: { base?: Record<string, unknown> } }
      | undefined
  )?.base?.base?.padding;
  return typeof base === "object" && base !== null && !Array.isArray(base)
    ? (base as Record<string, unknown>)
    : undefined;
}

/**
 * The block's padding with every side's token scaled, or `undefined` where a
 * side is not a token: a literal has no design to follow.
 */
function scaledPadding(
  node: BlockNode,
  times: number
): Record<string, StyleValue> | undefined {
  const base = basePadding(node);
  if (base === undefined) return undefined;
  const sides: Record<string, StyleValue> = {};
  for (const [side, value] of Object.entries(base)) {
    if (!isTokenRef(value)) return undefined;
    sides[side] = { $token: value.$token, times };
  }
  return sides;
}

/** Whether two paddings say the same, side by side, whatever their order. */
function samePadding(
  stored: StyleValue | undefined,
  expected: Record<string, StyleValue>
): boolean {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored))
    return false;
  const sides = stored as Record<string, StyleValue>;
  const keys = Object.keys(expected);
  return (
    Object.keys(sides).length === keys.length &&
    keys.every(
      side => JSON.stringify(sides[side]) === JSON.stringify(expected[side])
    )
  );
}

/** Whether the button can be sized: its padding is its design's tokens. */
export function sizesOffered(node: BlockNode): boolean {
  return scaledPadding(node, 1) !== undefined;
}

/**
 * Medium while neither its padding nor its text size is set here, Small or
 * Large where both are what that size writes, else none of the three.
 */
export function sizeOf(
  node: BlockNode,
  at: ShortcutAt
): SizeChoice | undefined {
  const padding = storedAt(node, at, "padding");
  const text = storedAt(node, at, "fontSize");
  if (padding === undefined && text === undefined) return "medium";
  for (const size of ["small", "large"] as const) {
    const scaled = scaledPadding(node, SIZES[size].times);
    if (
      scaled !== undefined &&
      samePadding(padding, scaled) &&
      text === SIZES[size].text
    ) {
      return size;
    }
  }
  return undefined;
}

/** Small or Large writes its padding and text size here; Medium clears both. */
export function planSize(
  node: BlockNode,
  size: SizeChoice,
  at: ShortcutAt
): BuilderOp | null {
  if (size === "medium") {
    return written(node, at, [
      ["padding", null],
      ["fontSize", null],
    ]);
  }
  const padding = scaledPadding(node, SIZES[size].times);
  if (padding === undefined) return null;
  return written(node, at, [
    ["padding", padding],
    ["fontSize", SIZES[size].text],
  ]);
}

// --- a Button's full width

/** Whether the button is as wide as its container here. */
export function fullWidthOf(node: BlockNode, at: ShortcutAt): boolean {
  return storedAt(node, at, "width") === "100%";
}

/** On writes a width of 100% here; off clears it. */
export function planFullWidth(
  node: BlockNode,
  on: boolean,
  at: ShortcutAt
): BuilderOp | null {
  return written(node, at, [["width", on ? "100%" : null]]);
}
