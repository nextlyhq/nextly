/**
 * The spacing box: margin and padding drawn as one box in the Style tab.
 * Which properties form it, and the keyboard half of its sides.
 *
 * A side resets by key rather than by Tab: its reset is out of the Tab order,
 * so typing round the box goes side to side, and Alt+Backspace in the side
 * does what its reset does. The key, the reset leaving the Tab order and the
 * side's description of the key are all decided from one question, whether
 * the field is drawn inside the spacing box, so they cannot disagree.
 *
 * @module spacing-box
 */

import type { StyleValue } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { SideOrientation } from "./side-orientation";
import type { InspectedStyleProperty } from "./style-inspector";
import { sideBoxFor } from "./style-sides";

/** Margin and padding drawn as one box, and what the section shows besides. */
interface SpacingRings {
  readonly margin: InspectedStyleProperty | undefined;
  readonly padding: InspectedStyleProperty;
  readonly rest: readonly InspectedStyleProperty[];
}

/**
 * Whether the spacing section draws its box model, and from which properties.
 *
 * Drawn when padding is shown, offered and drawn as a box, which needs the
 * element's axes; margin joins as the outer ring under the same conditions.
 * Anything else the section shows is drawn as before, beneath the box.
 */
export function spacingRings(
  shown: readonly InspectedStyleProperty[],
  orientation: SideOrientation | undefined
): SpacingRings | undefined {
  const ring = (key: string) =>
    shown.find(
      property =>
        property.property === key &&
        property.offered &&
        sideBoxFor(property.controls, orientation).boxed
    );
  const padding = ring("padding");
  if (padding === undefined) return undefined;
  const margin = ring("margin");
  return {
    margin,
    padding,
    rest: shown.filter(property => property !== padding && property !== margin),
  };
}

/**
 * Fields drawn compact: the spacing box's sides, which take a value typed
 * with its unit, show no unit menu, say "–" while unset rather than a hint
 * there is no room for, and reset by key.
 */
export const CompactSides: React.Context<boolean> = React.createContext(false);

/**
 * The id of a spacing-box side's description, which names its reset key: one
 * spelling for the field that writes it and the input that reads it.
 */
function sideKeysId(fieldId: string): string {
  return `${fieldId}-keys`;
}

/** The side a field draws, when it is drawn inside the spacing box. */
function spacingBoxSide(
  side: string | undefined,
  inSpacingBox: boolean
): string | undefined {
  return inSpacingBox ? side : undefined;
}

/**
 * The key handler of a spacing-box side, which resets by key rather than by
 * Tab: its reset is out of the Tab order, so typing round the box goes side
 * to side, and Alt+Backspace in the side does what the reset does when there
 * is a value here to reset. Named in the side's description. `undefined` for
 * a field that is not a side.
 */
function sideResetKeyDown(
  side: string | undefined,
  stored: StyleValue | undefined,
  readOnly: boolean,
  reset: () => void
): ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined {
  if (side === undefined) return undefined;
  const resettable = stored !== undefined && !readOnly;
  return event => {
    if (!resettable || !isResetKey(event)) return;
    // From this field only. React carries a key press out of a portal to the
    // component that opened it, so Alt+Backspace (delete a word) in the
    // variables list's search would otherwise reset the side behind it.
    if (!event.currentTarget.contains(event.target as Node)) return;
    // Taken from the field, where Alt+Backspace would otherwise delete the
    // word before the caret: here it is the side's reset.
    event.preventDefault();
    reset();
  };
}

/**
 * A spacing-box side's description, which its input names: how to reset it
 * from the keyboard now that its reset is not a Tab stop. Hidden, so it is
 * read as the side's description and not again, between the fields, by a
 * screen reader reading the panel through. Nothing for a field that is not a
 * side.
 */
function SideResetKeys({
  side,
  fieldId,
}: {
  side: string | undefined;
  fieldId: string;
}): React.JSX.Element | null {
  if (side === undefined) return null;
  return (
    <span id={sideKeysId(fieldId)} hidden>
      Alt+Backspace resets this side.
    </span>
  );
}

/** Alt+Backspace and no other modifier: a side's reset key. */
function isResetKey(event: React.KeyboardEvent): boolean {
  return (
    event.key === "Backspace" &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

/**
 * What a value field is described by: the refusal of what was typed, if any,
 * and for a side of the spacing box its reset key as well.
 */
export function fieldDescribedBy(
  refusal: string | undefined,
  side: boolean,
  fieldId: string
): string | undefined {
  const ids = side ? [refusal, sideKeysId(fieldId)] : [refusal];
  const joined = ids.filter(id => id !== undefined).join(" ");
  return joined === "" ? undefined : joined;
}

/**
 * A field's side-of-the-spacing-box keys, in one: its key handler, whether its
 * reset leaves the Tab order, and the description naming the key. Decided
 * once, from whether the field is drawn in the spacing box, so the three
 * agree; a side box drawn on its own keeps a reset to Tab to.
 */
export function sideKeysFor(
  side: string | undefined,
  /** Whether the field is drawn in the spacing box: {@link CompactSides}. */
  inSpacingBox: boolean,
  stored: StyleValue | undefined,
  readOnly: boolean,
  fieldId: string,
  /** The field's write, which a reset calls with `null`. */
  commit: (value: null) => unknown
): {
  onKeyDown: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  resetByKey: boolean;
  hint: React.JSX.Element | null;
} {
  const boxSide = spacingBoxSide(side, inSpacingBox);
  return {
    onKeyDown: sideResetKeyDown(boxSide, stored, readOnly, () => commit(null)),
    resetByKey: boxSide !== undefined,
    hint: <SideResetKeys side={boxSide} fieldId={fieldId} />,
  };
}
