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

import {
  STYLE_CATALOG,
  trimCssWhitespace,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { CSS_NUMBER, steppedValue } from "./style-numeric";

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
  key: `n:${weight}`,
  label: `${name} ${weight}`,
  value: weight as number,
}));

const RELATIVE_WEIGHTS: readonly FoldedOption[] = [
  { key: "s:lighter", label: "Lighter", value: "lighter" },
  { key: "s:bolder", label: "Bolder", value: "bolder" },
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
  // The stored scalar as written; a keyword gets its word.
  const written = key.slice(2);
  const label = KEYWORD_WEIGHT_NAMES[written] ?? written;
  return [{ key, label, value: stored as StyleValue }, ...offered];
}

/**
 * The select key a stored scalar is listed under, or `undefined` for none.
 *
 * Typed: `n:700` for the number and `s:700` for the text "700", which is not
 * the same value. Sharing one key, a weight stored as text would show as the
 * number it spells, and choosing that number could not repair it, since the
 * list would think it already chosen.
 */
export function storedKey(stored: StyleValue | undefined): string | undefined {
  if (typeof stored === "string" && stored !== "") return `s:${stored}`;
  if (typeof stored === "number") return `n:${stored}`;
  return undefined;
}

/**
 * A line height as typed: a plain number is stored as a number (`1.5`, a
 * multiple of the font size), anything else as written (`24px`, `150%`,
 * `normal`), for the catalogue to accept or refuse. `null` for nothing typed.
 */
export function lineHeightFromText(text: string): StyleValue | null {
  // CSS whitespace only: `String.prototype.trim` also strips a non-breaking
  // space, which CSS reads as part of the value, and would clear on one alone.
  const trimmed = trimCssWhitespace(text);
  if (trimmed === "") return null;
  // CSS's own number grammar, the one every numeric field reads: "1e2" is a
  // number, and "1." goes on as typed for the catalogue to refuse.
  if (!CSS_NUMBER.test(trimmed)) return trimmed;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : trimmed;
}

/**
 * Where a drag on the line height's label starts: the text in the field, or,
 * while it is empty, the value it shows from another tier — as every number
 * field starts — so dragging an inherited `1.5` writes an override from 1.5.
 * `undefined` where that is not one number or one length.
 */
export function lineHeightScrubOrigin(
  draft: string,
  inherited: string | undefined
): string | number | undefined {
  const text = trimCssWhitespace(draft) === "" ? (inherited ?? "") : draft;
  const value = lineHeightFromText(text);
  const leaf = lineHeightLeafFor(text);
  if (value === null || leaf === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return steppedValue(leaf, value, 0) === undefined ? undefined : value;
}

/**
 * The catalogue's leaf a typed line height belongs to, its number form or its
 * length form, so an arrow key steps it as that kind of value steps.
 */
export function lineHeightLeafFor(text: string): StyleLeaf | undefined {
  const entry = STYLE_CATALOG.find(
    candidate => candidate.property === "lineHeight"
  );
  if (entry === undefined || entry.shape.kind !== "union") return undefined;
  const wanted =
    typeof lineHeightFromText(text) === "number" ? "number" : "dimension";
  return entry.shape.of.find((arm): arm is StyleLeaf => arm.kind === wanted);
}
