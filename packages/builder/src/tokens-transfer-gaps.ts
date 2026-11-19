/**
 * The list "What wasn't exported" shows after an export: each variable or
 * text style a file did not write as other tools read it, what happened to
 * it, and why, in an author's words rather than the engine's.
 *
 * @module tokens-transfer-gaps
 */
import {
  tokenDisplayLabel,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
} from "@nextlyhq/blocks-engine";

import { DESIGN_ACTION_WORDS } from "./editor-words";
import { sharedStyleName } from "./shared-style-library";

/** One variable a file did not write as other tools read it, and why. */
export interface ExportGap {
  /** Its code name; absent for a report that names no variable. */
  readonly name?: string;
  /** The name an author sees it by. */
  readonly label?: string;
  /**
   * `kept`: written only as Nextly data, which Nextly reads back exactly and
   * other tools skip. `left-out`: not in the file at all. `without-data`: in
   * the file with its value, but without vendor data a file cannot hold.
   */
  readonly outcome: "kept" | "left-out" | "without-data";
  /** Why, in plain words. */
  readonly why: string;
}

/** Why the token file keeps a text style only as Nextly data. */
export const TEXT_STYLE_KEPT_WHY =
  "Design tools can't read this text style as it is written.";

/**
 * A text style in "What wasn't exported", under its name, apart from every
 * variable's code name by the group the file writes text styles under.
 */
export function textStyleGap(
  style: NamedClass,
  outcome: ExportGap["outcome"],
  why: string
): ExportGap {
  return {
    name: `textStyles.${style.slug}`,
    label: sharedStyleName(style),
    outcome,
    why,
  };
}

/**
 * An export's report as the list "What wasn't exported" shows: each variable
 * by its name, what happened to it, and why, in plain words.
 *
 * Each engine sentence starts with the quoted code name of the variable it is
 * about, which is how it is matched to its variable; one naming none (a whole
 * file that could not be written) keeps its words and names no variable.
 */
export function gapsOf(
  tokens: SiteTokenSet,
  skipped: readonly string[],
  kept: readonly string[],
  lost: readonly string[] = []
): ExportGap[] {
  const byName = new Map(tokens.tokens.map(token => [token.name, token]));
  const gaps: ExportGap[] = [
    ...skipped.map(message => gapNamedBy(tokens, message, "left-out")),
    ...lost.map(message => gapNamedBy(tokens, message, "without-data")),
  ];
  for (const name of kept) {
    const token = byName.get(name);
    if (token === undefined) continue;
    gaps.push({
      name,
      label: tokenDisplayLabel(token),
      outcome: "kept",
      why: KEPT_WHY[token.kind],
    });
  }
  return gaps;
}

/** One engine sentence as a row of the list, under the variable it names. */
function gapNamedBy(
  tokens: SiteTokenSet,
  message: string,
  outcome: ExportGap["outcome"]
): ExportGap {
  const token = aboutWhich(tokens.tokens, message);
  if (token === undefined) return { outcome, why: message };
  return {
    name: token.name,
    label: tokenDisplayLabel(token),
    outcome,
    why: plainWhy(message.slice(token.name.length + 3)),
  };
}

/**
 * The variable an engine sentence is about: the one whose quoted code name
 * opens it. The longest such name wins, so `"space.4"` is not read as being
 * about a variable called `space`.
 */
export function aboutWhich(
  tokens: readonly SiteToken[],
  message: string
): SiteToken | undefined {
  let found: SiteToken | undefined;
  for (const token of tokens) {
    if (!message.startsWith(`"${token.name}" `)) continue;
    if (found === undefined || token.name.length > found.name.length) {
      found = token;
    }
  }
  return found;
}

/**
 * Why a file left a variable out, in an author's words, from the rest of the
 * engine's sentence after the variable's name.
 *
 * The engine's sentences are written for a developer reading a report ("token
 * name", "vendor data"); a designer reading the list needs what the tool takes
 * instead. A sentence not listed here keeps the engine's words, with "token"
 * said as "variable", so a reason added there later still reads.
 */
function plainWhy(rest: string): string {
  for (const [pattern, words] of PLAIN_WHY) {
    const match = pattern.exec(rest);
    if (match !== null) return typeof words === "string" ? words : words(match);
  }
  const sentence = rest
    .replace(/,? so it was (?:not exported|left out of the Figma files)/, "")
    .replace(/ It was left out of the Figma files\.$/, "")
    .replace(/\btokens?\b/g, word =>
      word === "token" ? "variable" : "variables"
    );
  return `It ${sentence}`;
}

const PLAIN_WHY: readonly (readonly [
  RegExp,
  string | ((match: RegExpExecArray) => string),
])[] = [
  [/^is a shadow\./, DESIGN_ACTION_WORDS.figmaStyles],
  [
    /^carries vendor data that a file cannot hold/,
    "It holds data from another tool that a file can't store, so the file has its value but not that data. Importing the file back treats it as a new variable.",
  ],
  [
    /^is a size Figma cannot read/,
    "Figma takes sizes in px or rem, and fluid sizes that end in px or rem.",
  ],
  [
    /^is a colour Figma cannot read/,
    "Figma takes colours written as hex or rgb().",
  ],
  [
    /^is not a list of font names Figma can read/,
    "Figma takes a font as a list of font names.",
  ],
  [/^names no font family Figma can read/, "It names no font Figma can use."],
  [
    /^is a font weight Figma cannot read/,
    "Figma takes a font weight as a number, normal or bold.",
  ],
  [/^is not a plain number/, "Figma takes a plain number here."],
  [/^is a duration Figma cannot read/, "Figma takes durations in ms or s."],
  [
    /^sits where another variable's group is/,
    "Another variable's group already uses this name.",
  ],
  [/^is nested too deeply/, "Its code name has too many parts."],
  [
    /^is written under more than (\d+) characters/,
    match => `Its code name is longer than ${match[1] ?? ""} characters.`,
  ],
  [/^is not a token name/, "Its code name can't be written to a file."],
  [
    /^has an id that is not a token name/,
    "Its stored id can't be written to a file. Its value is still here in Nextly.",
  ],
  [
    /^is exported more than once/,
    "Another variable has the same code name, so only one was written.",
  ],
  [
    /^cannot be exported, because "([^"]+)" is already a token/,
    match =>
      `"${match[1] ?? ""}" is a variable, so nothing can sit under its name.`,
  ],
  [
    /^carries vendor data that a file cannot hold/,
    "Data another tool stored on it can't be written to a file. Imported back, it would arrive as a new variable.",
  ],
];

/**
 * Why the token file keeps a variable only as Nextly data, by its kind: the
 * format types a value of that kind only in some forms, and this one is not
 * among them.
 */
export const KEPT_WHY: Readonly<Record<TokenKind, string>> = {
  color: "Design tools can't read this colour as it is written.",
  dimension: "Design tools take sizes in px or rem only.",
  fontFamily: "Design tools can't read this font list as it is written.",
  fontWeight: "Design tools can't read this font weight as it is written.",
  number: "Design tools can't read this number as it is written.",
  shadow: "Design tools can't read a shadow from this file.",
  duration: "Design tools take durations in ms or s only.",
  custom: "A custom value has no type design tools read.",
};
