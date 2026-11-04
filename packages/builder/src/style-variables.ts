/**
 * What a style field offers from the site's variables, beyond what a colour
 * needs: matching a typed name, and the sample a list draws.
 *
 * Pure, for the reason `style-colour.ts` is. Which variable a typed word names
 * and how wide a sample is are derivation, and a test of the rendered field
 * cannot tell a right answer from a plausible wrong one.
 *
 * Every answer here reads the ONE projection of the site's variables,
 * {@link variablesFor}, so the list a field offers and the names it accepts
 * as typed cannot disagree.
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

/**
 * Whether a variable is ONE length that changes with the page: `clamp()`,
 * `min()`, `max()` or `calc()` over the viewport, a container or a
 * percentage. A shadow, a fixed `calc(1rem + 2px)` and any value of several
 * parts are not, and read as themselves.
 */
function isFluidLength(variable: ValueOfKind): boolean {
  if (variable.kind !== "dimension") return false;
  const value = variable.value.trim();
  return (
    /^(clamp|min|max|calc)\(/i.test(value) &&
    /\d(?:[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|%)/i.test(value)
  );
}

/**
 * What reading a value's words needs: its kind and the value. Narrower than
 * {@link SiteVariable}, so the Variables tab, which lists the site's tokens
 * rather than picker records, words its rows through the same rule.
 */
export type ValueOfKind = Pick<SiteVariable, "kind" | "value">;

/**
 * A variable's value in words short enough for a row: the value itself, or
 * "Fluid" for a length that changes with the page, whose whole text crowded
 * the name out of a list row. The whole value stays in the row's tooltip.
 */
export function variableValueText(variable: ValueOfKind): string {
  return isFluidLength(variable) ? "Fluid" : variable.value;
}

/** What a list draws beside a variable's name to show its value. */
export type VariableSample =
  /** The name itself, drawn at the type size, within {@link TYPE_SAMPLE_PX}. */
  | { readonly kind: "type"; readonly px: number }
  /** A bar as wide as the length, up to {@link BAR_SAMPLE_MAX_PX}. */
  | { readonly kind: "bar"; readonly px: number }
  /** A small box casting the shadow. */
  | { readonly kind: "shadow"; readonly value: string }
  /** A length through a function, such as `clamp()`, with no one size here. */
  | { readonly kind: "fluid" }
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
  if (isFluidLength(variable)) return { kind: "fluid" };
  // Through any other function (`calc(1rem + 2px)`) it has no length here
  // to draw, though it is fixed: drawn as nothing rather than as fluid.
  if (variable.value.includes("(")) return { kind: "none" };
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
