/**
 * What a style field offers from the site's variables, beyond what a colour
 * needs: matching a typed name, the field's hint, and the sample a list draws.
 *
 * Pure, for the reason `style-colour.ts` is. Which variable a typed word names
 * and how wide a sample is are derivation, and a test of the rendered field
 * cannot tell a right answer from a plausible wrong one.
 *
 * Every answer here reads the ONE projection of the site's variables,
 * {@link variablesFor}, so the list a field offers, the names it accepts as
 * typed and whether its hint mentions variables at all cannot disagree.
 *
 * @module style-variables
 */
import type {
  SiteTokenSet,
  StyleLeaf,
  TokenMode,
} from "@nextlyhq/blocks-engine";

import { variableLabel, variablesFor, type SiteVariable } from "./style-colour";
import { typeScaleProperty } from "./tokens-studio";

/**
 * The identity of the variable a typed word names at this leaf, or
 * `undefined` when it names none.
 *
 * An author who knows the site has a "Display" size types it, as they would
 * type `16px`. Asked BEFORE the text is read as a value, so the word reaches
 * the document as a reference rather than as a literal the catalog refuses
 * ("Display is not a length").
 *
 * Matched against what the list shows (the label, qualified where two share
 * it) and against the code name and identity, ignoring case and the spaces
 * around it, among the variables this leaf is offered and no others: a colour
 * variable's name typed into a length is still a literal, and is refused in
 * the catalog's own words.
 *
 * A word two different variables answer to names neither. Guessing would store
 * an identity the author could not have predicted, which is the failure the
 * qualified label exists to prevent in the list.
 *
 * The IDENTITY is returned, never the name typed, for the reason
 * {@link SiteVariable} records: a reference holding a name compiles to a custom
 * property nothing declares once the variable has been renamed.
 */
export function tokenForTypedName(
  leaf: StyleLeaf,
  tokens: SiteTokenSet | undefined,
  text: string,
  mode: TokenMode = "light"
): string | undefined {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return undefined;
  const offered = variablesFor(leaf, tokens, mode);
  const named = new Set(
    offered
      .filter(variable =>
        [
          variable.label,
          variableLabel(variable, offered),
          variable.name,
          variable.identity,
        ].some(spelling => spelling.toLowerCase() === wanted)
      )
      .map(variable => variable.identity)
  );
  if (named.size !== 1) return undefined;
  const [identity] = named;
  return identity;
}

/**
 * A field's hint, saying a variable may be chosen where one can be:
 * "16px or a variable". The hint alone where the site has no variable this
 * field takes, since pointing at a choice that does not exist would send the
 * author looking for it.
 */
export function variablePlaceholder(
  leaf: StyleLeaf,
  tokens: SiteTokenSet | undefined,
  base: string,
  mode: TokenMode = "light"
): string {
  // In the mode the canvas shows, as the field's list offers them.
  return variablesFor(leaf, tokens, mode).length > 0
    ? `${base} or a variable`
    : base;
}

/**
 * The CSS pixels a root-relative length is at the browser's default size.
 *
 * `em` is read as `rem` is: what it resolves to depends on the element it is
 * used on, and a sample has no element, so the default size is the honest
 * single answer.
 */
const ROOT_PX = 16;

/**
 * How many CSS pixels a length is, or `undefined` for one this cannot measure
 * without a page: a percentage, a viewport unit, `clamp()`, a keyword.
 *
 * One reading of a length for every sample that sizes itself by one, the
 * Design panel's type specimen and the inspector's bars, so the two draw the
 * same variable at the same scale.
 */
export function lengthInPx(value: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = match[2];
  // Only zero may go without a unit; any other bare number is not a length.
  if (unit === undefined) return amount === 0 ? 0 : undefined;
  return unit === "px" ? amount : amount * ROOT_PX;
}

/** What a list draws beside a variable's name to show its value. */
export type VariableSample =
  /** The name itself, drawn at the type size, within {@link TYPE_SAMPLE_PX}. */
  | { readonly kind: "type"; readonly px: number }
  /** A bar as wide as the length, up to {@link BAR_SAMPLE_MAX_PX}. */
  | { readonly kind: "bar"; readonly px: number }
  /** A small box casting the shadow. */
  | { readonly kind: "shadow"; readonly value: string }
  /** Nothing drawn; the value beside the name says it in words. */
  | { readonly kind: "none" };

/**
 * The smallest and largest a type size's name is drawn at in a list.
 *
 * Bounded so a display size does not push the row past the popover and a tiny
 * caption size is still legible; the order between sizes survives inside the
 * bounds, which is what an author compares.
 */
const TYPE_SAMPLE_PX = { min: 10, max: 28 } as const;

/**
 * The widest a length's bar is drawn, in CSS pixels: wide enough to tell the
 * steps of a spacing scale apart, narrow enough to leave the name its room.
 */
const BAR_SAMPLE_MAX_PX = 64;

/**
 * The sample for one variable: a type size as its name at that size, any
 * other length as a bar scaled to it, a shadow as itself, and nothing for a
 * value that cannot be drawn faithfully here.
 */
export function variableSample(variable: SiteVariable): VariableSample {
  if (variable.kind === "shadow") {
    return { kind: "shadow", value: variable.value };
  }
  if (variable.kind !== "dimension") return { kind: "none" };
  const px = lengthInPx(variable.value);
  if (px === undefined) return { kind: "none" };
  if (typeScaleProperty(variable) === "font-size") {
    return {
      kind: "type",
      px: Math.min(TYPE_SAMPLE_PX.max, Math.max(TYPE_SAMPLE_PX.min, px)),
    };
  }
  // The magnitude: a negative letter spacing is as long as its positive.
  return { kind: "bar", px: Math.min(BAR_SAMPLE_MAX_PX, Math.abs(px)) };
}
