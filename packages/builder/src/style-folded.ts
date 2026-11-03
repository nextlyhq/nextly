/**
 * Style properties whose two stored forms an author picks between without
 * being asked which form they mean.
 *
 * `fontWeight` stores a keyword (`bold`) or a number (`700`), and
 * `lineHeight` a number (`1.5`) or a length (`24px`). The catalogue declares each as a union, and the panel used to draw a
 * "form" selector above the value: "Font weight form: Keyword" asked a
 * question the value itself answers. Folded, each takes one control, and the
 * form follows from what the author chose or typed.
 *
 * Only these. Where the form IS the choice, as one border radius against four
 * corners, the form selector stays; and `fontStyle` keeps its own controls,
 * buttons for its keywords and a field for a free value such as an oblique
 * angle, which a single list could not hold.
 *
 * @module style-folded
 */

import type { StyleValue } from "@nextlyhq/blocks-engine";

/** How a folded property is edited. */
export type FoldedControl = "font-weight" | "number-or-length";

const FOLDED: Readonly<Record<string, FoldedControl>> = {
  fontWeight: "font-weight",
  lineHeight: "number-or-length",
};

/** The folded control for a catalogue property, or `undefined` for any other. */
export function foldedControlFor(property: string): FoldedControl | undefined {
  return Object.hasOwn(FOLDED, property) ? FOLDED[property] : undefined;
}

/** One choice in a folded list: what is stored, and what it is called. */
export interface FoldedOption {
  /** The select's own value, a string; {@link optionValue} gives the stored one. */
  readonly key: string;
  readonly label: string;
  readonly value: StyleValue;
}

/**
 * The named weights, the numbers fonts are drawn at, then the two relative
 * keywords. `normal` and `bold` are the same weights as Regular 400 and Bold
 * 700, so they are offered as the numbers; a stored keyword still shows.
 */
const WEIGHTS: readonly FoldedOption[] = [
  ["Thin", 100],
  ["Extra light", 200],
  ["Light", 300],
  ["Regular", 400],
  ["Medium", 500],
  ["Semibold", 600],
  ["Bold", 700],
  ["Extra bold", 800],
  ["Black", 900],
].map(([name, weight]) => ({
  key: String(weight),
  label: `${name} ${weight}`,
  value: weight as number,
}));

const RELATIVE_WEIGHTS: readonly FoldedOption[] = [
  { key: "lighter", label: "Lighter", value: "lighter" },
  { key: "bolder", label: "Bolder", value: "bolder" },
];

/** What a stored keyword weight is called when it is shown. */
const KEYWORD_WEIGHT_NAMES: Readonly<Record<string, string>> = {
  normal: "Normal",
  bold: "Bold",
};

/**
 * The font weight list, with what is stored first when the list does not
 * already carry it: a keyword such as `bold`, or a weight such as `450`.
 */
export function fontWeightOptions(
  stored: StyleValue | undefined
): readonly FoldedOption[] {
  const offered = [...WEIGHTS, ...RELATIVE_WEIGHTS];
  const key = storedKey(stored);
  if (key === undefined || offered.some(option => option.key === key)) {
    return offered;
  }
  // The key is the stored scalar as text; a keyword gets its word.
  const label = KEYWORD_WEIGHT_NAMES[key] ?? key;
  return [{ key, label, value: stored as StyleValue }, ...offered];
}

/** The select key a stored scalar is listed under, or `undefined` for none. */
export function storedKey(stored: StyleValue | undefined): string | undefined {
  if (typeof stored === "string" && stored !== "") return stored;
  if (typeof stored === "number") return String(stored);
  return undefined;
}

/**
 * A line height as typed: a plain number is stored as a number (`1.5`, a
 * multiple of the font size), anything else as written (`24px`, `150%`,
 * `normal`), for the catalogue to accept or refuse. `null` for nothing typed.
 */
export function lineHeightFromText(text: string): StyleValue | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // A digit after any point, as CSS requires: "1." goes on as typed, for the
  // catalogue to refuse, rather than being stored as the 1 it is not.
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed) ? Number(trimmed) : trimmed;
}
