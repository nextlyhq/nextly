/**
 * A Section's padding preset, as the page compile writes it: Compact or Roomy
 * pads the block from its own pair of the site's spacing variables, in place
 * of the padding its block type gives every Section. Normal is the prop left
 * out, which writes nothing, so a Section that never picked a preset compiles
 * byte for byte as it did before presets existed.
 *
 * Written by the page compile rather than by a renderer, for the reason a
 * container's own content width is (`content-width.ts`): the engine stays the
 * one writer of a page's CSS. It is written as a DEFAULT of that one block,
 * under the weightless anchor the block-type tier uses and after it, so it
 * takes the type default's place while a block style and a side the author
 * sets on the block still win, as they win over the type default.
 *
 * @module style/padding-preset
 */
import type { BlockNode, NodeStyles } from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { pushBoundedWarning, type WarningAllowance } from "./warning-allowance";

/**
 * The prop a Section stores its padding preset in: `"compact"` or `"roomy"`.
 * Left out, or `"normal"`, the Section keeps its type's padding.
 *
 * @experimental
 */
export const PADDING_PRESET_PROP = "paddingPreset";

/**
 * The site variables each preset pads from: one for above and below the
 * content, one for beside it. Normal is the Section's own default,
 * `space.section-y` and `space.gutter`, so it has no row here.
 *
 * @experimental
 */
export const PADDING_PRESETS = {
  compact: { blocks: "space.section-y-compact", sides: "space.gutter-compact" },
  roomy: { blocks: "space.section-y-roomy", sides: "space.gutter-roomy" },
} as const;

/** A preset that writes padding of its own. */
export type PaddingPreset = keyof typeof PADDING_PRESETS;

/** Where a node's preset is read: its pointer, and the warnings to add to. */
export interface PaddingPresetPlace {
  readonly path: string;
  readonly warnings: ValidationIssue[];
  readonly warningAllowance: WarningAllowance;
}

/** The preset a stored value names, or `undefined` for none or Normal. */
function presetNamed(stored: unknown): PaddingPreset | undefined {
  return stored === "compact" || stored === "roomy" ? stored : undefined;
}

/** The value a node stores under {@link PADDING_PRESET_PROP}, if any. */
function storedPreset(node: unknown): unknown {
  if (!isPlainRecord(node) || !isPlainRecord(node.props)) return undefined;
  return node.props[PADDING_PRESET_PROP];
}

/**
 * The variables a node's preset pads from, `[]` where it names none: for every
 * reader that tracks which variables a page uses, so a variable a Section
 * uses only through its preset is never counted unused.
 *
 * @experimental
 */
export function paddingPresetTokensOf(node: unknown): string[] {
  const preset = presetNamed(storedPreset(node));
  if (preset === undefined) return [];
  const pair = PADDING_PRESETS[preset];
  return [pair.blocks, pair.sides];
}

/**
 * The padding a node's preset gives it, as a style envelope the compile writes
 * at the block-type tier, or `undefined` where it names none. A stored value
 * that is no preset writes nothing and says so.
 */
export function paddingPresetStyles(
  node: BlockNode,
  place: PaddingPresetPlace
): NodeStyles | undefined {
  const stored = storedPreset(node);
  if (stored === undefined || stored === null || stored === "normal") {
    return undefined;
  }
  const preset = presetNamed(stored);
  if (preset === undefined) {
    pushBoundedWarning(place.warningAllowance, place.warnings, {
      path: pointer(pointer(place.path, "props"), PADDING_PRESET_PROP),
      code: "invalid-style-value",
      severity: "warning",
      message: `The padding ${describeValue(stored)} is not Compact, Normal or Roomy, so the block's own padding applies.`,
      suggestion: 'Use "compact" or "roomy", or leave it out for Normal.',
    });
    return undefined;
  }
  const blocks = { $token: PADDING_PRESETS[preset].blocks };
  const sides = { $token: PADDING_PRESETS[preset].sides };
  return {
    base: {
      base: {
        padding: {
          blockStart: blocks,
          blockEnd: blocks,
          inlineStart: sides,
          inlineEnd: sides,
        },
      },
    },
  };
}
