/**
 * The parts of a text style as Design's Type → "Text styles" editor reads
 * and writes them: its size for each device (Desktop, then the site's own
 * devices), its case in the author's words, its letter spacing with a unit
 * (`em` unless another is typed), and its font as the Body font, the
 * Headings font or a family the site loads.
 *
 * Pure, so the rules are testable without a DOM.
 *
 * @module text-style-parts
 */
import {
  BASE_BREAKPOINT,
  isTokenRef,
  type BreakpointId,
  type BreakpointSet,
  type NodeStyles,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { deviceOptions } from "./shell/breakpoint-switcher";

/** One device a text style's size is set for. */
export interface TextStyleDevice {
  readonly id: BreakpointId;
  /** "Desktop", "Tablet", "Mobile": the site's own words for it. */
  readonly label: string;
}

/**
 * The devices a size is set for, as the top bar offers them: Desktop, then
 * each device the site defines, widest first.
 */
export function textStyleDevices(
  breakpoints: BreakpointSet | undefined
): TextStyleDevice[] {
  return deviceOptions(breakpoints).map(option => ({
    id: option.id,
    label: option.label,
  }));
}

/** A part's value at one device in the normal state, or `undefined`. */
export function partAt(
  styles: NodeStyles,
  breakpoint: BreakpointId,
  property: string
): StyleValue | undefined {
  const values: unknown = styles.base?.[breakpoint];
  if (typeof values !== "object" || values === null) return undefined;
  return Object.hasOwn(values, property)
    ? (values as Record<string, StyleValue>)[property]
    : undefined;
}

/** The text style's cases: what each stores, and what it is called. */
export const TEXT_STYLE_CASES: ReadonlyArray<readonly [string, string]> = [
  ["none", "As typed"],
  ["uppercase", "UPPERCASE"],
  ["lowercase", "lowercase"],
  ["capitalize", "Capitalised"],
];

/** The units a letter spacing is offered in, its default first. */
export const LETTER_SPACING_UNITS: readonly string[] = ["em", "px"];

/** A number as typed, with an optional sign and unit. */
const SPACING_RE = /^([+-]?)(\d*\.?\d+)\s*(em|px|rem)?$/i;

/**
 * The letter spacing a typed amount writes: a bare number takes `unit`, a
 * number typed with a unit keeps it; `null` clears it, and `undefined` is
 * not a spacing at all.
 */
export function letterSpacingValue(
  typed: string,
  unit: string
): string | null | undefined {
  const text = typed.trim();
  if (text === "") return null;
  const match = SPACING_RE.exec(text);
  if (match === null) return undefined;
  const [, sign = "", amount = "", typedUnit] = match;
  return `${sign === "-" ? "-" : ""}${amount}${(typedUnit ?? unit).toLowerCase()}`;
}

/** A stored letter spacing as its number and unit, `em` when it holds none. */
export function letterSpacingParts(value: StyleValue | undefined): {
  amount: string;
  unit: string;
} {
  if (typeof value !== "string" && typeof value !== "number") {
    return { amount: "", unit: LETTER_SPACING_UNITS[0] ?? "em" };
  }
  const match = SPACING_RE.exec(String(value).trim());
  if (match === null) return { amount: String(value), unit: "em" };
  const [, sign = "", amount = "", unit = "em"] = match;
  return { amount: `${sign === "-" ? "-" : ""}${amount}`, unit: unit.toLowerCase() };
}

/** The Body and Headings fonts' variables, which a text style's font may follow. */
export const FONT_ROLE_TOKENS = {
  body: "font.body",
  heading: "font.heading",
} as const;

/**
 * Which font a text style uses: `body` or `heading` for a font role, the
 * stack it names for a family, or `""` for none.
 */
export function fontChoiceOf(value: StyleValue | undefined): string {
  if (isTokenRef(value)) {
    if (value.$token === FONT_ROLE_TOKENS.body) return "body";
    if (value.$token === FONT_ROLE_TOKENS.heading) return "heading";
    return value.$token;
  }
  return typeof value === "string" ? value : "";
}

/** The value a font choice stores: a font role's variable, or the stack. */
export function fontValueOf(choice: string): StyleValue {
  if (choice === "body") return { $token: FONT_ROLE_TOKENS.body };
  if (choice === "heading") return { $token: FONT_ROLE_TOKENS.heading };
  return choice;
}

/** The address a part is written at: the normal state, at one device. */
export function partAddress(
  breakpoint: BreakpointId,
  property: string
): { state: "base"; breakpoint: BreakpointId; property: string; path: [] } {
  return { state: "base", breakpoint, property, path: [] };
}

/** The widest device, where every part but the size is set. */
export const TEXT_STYLE_BASE: BreakpointId = BASE_BREAKPOINT;
