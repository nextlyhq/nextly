/**
 * A shadow as CSS reads it: its layers, and each layer's parts.
 *
 * One reading for both of its readers. The token check says what is certainly
 * wrong with a shadow variable's value, and the builder's shadow fields show
 * the parts a layer is set with; a second splitter in either would agree with
 * this one today and drift the first time a spelling reached one and not the
 * other.
 *
 * @module style/css-value-shadow
 */
import { checkColorValue } from "./css-value-colors";
import { asciiLower, decodeIdentifier } from "./css-value-syntax";
import { unitCategory } from "./css-value-types";

/** What one part of a shadow layer is. */
export type ShadowPartKind =
  /** The `inset` keyword: the shadow is drawn inside the box. */
  | "inset"
  /** A plain size: a number with a length unit, or a zero. */
  | "length"
  /** A colour written as itself: a hex, a keyword or a colour function. */
  | "colour"
  /** `var()` or `env()`, which may stand for a size or a colour. */
  | "reference"
  /** Any other function, such as `calc()`, which may compute a size. */
  | "function"
  /** A number with no unit, which is no size unless it is zero. */
  | "unitless"
  /** Anything else: a word, or a number in a unit that is no length. */
  | "unknown";

/** One part of a shadow layer, as written. */
export interface ShadowPart {
  readonly kind: ShadowPartKind;
  readonly text: string;
  /** The number a `length` or `unitless` part holds. */
  readonly amount?: number;
}

/** A number and the unit after it, as CSS spells a dimension. */
const MEASUREMENT =
  /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)((?:[a-zA-Z]|\\[0-9a-fA-F]{1,6}\s?|\\.)*|%)$/;

/** A function call's name, as the text opens with it. */
const FUNCTION_NAME = /^((?:[a-zA-Z-]|\\.)[\w-]*)\(/;

/**
 * The layers of a shadow, and each layer's parts, in the order written.
 *
 * Split at the commas and spaces that sit outside every bracket and string, so
 * `rgba(0, 0, 0, .2)` stays one part. An empty layer, as a trailing comma
 * leaves, is kept as a layer with no parts, which is how it is reported.
 */
export function shadowLayerParts(
  text: string
): readonly (readonly ShadowPart[])[] {
  return topLevelSplit(text, ",").map(layer =>
    topLevelSplit(layer, " ")
      .filter(part => part !== "")
      .map(partOf)
  );
}

/** What one written part is. */
function partOf(text: string): ShadowPart {
  if (asciiLower(decodeIdentifier(text)) === "inset") {
    return { kind: "inset", text };
  }
  const measured = MEASUREMENT.exec(text);
  if (measured !== null) return measurementPart(text, measured);
  const name = FUNCTION_NAME.exec(text)?.[1];
  const called =
    name === undefined ? undefined : asciiLower(decodeIdentifier(name));
  if (called === "var" || called === "env") return { kind: "reference", text };
  if (checkColorValue(text) === null) return { kind: "colour", text };
  return { kind: called === undefined ? "unknown" : "function", text };
}

/** A number, by what its unit measures. */
function measurementPart(text: string, measured: RegExpExecArray): ShadowPart {
  const amount = Number.parseFloat(measured[1] ?? "");
  const unit = measured[2] ?? "";
  if (unit === "") {
    return { kind: amount === 0 ? "length" : "unitless", text, amount };
  }
  return unitCategory(unit) === "length"
    ? { kind: "length", text, amount }
    : { kind: "unknown", text };
}

/**
 * Text split at a separator that sits outside brackets and quotes, an escape
 * kept with what it escapes. A space separator splits at any CSS whitespace.
 */
// fallow-ignore-next-line complexity
function topLevelSplit(text: string, separator: "," | " "): string[] {
  const pieces: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "\\") {
      current += text.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      current += character;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    const splits =
      depth === 0 &&
      (separator === "," ? character === "," : " \t\r\n\f".includes(character));
    if (splits) {
      pieces.push(separator === "," ? current.trim() : current);
      current = "";
      continue;
    }
    current += character;
  }
  pieces.push(separator === "," ? current.trim() : current);
  return pieces;
}

/**
 * What is certainly wrong with a shadow, said after its value, or nothing.
 *
 * One-sided, as every kind check is: a part through `var()` or a function may
 * be a size or a colour, so a layer holding one is judged only on the parts
 * that are certainly something else.
 */
export function shadowIssue(text: string): string | undefined {
  const layers = shadowLayerParts(text);
  // `none` is the whole value or nothing.
  if (layers.length === 1 && isNone(layers[0])) return undefined;
  for (const layer of layers) {
    const issue = layerIssue(layer);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

function isNone(layer: readonly ShadowPart[] | undefined): boolean {
  const [only, ...rest] = layer ?? [];
  return (
    rest.length === 0 &&
    only !== undefined &&
    asciiLower(decodeIdentifier(only.text)) === "none"
  );
}

/** What is certainly wrong with one layer, or nothing. */
function layerIssue(layer: readonly ShadowPart[]): string | undefined {
  if (layer.length === 0) return "has an empty layer between two commas";
  const stray = layer.find(
    part => part.kind === "unknown" || part.kind === "unitless"
  );
  if (stray?.kind === "unitless") {
    return `has "${stray.text}", a number with no unit where a size goes`;
  }
  if (stray !== undefined) {
    return `has "${stray.text}", which is not a size or a colour`;
  }
  if (layer.filter(part => part.kind === "inset").length > 1) {
    return 'says "inset" twice in one layer';
  }
  // Past here only what parts that might be either leave certain: a blur
  // written as the third of the sizes that open the layer is one whatever a
  // variable after it stands for.
  if (
    layer.some(part => part.kind === "reference" || part.kind === "function")
  ) {
    return negativeBlur(leadingSizes(layer)) ? NEGATIVE_BLUR : undefined;
  }
  return countIssue(layer);
}

/** What a layer whose blur is below zero is told. */
const NEGATIVE_BLUR = "has a negative blur, which CSS can't draw";

/** The plain sizes a layer opens with, after an `inset` before them. */
function leadingSizes(layer: readonly ShadowPart[]): readonly ShadowPart[] {
  const start = layer[0]?.kind === "inset" ? 1 : 0;
  const sizes: ShadowPart[] = [];
  for (const part of layer.slice(start)) {
    if (part.kind !== "length") break;
    sizes.push(part);
  }
  return sizes;
}

/** Whether the third of a layer's sizes, its blur, is below zero. */
function negativeBlur(sizes: readonly ShadowPart[]): boolean {
  const blur = sizes[2]?.amount;
  return blur !== undefined && blur < 0;
}

/** Too few or too many sizes, two colours, or a negative blur. */
function countIssue(layer: readonly ShadowPart[]): string | undefined {
  const sizes = layer.filter(part => part.kind === "length");
  if (sizes.length < 2) return "has a layer with no X and Y offset";
  if (sizes.length > 4) return "has a layer with more than four sizes";
  if (layer.filter(part => part.kind === "colour").length > 1) {
    return "has a layer with two colours";
  }
  return negativeBlur(sizes) ? NEGATIVE_BLUR : undefined;
}
