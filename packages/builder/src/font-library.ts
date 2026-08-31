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
  emitTokenBlocks,
  readFamilyList,
  validateFontFace,
  type FamilyListKind,
  type FontFaceDef,
  type ReadFamilyPart,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

/**
 * Where a family's glyphs would come from.
 *
 * `not-provided` is deliberately not called "missing" or "unavailable". A named
 * family this site loads no face for may still be installed on the reader's
 * device — `Georgia` and `Helvetica` are the ordinary cases — so declaring it
 * absent would be a claim about a machine this code cannot see. What IS true is
 * that the site does not provide it, and that is what the word says.
 *
 * `dynamic` is a `var()` whose value only exists at render. Reporting it as
 * provided or not would be a guess either way, and the guess that reads worst
 * is the confident one: a host wiring a font through a custom property, which
 * is how `next/font` exposes one, would be told their token is broken.
 */
export type FamilySource = "hosted" | "generic" | "dynamic" | "not-provided";

/** One family from a stack, and where it would come from. */
export interface FamilyReading {
  /** The family name, with quotes removed and escapes resolved. */
  readonly family: string;
  readonly source: FamilySource;
}

/** A whole `font-family` value, read against the faces the site loads. */
export interface StackReading {
  /**
   * How CSS reads the value, from the engine's own classification.
   *
   * Four states rather than usable/unusable, because the browser has four
   * answers and collapsing them misdescribes two: a `var()` stack is read
   * perfectly and cannot be resolved here, and a lone `inherit` is valid while
   * naming no family at all.
   */
  readonly kind: FamilyListKind;
  /** Each family in the author's order. Empty unless `kind` names families. */
  readonly families: readonly FamilyReading[];
  /**
   * The author's FIRST choice, which is the one they were expressing.
   *
   * Separated from the rest because a stack is a fallback chain and every entry
   * after the first is a concession. An author who wrote `Brand, serif` chose
   * `Brand`; reporting the stack as fine because `serif` resolves would answer
   * a question they did not ask.
   */
  readonly firstChoice: FamilyReading | undefined;
  /**
   * Whether a family AFTER the first exists to fall back to.
   *
   * What separates "readers see the next family in the list" from "readers see
   * the browser's default", which are different sentences and only one of them
   * is true of a single-family stack.
   */
  readonly hasFallback: boolean;
  /**
   * Whether the site guarantees SOMETHING renders.
   *
   * True when any family is generic or hosted. A stack of named families alone
   * can still render — every one may be installed — so this is a floor, not a
   * prediction.
   */
  readonly guaranteed: boolean;
}

/**
 * The faces the compiler will actually EMIT.
 *
 * `emitFontFaces` drops a face whose `src` is empty, remote, or carries an
 * unusable descriptor, while the stored tier deliberately keeps those
 * shaped-but-invalid faces so their issues can be reported. Anything reading
 * "what does this site load" has to ask this rather than the raw list —
 * counting a refused face marks a token healthy against a `@font-face` the site
 * sheet does not contain, and listing one tells an author a file loads when it
 * does not.
 *
 * Exported so the panel's list and the token analysis cannot disagree about
 * which faces exist. Two filters would agree today and drift on the next
 * validation rule the engine adds.
 */
export function emittableFaces(
  faces: readonly FontFaceDef[]
): readonly FontFaceDef[] {
  return faces.filter(face => validateFontFace(face, "fonts").length === 0);
}

/**
 * The families those faces provide, lowercased for comparison.
 *
 * NOT trimmed, because the emitter does not trim either: `emitFontFaces`
 * writes `font-family:"${cssString(face.family)}"`, so a face called
 * `" Brand "` declares a family whose name carries those spaces and only a
 * token quoting them verbatim selects it. Trimming one side and not the other
 * made the two representations disagree, and a face the browser matches was
 * reported as one the site never loads.
 */
function hostedFamilies(faces: readonly FontFaceDef[]): ReadonlySet<string> {
  return new Set(emittableFaces(faces).map(face => face.family.toLowerCase()));
}

function sourceOf(
  entry: ReadFamilyPart,
  hosted: ReadonlySet<string>
): FamilySource {
  if (entry.kind === "dynamic") return "dynamic";
  // Generic BEFORE hosted, which is the opposite of what it seems it should be.
  // The engine emits every face family quoted — `font-family:"serif"` — and an
  // unquoted `serif` in a stack is the CSS keyword, which no `@font-face` can
  // claim. So a site loading a face it called `serif` still gets the browser
  // default from a bare `serif`, and only a quoted value reaches its file.
  if (entry.kind === "generic") return "generic";
  // NOT trimmed, and neither is the set this is looked up in — the two must
  // normalise identically or they answer about different families. The reader
  // already removed the separation around an unquoted name and kept a quoted
  // one verbatim, so trimming here would undo that and match `" Brand "`
  // against a face called `Brand`.
  const key = entry.part.name.toLowerCase();
  return hosted.has(key) ? "hosted" : "not-provided";
}

/**
 * Read one `font-family` value against the faces this site loads.
 *
 * The split and the classification are the engine's, asked through one call.
 * A family list is quoting, comma, escape and identifier rules together —
 * `"ACME, Inc", serif` is two families rather than three, and `Brand,` is a
 * parse error the browser drops the declaration for. A second reading of that
 * grammar here would agree on the easy values and diverge on the ones a site's
 * real font name produces.
 */
export function readStack(
  value: string,
  faces: readonly FontFaceDef[]
): StackReading {
  const reading = readFamilyList(value);
  if (reading.kind !== "families" && reading.kind !== "dynamic") {
    return {
      kind: reading.kind,
      families: [],
      firstChoice: undefined,
      hasFallback: false,
      guaranteed: false,
    };
  }
  const hosted = hostedFamilies(faces);
  const families = reading.parts.map(entry => ({
    family: entry.part.name,
    source: sourceOf(entry, hosted),
  }));
  return {
    kind: reading.kind,
    families,
    firstChoice: families[0],
    hasFallback: families.length > 1,
    guaranteed: families.some(f => f.source !== "not-provided"),
  };
}

/** Which value of a token is being read. */
export type TokenMode = "light" | "dark";

/** A `fontFamily` token, read against the faces the site loads. */
export interface FontTokenRow {
  readonly token: SiteToken;
  /** The light value's reading. Always present: `values.light` is required. */
  readonly reading: StackReading;
  /**
   * The dark value's reading, when the token defines one.
   *
   * Read because the emitter applies it: a token whose light stack is hosted
   * and whose dark stack is not would otherwise report an all-clear while every
   * dark-mode reader gets a substitution. Absent when the token states no dark
   * value, which is not the same as stating the same value twice.
   */
  readonly darkReading: StackReading | undefined;
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
  /*
   * The tokens the compiler WRITES, not every token in the set.
   *
   * `emitTokenBlocks` refuses a token on five separate grounds — a name that is
   * not a token name, no light value, a value its guard rejects, a value that
   * fetches, and two identities landing on one custom property — and a refused
   * token reaches no page. Reporting on it would describe a typeface the site
   * never emits, and say its hosted family renders when nothing references it.
   *
   * Asked of the emitter rather than re-derived here: five conditions restated
   * in a second place agree today and drift the first time one changes. The
   * selector is the one the sheet uses, so the answer is the sheet's own.
   */
  if (tokens === undefined) return [];
  const emitted = emitTokenBlocks(tokens, ":root").emitted;
  return emitted
    .filter(token => token.kind === "fontFamily")
    .map(token => ({
      token,
      reading: readStack(token.values.light, faces),
      darkReading:
        token.values.dark === undefined
          ? undefined
          : readStack(token.values.dark, faces),
    }));
}

/** One thing worth saying about one mode of one token. */
export interface TokenNote {
  readonly mode: TokenMode;
  readonly text: string;
}

/** Whether a single reading is one an author should look at. */
function needsAttention(reading: StackReading): boolean {
  if (reading.kind === "invalid") return true;
  // A lone CSS-wide keyword is a deliberate, working value — `inherit` takes
  // the parent's font — so it names no typeface and needs no comment.
  if (reading.kind === "keyword") return false;
  return reading.firstChoice?.source === "not-provided";
}

/** What to say about one reading, or nothing when it is working as written. */
function noteFor(reading: StackReading, value: string): string | undefined {
  if (reading.kind === "invalid") {
    return `"${value}" is not a font-family value a browser will read, so this token applies nothing.`;
  }
  if (reading.kind === "keyword") return undefined;
  const first = reading.firstChoice;
  if (first?.source !== "not-provided") return undefined;
  // Branching on whether a later family EXISTS. Telling an author of a
  // single-family stack that readers "see the next family in the list" names an
  // entry that is not there, and points them at a fallback they never wrote.
  const consequence = reading.hasFallback
    ? "Readers without it installed see the next family in the list instead."
    : "Readers without it installed see the browser's default typeface instead.";
  return `${first.family} is the typeface this token asks for first, and this site provides no font file for it. ${consequence}`;
}

/**
 * Everything worth saying about one token, one entry per affected mode.
 *
 * A list rather than a string because a token can be sound in light and not in
 * dark, and one sentence for both would have to name a mode it did not check.
 */
export function tokenNotes(row: FontTokenRow): readonly TokenNote[] {
  const notes: TokenNote[] = [];
  const light = noteFor(row.reading, row.token.values.light);
  if (light !== undefined) notes.push({ mode: "light", text: light });
  const dark = row.token.values.dark;
  if (row.darkReading !== undefined && dark !== undefined) {
    const darkNote = noteFor(row.darkReading, dark);
    if (darkNote !== undefined) notes.push({ mode: "dark", text: darkNote });
  }
  return notes;
}

/**
 * The rows worth an author's attention, in EITHER mode.
 *
 * A row is drawn to attention when a mode's value cannot be read at all, or
 * when its FIRST family is one this site does not provide — that is the choice
 * the author expressed, and the one that silently does not happen.
 */
export function rowsNeedingAttention(
  rows: readonly FontTokenRow[]
): FontTokenRow[] {
  return rows.filter(
    row =>
      needsAttention(row.reading) ||
      (row.darkReading !== undefined && needsAttention(row.darkReading))
  );
}

/**
 * What the token list amounts to, in one sentence.
 *
 * Wording lives here rather than in the panel for the reason
 * {@link class-library.usageSummary} does: the sentence makes a claim about
 * evidence, and a claim is a rule. It also has to keep saying "provides no font
 * file for" rather than "missing", which is exactly the kind of distinction
 * that erodes when it lives in JSX.
 *
 * The two failing shapes are counted SEPARATELY. A value the browser will not
 * read applies nothing at all, while a stack whose first family is unprovided
 * applies the next one — different outcomes with different remedies, and one
 * count covering both sends an author to fix the wrong thing.
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
    // Deliberately not "each asking first for a family this site provides".
    // A `var()` stack has an unknown first choice and a lone `inherit` has no
    // family at all, so that sentence would claim something checked about rows
    // this code cannot check — the same over-claim the class manager avoids by
    // reporting absence of evidence rather than absence of usage.
    return `${rows.length} typeface ${noun}, none asking first for a typeface this site provides no file for.`;
  }
  // Counted per ROW-MODE rather than by subtraction. A token invalid in one
  // mode and unprovided in the other belongs in BOTH counts, and deriving one
  // as `attention.length - other` forced it to zero — omitting a problem
  // `tokenNotes` was reporting on the very same row.
  let unreadable = 0;
  let unprovided = 0;
  for (const row of attention) {
    const readings = [row.reading, row.darkReading].filter(
      (r): r is StackReading => r !== undefined
    );
    if (readings.some(r => r.kind === "invalid")) unreadable += 1;
    if (
      readings.some(
        r => r.kind !== "invalid" && r.firstChoice?.source === "not-provided"
      )
    ) {
      unprovided += 1;
    }
  }
  const parts: string[] = [];
  if (unprovided > 0) {
    parts.push(
      `${unprovided} ask first for a typeface this site provides no file for`
    );
  }
  if (unreadable > 0) {
    parts.push(
      `${unreadable} hold a value no browser will read, so they apply nothing`
    );
  }
  return `Of ${rows.length} typeface tokens, ${parts.join("; ")}.`;
}
