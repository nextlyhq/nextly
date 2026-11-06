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
  cssString,
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
 * One filter for the family list and the token analysis, so the two cannot
 * disagree about which faces exist.
 */
function emittableFaces(faces: readonly FontFaceDef[]): readonly FontFaceDef[] {
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
    return `"${value}" is not a font-family value a browser will read, so this variable applies nothing.`;
  }
  if (reading.kind === "keyword") return undefined;
  const first = reading.firstChoice;
  if (first?.source !== "not-provided") return undefined;
  // Branching on whether a later family EXISTS. Telling an author of a
  // single-family stack that readers "see the next family in the list" names an
  // entry that is not there, and points them at a fallback they never wrote.
  const consequence = reading.hasFallback
    ? "Readers without it installed see the next font in the list instead."
    : "Readers without it installed see the browser\u2019s default font instead.";
  return `${first.family} is the font this variable asks for first, and this site has no file for it. ${consequence}`;
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

/** Where a family on the site came from, in the editor's terms. */
export type FamilyOrigin = "google" | "upload" | "code";

/** One family the site loads, as the Fonts tab lists it. */
export interface SiteFamily {
  /** The family lower-cased, as CSS matches it. */
  readonly key: string;
  /** The family as first written. */
  readonly family: string;
  readonly faces: readonly FontFaceDef[];
  /**
   * `code` when any face comes from the site's configuration, which the
   * editor cannot change; otherwise where the stored faces say they came from.
   */
  readonly origin: FamilyOrigin;
  /** Whether Remove is offered: when the site stored any of the faces. */
  readonly removable: boolean;
  /** The styles in a few characters: `3 styles`, or a variable `100–900`. */
  readonly styles: string;
  /** The licence in words, when the faces name one. */
  readonly licence?: string;
  /** The catalogue's category, when the faces name one. */
  readonly category?: string;
}

/** The licences the catalogue uses, in the words their authors use. */
const LICENCE_NAMES: Readonly<Record<string, string>> = {
  "OFL-1.1": "SIL Open Font License",
  "Apache-2.0": "Apache License 2.0",
  "UFL-1.0": "Ubuntu Font Licence",
};

/** A licence in words; an unknown one as the catalogue wrote it. */
export function licenceName(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return LICENCE_NAMES[id] ?? id;
}

/** What a face is for comparing two lists of faces: what it declares and loads. */
function faceIdentity(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.unicodeRange ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/** Whether a face's style slants: anything but `normal`. */
function slanted(style: string | undefined): boolean {
  const value = style?.trim().toLowerCase() ?? "";
  return value !== "" && value !== "normal";
}

/** A weight descriptor's numbers: one, or the two ends of a range. */
function weightNumbers(weight: string | undefined): number[] {
  return (weight ?? "400")
    .trim()
    .split(/\s+/)
    .map(part =>
      part === "normal" ? 400 : part === "bold" ? 700 : Number(part)
    )
    .filter(Number.isFinite);
}

/** A row's styles in a few characters: a variable range, else a count. */
function styleSummary(faces: readonly FontFaceDef[]): string {
  const range = faces
    .map(face => weightNumbers(face.weight))
    .find(numbers => numbers.length === 2);
  if (range !== undefined) {
    return `${String(range[0])}\u2013${String(range[1])}`;
  }
  return styleCount(faces);
}

/** How many cuts the faces draw: `1 style`, `3 styles`. */
function styleCount(faces: readonly FontFaceDef[]): string {
  const cuts = new Set(faces.map(face => cutName(face.weight, face.style)));
  return cuts.size === 1 ? "1 style" : `${String(cuts.size)} styles`;
}

/**
 * The families the site loads, grouped as CSS matches them (case-insensitive,
 * the first spelling kept), in the order the faces are listed.
 *
 * @param faces - Every face the page emits, from code and stored
 * @param fromCode - The faces the site's configuration supplies
 */
export function siteFamilies(
  faces: readonly FontFaceDef[],
  fromCode: readonly FontFaceDef[]
): SiteFamily[] {
  const coded = new Set(fromCode.map(faceIdentity));
  const groups = new Map<string, FontFaceDef[]>();
  const spelled = new Map<string, string>();
  for (const face of emittableFaces(faces)) {
    const key = face.family.toLowerCase();
    if (!spelled.has(key)) spelled.set(key, face.family);
    groups.set(key, [...(groups.get(key) ?? []), face]);
  }
  return [...groups].map(([key, members]) => {
    const fromConfig = members.some(face => coded.has(faceIdentity(face)));
    const source = members.find(face => face.source !== undefined)?.source;
    const licence = licenceName(source?.licence);
    return {
      key,
      family: spelled.get(key) ?? key,
      faces: members,
      origin: fromConfig ? "code" : (source?.kind ?? "upload"),
      // Remove takes only the stored faces, so a family the site's code also
      // supplies can still lose the cuts added beside it.
      removable: members.some(face => !coded.has(faceIdentity(face))),
      styles: styleSummary(members),
      ...(licence === undefined ? {} : { licence }),
      ...(source?.category === undefined ? {} : { category: source.category }),
    };
  });
}

/** The words a type foundry uses for each weight. */
const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi bold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

/** A weight in words with its number: `Bold 700`. */
export function weightName(weight: number): string {
  const name = WEIGHT_NAMES[weight];
  return name === undefined ? String(weight) : `${name} ${String(weight)}`;
}

/**
 * Which cut of a family a face is: `Regular 400`, `Bold Italic 700`, or
 * `Variable 100–900` for a face covering a range.
 */
export function cutName(weight?: string, style?: string): string {
  const numbers = weightNumbers(weight);
  const italic = slanted(style);
  if (numbers.length === 2) {
    const range = `${String(numbers[0])}\u2013${String(numbers[1])}`;
    return italic ? `Variable Italic ${range}` : `Variable ${range}`;
  }
  const value = numbers[0];
  if (weight === undefined || value === undefined) {
    return italic ? "Italic" : "Regular";
  }
  if (!italic) return weightName(value);
  const name = WEIGHT_NAMES[value];
  // "Italic 400" rather than "Regular Italic 400", as foundries say it.
  if (value === 400 || name === undefined) return `Italic ${String(value)}`;
  return `${name} Italic ${String(value)}`;
}

/** Where a family came from, in words. */
function originWords(origin: FamilyOrigin): string {
  if (origin === "google") return "from Google Fonts";
  if (origin === "upload") return "uploaded";
  return "set in your site\u2019s code";
}

/** A family in words, for its row's accessible name. */
export function familyDescription(family: SiteFamily): string {
  const cuts = [
    ...new Set(family.faces.map(face => cutName(face.weight, face.style))),
  ];
  return `${family.family}, ${styleCount(family.faces)}: ${cuts.join(", ")}, ${originWords(family.origin)}`;
}

/** The stored faces without one family's, matched as CSS matches a family. */
export function withoutFamily(
  faces: readonly FontFaceDef[],
  key: string
): FontFaceDef[] {
  return faces.filter(face => face.family.toLowerCase() !== key);
}

/** The generic family each catalogue category falls back to. */
const GENERIC_FOR: Readonly<Record<string, string>> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  monospace: "monospace",
  handwriting: "cursive",
};

/**
 * What picking a family stores: its name quoted, then the generic family its
 * category falls back to, so a reader still gets a sensible face while the
 * file loads or if it never does.
 */
export function familyStack(family: string, category?: string): string {
  const generic =
    category === undefined
      ? "system-ui"
      : (GENERIC_FOR[category] ?? "system-ui");
  return `"${cssString(family)}", ${generic}`;
}

/** The specimen, one sentence with ascenders, descenders and round forms. */
export const SPECIMEN: string =
  "Almost before we knew it, we had left the ground";

/**
 * Specimen text for a face limited to one script.
 *
 * A face subset to a non-Latin `unicodeRange` covers none of the Latin sentence
 * above, so the browser draws that row from another subset of the family or
 * from a fallback — the row would claim to demonstrate a file whose glyphs are
 * nowhere on screen. A candidate is chosen by whether the declared range COVERS
 * it, not by which band the range opens in: a start codepoint says nothing
 * about how far the range reaches, so `U+0400-0401` would otherwise be handed a
 * whole Cyrillic sentence it can draw two characters of.
 *
 * Latin faces and faces declaring no range keep the sentence: it exercises
 * ascenders, descenders and round forms, which is what a specimen is for.
 */
const SCRIPT_SPECIMENS: readonly string[] = [
  "Αλμοστ πριν το καταλάβουμε",
  "Почти прежде чем мы поняли",
  "כמעט לפני שידענו זאת",
  "تقريبا قبل أن ندرك ذلك",
  "इससे पहले कि हमें पता चलता",
  "เกือบก่อนที่เราจะรู้ตัว",
  "気づく前に地面を離れていた",
  "우리가 알기도 전에 땅을 떠났다",
];

/**
 * The highest codepoint that exists.
 *
 * `validateFontFace` checks a `unicode-range` for characters that could break
 * out of the stylesheet; it does not check that the numbers name real
 * codepoints, and `U+110000-110010` passes it. `String.fromCodePoint` THROWS on
 * anything above this, which took down the whole panel rather than the one row.
 */
const MAX_CODEPOINT = 0x10ffff;

/** One interval of a `unicode-range`, inclusive at both ends. */
interface CodepointRange {
  readonly from: number;
  readonly to: number;
}

/** `U+0400`, `U+0400-04FF` or the wildcard form `U+4??`, as one interval. */
const RANGE_ITEM = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i;
const WILDCARD_ITEM = /^U\+([0-9A-F]*\?{1,6})$/i;

/**
 * The intervals a `unicode-range` names, or none when it cannot be read.
 *
 * The wildcard form is a separate pattern because `?` is not a hex digit and
 * stands for every value that digit could take: `U+4??` is `U+0400-04FF`, so it
 * expands by filling the wildcards with `0` for the floor and `F` for the
 * ceiling. Reading it with the hex pattern captured the leading digits alone and
 * produced an interval three orders of magnitude below the one declared.
 *
 * An unreadable item abandons the whole descriptor rather than contributing a
 * partial answer: a range this cannot parse is one whose coverage is unknown,
 * and treating the items it did parse as the whole would under-state it.
 */
function parseUnicodeRange(
  range: string | undefined
): readonly CodepointRange[] | undefined {
  if (range === undefined) return undefined;
  const parsed: CodepointRange[] = [];
  for (const item of range.split(",")) {
    const interval = parseRangeItem(item.trim());
    if (interval === undefined) return undefined;
    parsed.push(interval);
  }
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * An interval, or nothing when it names no codepoints that exist.
 *
 * REFUSED rather than clamped. A descriptor reaching past the end of Unicode is
 * not a range with a typo in it — nothing can be concluded about what the face
 * covers — and clamping would invent a range the author never wrote and then
 * draw a specimen from it. Refusing sends the whole descriptor to the unreadable
 * path, where the Latin sentence is used and no claim is made.
 */
function readableInterval(
  from: number,
  to: number
): CodepointRange | undefined {
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  if (from > MAX_CODEPOINT || to > MAX_CODEPOINT) return undefined;
  // An inverted interval names nothing, and iterating it yields nothing while
  // reading as though a range had been declared.
  if (from > to) return undefined;
  return { from, to };
}

/** One comma-separated item of a `unicode-range`. */
function parseRangeItem(item: string): CodepointRange | undefined {
  const wildcard = WILDCARD_ITEM.exec(item);
  if (wildcard?.[1] !== undefined) {
    const digits = wildcard[1];
    return readableInterval(
      Number.parseInt(digits.replace(/\?/g, "0"), 16),
      Number.parseInt(digits.replace(/\?/g, "F"), 16)
    );
  }
  const match = RANGE_ITEM.exec(item);
  if (match?.[1] === undefined) return undefined;
  const from = Number.parseInt(match[1], 16);
  const to = match[2] === undefined ? from : Number.parseInt(match[2], 16);
  return readableInterval(from, to);
}

/**
 * Whether every glyph a candidate needs falls inside the declared intervals.
 *
 * Iterated by code point rather than by UTF-16 unit, so a character outside the
 * basic plane is tested as the one value a `unicode-range` names it by.
 * Whitespace is skipped: a space carries no glyph a specimen is demonstrating,
 * and no script subset includes `U+0020`, so requiring it would reject every
 * non-Latin candidate.
 */
function rangesCover(ranges: readonly CodepointRange[], text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point === undefined || /\s/.test(character)) continue;
    if (!ranges.some(range => point >= range.from && point <= range.to)) {
      return false;
    }
  }
  return true;
}

/**
 * Characters taken from the declared intervals themselves.
 *
 * The last resort, for a face whose range matches no sentence here — an icon
 * font, or a subset narrower than any phrase. Drawing a sentence it cannot
 * render would demonstrate a fallback, so this shows glyphs the face is
 * declared to carry instead. Control characters and the surrogate block are
 * skipped because neither renders as anything.
 */
function sampleFromRanges(ranges: readonly CodepointRange[]): string {
  const sampled: string[] = [];
  for (const range of ranges) {
    /*
     * Stepped ACROSS the interval rather than taken from its start. A range
     * opens on its least interesting characters — `U+0080-00FF` begins with
     * thirty-two invisible controls and then a run of symbols — so a walk from
     * the front spends the whole budget before reaching a letter the face can
     * actually demonstrate. Striding shows what the interval holds.
     */
    const span = range.to - range.from + 1;
    const stride = Math.max(1, Math.floor(span / SAMPLE_LENGTH));
    for (let point = range.from; point <= range.to; point += stride) {
      if (sampled.length >= SAMPLE_LENGTH) return sampled.join("");
      if (renderableCodepoint(point)) sampled.push(String.fromCodePoint(point));
    }
  }
  return sampled.join("");
}

/** How many glyphs a sampled specimen shows. Enough to read the shapes. */
const SAMPLE_LENGTH = 12;

/**
 * Whether a codepoint draws anything: not a control, not half a pair.
 *
 * The C1 block is the one that bites. A face subset to `U+0080-00FF` covers no
 * canned sentence, so sampling starts at `U+0080` — and thirty-two invisible
 * controls fill the twelve-glyph budget before reaching a single accented
 * letter, leaving a specimen that renders as nothing at all.
 */
function renderableCodepoint(point: number): boolean {
  if (point < 0x20) return false;
  // DEL, then the C1 controls.
  if (point === 0x7f) return false;
  if (point >= 0x80 && point <= 0x9f) return false;
  return !(point >= 0xd800 && point <= 0xdfff);
}

/** What to draw for one face, so a specimen demonstrates the file it names. */
export function specimenText(face: FontFaceDef): string {
  const ranges = parseUnicodeRange(face.unicodeRange);
  // No descriptor, or one this cannot read, means the face is not declared to
  // be a subset — the Latin sentence is the specimen with the most to show.
  if (ranges === undefined) return SPECIMEN;
  const covered = [SPECIMEN, ...SCRIPT_SPECIMENS].find(text =>
    rangesCover(ranges, text)
  );
  return covered ?? sampleFromRanges(ranges);
}

/**
 * One weight the specimen element can actually carry.
 *
 * A variable face declares a RANGE — `100 900` — which is valid in
 * `@font-face` and invalid as a `font-weight` on an element: the browser drops
 * the whole declaration and draws at its normal weight, so a range excluding
 * 400 renders the specimen in a FALLBACK while the row claims to demonstrate
 * the file.
 *
 * 400 when the range covers it, because that is what a reader sees in ordinary
 * text; otherwise the lower bound, which the face definitely provides.
 */
export function specimenWeight(weight: string | undefined): string | undefined {
  if (weight === undefined) return undefined;
  const parts = weight.trim().split(/\s+/);
  if (parts.length < 2) return weight;
  const low = Number(parts[0]);
  const high = Number(parts[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  return low <= 400 && 400 <= high ? "400" : String(low);
}
