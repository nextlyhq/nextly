/**
 * The site's spacing variables as presets: which a spacing value offers,
 * smallest first, which one a stored value holds, and how each is named. The
 * one reading both a spacing-box side's popover and a Spacer's Height
 * presets take, so the two offer the same scale the same way.
 *
 * @module spacing-presets
 */
import {
  isTokenRef,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { useCanvasTokenMode } from "./canvas/prefers-dark";
import { variableLabel, variablesFor, type SiteVariable } from "./style-colour";
import type { StyleControl } from "./style-controls";
import { storedText } from "./style-text-field";
import { lengthInPx, variableValueText } from "./style-variables";
import { variableGroupOf } from "./tokens-studio";

/** "None", the preset that writes nothing between the edges. */
export const NONE = "zero";

/**
 * A preset's key in the radio group: a variable's under a prefix, so no
 * variable's identity ("none", "zero") can be taken for the zero preset.
 */
export function presetKey(identity: string): string {
  return `token:${identity}`;
}

/** The variable a preset's key stands for, or none for the zero preset. */
export function identityOfKey(key: string): string | undefined {
  return key.startsWith("token:") ? key.slice("token:".length) : undefined;
}

/** A zero length as it may be stored: "0", "0px", "0rem". */
const ZERO = /^[+-]?0*(?:\.0*)?(?:[a-z%]+)?$/i;

/**
 * The site's spacing variables, smallest first, the order a scale is read
 * in. One with no single size (fluid, or through a function) goes last.
 */
export function spacingPresets(
  control: StyleControl,
  tokens: SiteTokenSet | undefined,
  mode: ReturnType<typeof useCanvasTokenMode>
): readonly SiteVariable[] {
  const size = (variable: SiteVariable): number =>
    lengthInPx(variable.value) ?? Number.POSITIVE_INFINITY;
  return variablesFor(control.leaf, tokens, mode)
    .filter(
      variable =>
        variable.kind === "dimension" && variableGroupOf(variable) === "spacing"
    )
    .sort((a, b) => size(a) - size(b));
}

/**
 * The preset to mark: the one the side holds, where the popover offers it. A
 * variable that is not a spacing preset (a radius) marks none, so the first
 * preset keeps the group's Tab stop.
 */
export function offeredPreset(
  stored: StyleValue | undefined,
  presets: readonly SiteVariable[]
): string | undefined {
  const held = heldPreset(stored);
  return held === NONE ||
    presets.some(preset => presetKey(preset.identity) === held)
    ? held
    : undefined;
}

/** The preset a side holds: its variable, "None" for a zero, else none. */
export function heldPreset(stored: StyleValue | undefined): string | undefined {
  if (isTokenRef(stored)) return presetKey(stored.$token);
  if (stored === undefined) return undefined;
  return ZERO.test(storedText(stored)) && /\d/.test(storedText(stored))
    ? NONE
    : undefined;
}

/** Each preset's name, then its value in a quieter tone; "None" first. */
export function presetLabels(
  presets: readonly SiteVariable[]
): Readonly<Record<string, React.ReactNode>> {
  const labels: Record<string, React.ReactNode> = {
    [NONE]: (
      <>
        None <span className="nx-spacing-popover__preset-value">0</span>
      </>
    ),
  };
  for (const preset of presets) {
    labels[presetKey(preset.identity)] = (
      <>
        {/* Qualified where two presets share a name, as every variable
            list here qualifies it. */}
        {variableLabel(preset, presets)}{" "}
        <span className="nx-spacing-popover__preset-value">
          {variableValueText(preset)}
        </span>
      </>
    );
  }
  return labels;
}
