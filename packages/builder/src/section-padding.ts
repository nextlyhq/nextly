/**
 * A Section's Padding as Compact, Normal or Roomy: what it reads as, and the
 * one op a choice makes.
 *
 * The preset is one of the block's own settings (`paddingPreset`), and
 * Normal is the setting left out, so a Section that never picks one stores
 * nothing new. "Custom" is never stored: it is read back while any side of
 * the block's padding holds a value of its own, on any device or state,
 * since that value is what the browser shows there. Choosing a preset clears
 * those values in the same op that sets it, so one undo brings both back.
 *
 * @module section-padding
 */
import {
  PADDING_PRESET_PROP,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/** The choices, in the order they are drawn. */
export const PADDING_CHOICES = ["compact", "normal", "roomy"] as const;

/** One of {@link PADDING_CHOICES}. */
export type PaddingChoice = (typeof PADDING_CHOICES)[number];

/** Each choice in the words drawn on it. */
export const PADDING_LABELS: Readonly<Record<PaddingChoice, string>> = {
  compact: "Compact",
  normal: "Normal",
  roomy: "Roomy",
};

/** A record a walk may read keys from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether any device of any state of these styles holds its own padding. */
export function holdsOwnPadding(styles: NodeStyles | undefined): boolean {
  if (!isRecord(styles)) return false;
  return Object.values(styles).some(
    byBreakpoint =>
      isRecord(byBreakpoint) &&
      Object.values(byBreakpoint).some(
        values => isRecord(values) && Object.hasOwn(values, "padding")
      )
  );
}

/** The preset a node stores, read as a choice: Normal for none. */
function storedChoice(node: BlockNode): PaddingChoice {
  const stored = node.props[PADDING_PRESET_PROP];
  return stored === "compact" || stored === "roomy" ? stored : "normal";
}

/** What a Section's Padding reads as: a choice, or `"custom"`. */
export function paddingReading(node: BlockNode): PaddingChoice | "custom" {
  return holdsOwnPadding(node.styles) ? "custom" : storedChoice(node);
}

/** The styles with every padding taken out, pruning what empties. */
function withoutPadding(styles: NodeStyles): NodeStyles {
  const states: Record<string, unknown> = {};
  for (const [state, byBreakpoint] of Object.entries(styles)) {
    if (!isRecord(byBreakpoint)) {
      states[state] = byBreakpoint;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
      if (!isRecord(values)) {
        kept[breakpoint] = values;
        continue;
      }
      const { padding: _padding, ...rest } = values;
      if (Object.keys(rest).length > 0) kept[breakpoint] = rest;
    }
    if (Object.keys(kept).length > 0) states[state] = kept;
  }
  return states;
}

/** The props with the preset set, or taken out for Normal. */
function propsFor(
  node: BlockNode,
  choice: PaddingChoice
): Record<string, unknown> {
  const { [PADDING_PRESET_PROP]: _old, ...rest } = node.props;
  return choice === "normal"
    ? rest
    : { ...rest, [PADDING_PRESET_PROP]: choice };
}

/**
 * The one op choosing a preset makes: the preset set (or, for Normal, taken
 * out) and every padding of the block's own cleared, or `null` when the block
 * already reads as that choice.
 */
export function planPadding(
  node: BlockNode,
  choice: PaddingChoice
): BuilderOp | null {
  if (paddingReading(node) === choice) return null;
  const props = propsFor(node, choice);
  if (!holdsOwnPadding(node.styles)) {
    return { kind: "update", id: node.id, patch: { props } };
  }
  const styles = withoutPadding(node.styles as NodeStyles);
  return Object.keys(styles).length > 0
    ? { kind: "update", id: node.id, patch: { props, styles } }
    : { kind: "update", id: node.id, patch: { props }, unset: ["styles"] };
}
