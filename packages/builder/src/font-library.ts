/**
 * What the site can actually render, and what it only claims to.
 *
 * The tokens studio already authors `fontFamily` tokens, and this module does
 * not author anything: a second editor for one question is the defect this
 * codebase names most often. What the studio cannot answer is whether a family
 * it just stored will RENDER, because it edits one token and knows nothing
 * about the faces the site loads.
 *
 * Nothing joins those two today. `compileSiteSheet` calls `emitFontFaces` and
 * `emitTokenBlocks` independently, so a token naming a family with no face is
 * emitted exactly like one that has it, and the page quietly draws in whatever
 * the browser reaches for next. That is the failure the sheet's own
 * `tokenPrefix` note describes for custom properties — "nothing errors: the
 * reference resolves to nothing and the value silently does not apply" — and it
 * is the same shape one property along.
 *
 * @module font-library
 */
import {
  isUsableFamilyList,
  splitFamilyList,
  type FamilyPart,
  type FontFaceDef,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/**
 * Families every browser resolves without a face being loaded.
 *
 * The CSS generic families plus the `ui-*` system aliases. A stack ending in
 * one of these always draws something, which is why a stack that ends in a
 * generic is the shape to steer an author toward rather than away from.
 *
 * Held lowercase and compared lowercase: CSS family matching is
 * case-insensitive for these keywords, and an author who typed `Sans-Serif`
 * meant the generic.
 */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * Where a family's glyphs would come from.
 *
 * `not-provided` is deliberately not called "missing" or "unavailable". A named
 * family this site loads no face for may still be installed on the reader's
 * device — `Georgia` and `Helvetica` are the ordinary cases — so declaring it
 * absent would be a claim about a machine this code cannot see. What IS true is
 * that the site does not provide it, and that is what the word says.
 */
export type FamilySource = "hosted" | "generic" | "not-provided";

/** One family from a stack, and where it would come from. */
export interface FamilyReading {
  /** The family name, with quotes removed and escapes resolved. */
  readonly family: string;
  readonly source: FamilySource;
}

/** A whole `font-family` value, read against the faces the site loads. */
export interface StackReading {
  /** Each family in the author's order. Empty when the value is unusable. */
  readonly families: readonly FamilyReading[];
  /**
   * The author's FIRST choice, which is the one they were expressing.
   *
   * Separated from the rest because a stack is a fallback chain and every
   * entry after the first is a concession. An author who wrote `Brand, serif`
   * chose `Brand`; reporting the stack as fine because `serif` resolves would
   * answer a question they did not ask.
   */
  readonly firstChoice: FamilyReading | undefined;
  /**
   * Whether the site guarantees SOMETHING renders.
   *
   * True when any family in the stack is generic or hosted. A stack of named
   * families alone can still render — every one of them may be installed — so
   * this is a floor, not a prediction.
   */
  readonly guaranteed: boolean;
  /**
   * Whether CSS accepts the value as written.
   *
   * A stack carrying `var(--x)`, a bare CSS-wide keyword, or an item the
   * grammar rejects is not a family list the browser will read, so its families
   * are not reported: naming them would describe a resolution that never
   * happens.
   */
  readonly usable: boolean;
}

/** The families a set of faces provides, lowercased for comparison. */
function hostedFamilies(faces: readonly FontFaceDef[]): ReadonlySet<string> {
  return new Set(faces.map(face => face.family.trim().toLowerCase()));
}

function sourceOf(part: FamilyPart, hosted: ReadonlySet<string>): FamilySource {
  const key = part.name.trim().toLowerCase();
  // Hosted first: a site may load a face named `serif`, and the face it loads
  // is what renders. Asking the generic set first would report the site's own
  // font as a browser default.
  if (hosted.has(key)) return "hosted";
  // A QUOTED generic is a family name, not the keyword — `font-family: "serif"`
  // asks for a font called serif. The same distinction `familyToDtcg` makes.
  if (!part.quoted && GENERIC_FAMILIES.has(key)) return "generic";
  return "not-provided";
}

/**
 * Read one `font-family` value against the faces this site loads.
 *
 * The parser is the engine's, reached through its published export rather than
 * rewritten here: a family list is quoting, comma and escape rules together,
 * and `"ACME, Inc", serif` is two families rather than three. A second parser
 * would agree on the easy cases and diverge exactly where a site's real font
 * name is unusual.
 */
export function readStack(
  value: string,
  faces: readonly FontFaceDef[]
): StackReading {
  const parts = splitFamilyList(value);
  // The engine's own composite, not `part.valid` alone: quoting is half the
  // grammar, and the half left out is what accepts `var(--x)` as a font name.
  const usable = isUsableFamilyList(parts);
  if (!usable) {
    return {
      families: [],
      firstChoice: undefined,
      guaranteed: false,
      usable: false,
    };
  }
  const hosted = hostedFamilies(faces);
  const families = parts.map(part => ({
    family: part.name,
    source: sourceOf(part, hosted),
  }));
  return {
    families,
    firstChoice: families[0],
    guaranteed: families.some(f => f.source !== "not-provided"),
    usable: true,
  };
}

/** A `fontFamily` token, read against the faces the site loads. */
export interface FontTokenRow {
  readonly token: SiteToken;
  /** The light-mode value's reading. Dark is not a separate typeface tier. */
  readonly reading: StackReading;
}

/**
 * Every `fontFamily` token in the set, with what each would render as.
 *
 * Only `fontFamily` tokens: a `dimension` holding a font SIZE is typography and
 * is not a typeface, and including it would put rows in this panel that its
 * question does not apply to.
 */
export function fontTokenRows(
  tokens: SiteTokenSet | undefined,
  faces: readonly FontFaceDef[]
): FontTokenRow[] {
  const all = tokens?.tokens ?? [];
  return all
    .filter(token => token.kind === "fontFamily")
    .map(token => ({ token, reading: readStack(token.values.light, faces) }));
}

/**
 * The rows worth an author's attention, and nothing else.
 *
 * A row is drawn to attention when its FIRST family is not provided by this
 * site — that is the choice the author expressed, and the one that silently
 * does not happen. A stack whose first family is hosted or generic is working
 * as written, whatever its later entries say.
 */
export function rowsNeedingAttention(
  rows: readonly FontTokenRow[]
): FontTokenRow[] {
  return rows.filter(
    row =>
      !row.reading.usable || row.reading.firstChoice?.source === "not-provided"
  );
}

/**
 * What the token list amounts to, in one sentence.
 *
 * Wording lives here rather than in the panel for the reason
 * {@link class-library.usageSummary} does: the sentence makes a claim about
 * evidence, and a claim is a rule. A panel composing it inline is a second
 * place for that judgement to drift — and this one has to keep saying
 * "provides no font file for" rather than "missing", which is exactly the kind
 * of distinction that erodes when it lives in JSX.
 *
 * Stated even at zero. An author who reads a count knows the check ran, and
 * silence is also what a panel that never checked would show.
 */
export function tokenSummary(
  rows: readonly FontTokenRow[],
  attention: readonly FontTokenRow[]
): string {
  if (rows.length === 0) {
    return "This site has no typeface tokens yet. The Tokens panel creates them.";
  }
  if (attention.length === 0) {
    const noun = rows.length === 1 ? "token" : "tokens";
    return `${rows.length} typeface ${noun}, each asking first for a family this site provides.`;
  }
  return `${attention.length} of ${rows.length} ask first for a typeface this site provides no file for.`;
}

/**
 * What to say about one token, or nothing when it needs no comment.
 *
 * Returns `undefined` for a row that is working as written, so the caller has a
 * value to branch on rather than a condition to re-derive. The two failing
 * shapes are genuinely different — an unusable value applies nothing at all,
 * while a first choice this site does not provide applies the NEXT family — and
 * collapsing them into one sentence would describe the wrong outcome for one.
 */
export function tokenNote(row: FontTokenRow): string | undefined {
  const { token, reading } = row;
  if (!reading.usable) {
    return `"${token.values.light}" is not a font-family value a browser will read, so this token applies nothing.`;
  }
  const first = reading.firstChoice;
  if (first?.source !== "not-provided") return undefined;
  return `${first.family} is the typeface this token asks for first, and this site provides no font file for it. Readers without it installed see the next family in the list instead.`;
}
