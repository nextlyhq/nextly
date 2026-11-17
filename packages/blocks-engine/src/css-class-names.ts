/**
 * The CSS class names an author gives a block of their own: which names a
 * block may carry, and why one is refused.
 *
 * One rule, asked by every reader. The engine refuses a node holding a name
 * this refuses when a document is saved, the renderers draw only the names it
 * accepts, and the editor refuses a name as the author types it. A second
 * spelling of the rule in any of them is one that admits what this refuses.
 *
 * A name has to be one a stylesheet can target as written, `.name`, with no
 * escaping: a CSS identifier. It may not start with `nx-`, which every class
 * Nextly generates starts with, so an author's class never matches one of
 * Nextly's own rules or is matched by them.
 *
 * @module css-class-names
 */
import { describeValue } from "./issue-text";

/**
 * The prefix every class Nextly generates starts with, which an author's own
 * class may not (compared without regard to case).
 */
export const RESERVED_CLASS_PREFIX = "nx-";

/** Why one name was refused. */
export type CssClassNameProblem =
  | "starts-with-digit"
  | "starts-with-dot"
  | "starts-with-hash"
  | "reserved-prefix"
  | "only-hyphen"
  | "invalid-character";

/** One name refused, and the reason in plain words. */
export interface RefusedCssClassName {
  readonly name: string;
  readonly problem: CssClassNameProblem;
  /** A sentence that names the name, for the author. */
  readonly reason: string;
}

/** The names of a block's class text, those it keeps and those it refuses. */
export interface CheckedCssClassNames {
  /** The names a block may carry, in the order written. */
  readonly valid: readonly string[];
  /** The names it may not, in the order written. */
  readonly refused: readonly RefusedCssClassName[];
}

/**
 * The names in an author's text: split on ASCII whitespace, as a browser splits
 * an element's `class` attribute, with empty pieces dropped.
 */
function splitNames(text: string): string[] {
  return text.split(/[\t\n\f\r ]+/).filter(name => name !== "");
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** The ranges of {@link isNonAsciiIdentCode}, low and high inclusive. */
const NON_ASCII_IDENT_RANGES: readonly (readonly [number, number])[] = [
  [0xb7, 0xb7],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x203f, 0x2040],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0x10ffff],
];

/**
 * A character outside ASCII that a CSS identifier may hold, as CSS Syntax
 * defines it. Narrower than "anything past U+007F": spaces such as U+00A0,
 * controls and signs such as the multiplication sign (U+00D7) are refused,
 * since none of them reads as part of a name.
 */
function isNonAsciiIdentCode(code: number): boolean {
  return NON_ASCII_IDENT_RANGES.some(
    ([low, high]) => code >= low && code <= high
  );
}

/** A character an identifier may START with: a letter, `_` or one past ASCII. */
function isIdentStart(code: number): boolean {
  return isAsciiLetter(code) || code === 0x5f || isNonAsciiIdentCode(code);
}

/** A character an identifier may hold after its start. */
function isIdentCode(code: number): boolean {
  return isIdentStart(code) || isDigit(code) || code === 0x2d;
}

/** A character shown by its code point, since quoting it would show nothing. */
function isInvisible(character: string): boolean {
  return /[\p{Z}\p{C}]/u.test(character);
}

function shownCharacter(character: string): string {
  if (!isInvisible(character)) return `"${character}"`;
  const code = character.codePointAt(0)!.toString(16).toUpperCase();
  return `an invisible character (U+${code.padStart(4, "0")})`;
}

function refusal(
  name: string,
  problem: CssClassNameProblem,
  why: string
): RefusedCssClassName {
  return { name, problem, reason: `"${describeValue(name)}" ${why}` };
}

/** The first character an identifier cannot hold, or nothing. */
function firstInvalidCharacter(name: string): string | undefined {
  for (const character of name) {
    if (!isIdentCode(character.codePointAt(0)!)) return character;
  }
  return undefined;
}

/**
 * Why a block may not carry this one class name, or nothing when it may.
 *
 * The checks run in the order an author reads the name: what it starts with,
 * then what it holds. `.x` is "starts with `.`", the likelier mistake, rather
 * than "holds `.`".
 */
export function cssClassNameRefusal(
  name: string
): RefusedCssClassName | undefined {
  if (name.startsWith(".")) {
    return refusal(
      name,
      "starts-with-dot",
      'starts with ".": write the name without it.'
    );
  }
  if (name.startsWith("#")) {
    return refusal(
      name,
      "starts-with-hash",
      'starts with "#": write the name without it.'
    );
  }
  if (
    name.slice(0, RESERVED_CLASS_PREFIX.length).toLowerCase() ===
    RESERVED_CLASS_PREFIX
  ) {
    return refusal(
      name,
      "reserved-prefix",
      `starts with "${RESERVED_CLASS_PREFIX}", which Nextly keeps for its own classes.`
    );
  }
  const first = name.codePointAt(0)!;
  if (isDigit(first)) {
    return refusal(
      name,
      "starts-with-digit",
      "starts with a digit, which a class name can't."
    );
  }
  if (first === 0x2d) {
    const second = name.codePointAt(1);
    if (second === undefined) {
      return refusal(
        name,
        "only-hyphen",
        'is only a hyphen: a class name needs a letter or "_" too.'
      );
    }
    if (isDigit(second)) {
      return refusal(
        name,
        "starts-with-digit",
        "starts with a hyphen and a digit, which a class name can't."
      );
    }
  }
  const invalid = firstInvalidCharacter(name);
  if (invalid !== undefined) {
    return refusal(
      name,
      "invalid-character",
      `holds ${shownCharacter(invalid)}, which a class name can't. Use letters, digits, "-" and "_".`
    );
  }
  return undefined;
}

/**
 * Each name of an author's class text, kept or refused. The valid names stay
 * beside the refused ones, so an editor can keep what was right.
 */
export function checkCssClassNames(text: string): CheckedCssClassNames {
  const valid: string[] = [];
  const refused: RefusedCssClassName[] = [];
  for (const name of splitNames(text)) {
    const problem = cssClassNameRefusal(name);
    if (problem === undefined) valid.push(name);
    else refused.push(problem);
  }
  return { valid, refused };
}

/**
 * The names a renderer puts on a block's root, read from a stored value.
 *
 * Only the valid ones, and none from a value that is not text. A save refuses
 * a node holding any other, so this is what an import or an older writer left
 * behind; drawing it would hand a page a class Nextly's own rules match.
 */
export function renderedCssClassNames(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...checkCssClassNames(value).valid];
}
