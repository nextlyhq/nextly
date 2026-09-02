/**
 * The fonts panel: what this site can render, and which choices will not happen.
 *
 * A panel over {@link font-library}. It authors nothing, and that is a design
 * decision rather than an omission: {@link tokens-panel} already creates and
 * renames `fontFamily` tokens, and a second surface editing the same tokens
 * would be two implementations of one question — the defect this codebase names
 * more often than any other.
 *
 * ## The question this answers, which the tokens studio cannot
 *
 * The studio edits one token and knows nothing about the faces the site loads.
 * `compileSiteSheet` calls `emitFontFaces` and `emitTokenBlocks` independently,
 * so a token naming a family with no face is emitted exactly like one that has
 * it, and the page draws in whatever the browser reaches for next. Nothing
 * errors and nothing is logged. Joining the two lists is the only way to see
 * it, and joining them needs both, which is why it lives here.
 *
 * ## Every family is drawn in ITSELF
 *
 * A list of typeface names set in the interface's own font asks an author to
 * choose a typeface from its name, which is guessing. Webflow, Framer and
 * Elementor all render the specimen in the face it names, and the one thing
 * every review of a weak font picker says is that it did not. The specimen is
 * also the honest signal here: a family this site does not provide renders in
 * the fallback, so an author SEES the substitution rather than reading about it.
 *
 * ## What it will not say
 *
 * Never "missing" or "unavailable" for a family with no face. A named family
 * may be installed on the reader's device — `Georgia` and `Helvetica` are the
 * ordinary cases — so declaring it absent is a claim about a machine this code
 * cannot see. The wording says what is true: this site provides no face for it.
 * The same discipline the class manager applies to a usage count it knows can
 * under-count.
 *
 * @module fonts-panel
 */
import { cssString } from "@nextlyhq/blocks-engine";
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import type * as React from "react";
import { useRef, useState } from "react";

import {
  emittableFaces,
  fontTokenRows,
  rowsNeedingAttention,
  tokenNotes,
  tokenSummary,
} from "./font-library";
import type { FamilyReading, FontTokenRow } from "./font-library";

export interface FontsPanelProps {
  /**
   * The faces this site loads, or `undefined` while the host has not read them.
   *
   * A real third state rather than an empty list, for the reason the class
   * manager has one: a site that self-hosts nothing legitimately has no faces,
   * and an author must not be shown "no fonts" for a read still in flight.
   */
  faces: readonly FontFaceDef[] | undefined;
  /** The site's tokens, whose `fontFamily` members this reads. */
  tokens: SiteTokenSet | undefined;
  /** Why the faces are absent, when they are. */
  absence?: "pending" | "failed";
  /**
   * Open the tokens panel, when the host offers one.
   *
   * The fix for a token naming a family this site does not provide is to edit
   * that token, and editing it belongs to the studio. Offering the jump rather
   * than the field is what keeps one editor for one question.
   */
  onOpenTokens?: () => void;
  /**
   * Add a font file to this site, when the host can store one.
   *
   * Optional, and its absence hides the control rather than disabling it: a
   * host with no media pipeline cannot store a file, and a disabled button is
   * a promise that something is coming.
   *
   * The panel does not upload — it cannot reach a media pipeline from here,
   * and should not. It collects what only an author knows, which is which
   * family this file belongs to and which weight and style within it, and
   * hands the host a file. Resolves to a message when the host refused and to
   * `undefined` when it stored one: the shape every other writer in this
   * editor already answers with.
   */
  onAddFace?: (request: FontFaceUpload) => Promise<string | undefined>;
  /**
   * What the file picker offers, as an `accept` attribute.
   *
   * The host's to state, not this panel's. Which formats can be uploaded,
   * stored and then served to an anonymous reader is one decision, and the
   * host is where it is already made — a list restated here would drift from
   * it, and the drift is invisible: a format this panel omits is one nobody
   * can add, and one it admits alone is a refusal arriving after the upload.
   *
   * Absent means the picker names no preference, which is the honest default
   * for a host that has not said. The host still decides on the way in.
   */
  acceptFiles?: string;
}

/**
 * A font file and the descriptors an author states for it.
 *
 * The weight and style are asked for rather than read from the file, because
 * getting them wrong is silent: a face declaring `400` for a bold file loads,
 * matches nothing the author meant, and the page renders in the fallback with
 * no error anywhere. A filename is a guess about them; the author is not.
 */
export interface FontFaceUpload {
  file: File;
  family: string;
  /** `400`, `700`, or a variable range such as `100 900`. */
  weight: string;
  /** `normal` or `italic`. */
  style: string;
}

/** The specimen, one sentence with ascenders, descenders and round forms. */
const SPECIMEN = "Almost before we knew it, we had left the ground";

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

/** What to draw for one face, so the row demonstrates the file it names. */
function specimenFor(face: FontFaceDef): string {
  const ranges = parseUnicodeRange(face.unicodeRange);
  // No descriptor, or one this cannot read, means the face is not declared to
  // be a subset — the Latin sentence is the specimen with the most to show.
  if (ranges === undefined) return SPECIMEN;
  const covered = [SPECIMEN, ...SCRIPT_SPECIMENS].find(text =>
    rangesCover(ranges, text)
  );
  return covered ?? sampleFromRanges(ranges);
}

/** The stack as CSS, so a specimen renders in the family it names. */
function specimenStyle(value: string): React.CSSProperties {
  return { fontFamily: value };
}

/**
 * A face's own specimen, drawn with the descriptors that face declares.
 *
 * Family alone selects the browser's normal weight and upright style, so a
 * site loading regular, bold and italic of one family would draw three
 * identical rows — the specimen would then demonstrate the opposite of what
 * the list claims, which is worse than no specimen.
 */
function faceSpecimenStyle(face: FontFaceDef): React.CSSProperties {
  return {
    // Escaped through the engine's own `cssString`, the way `emitFontFaces`
    // writes the same name into the site sheet. Quoting author data by hand
    // produces `"ACME "Pro""` for a legal family, the browser drops the
    // declaration, and the specimen demonstrates the fallback — the one lie
    // this panel must not tell.
    fontFamily: `"${cssString(face.family)}"`,
    ...(specimenWeight(face.weight) === undefined
      ? {}
      : { fontWeight: specimenWeight(face.weight) }),
    ...(face.style === undefined ? {} : { fontStyle: face.style }),
  };
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
function specimenWeight(weight: string | undefined): string | undefined {
  if (weight === undefined) return undefined;
  const parts = weight.trim().split(/\s+/);
  if (parts.length < 2) return weight;
  const low = Number(parts[0]);
  const high = Number(parts[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  return low <= 400 && 400 <= high ? "400" : String(low);
}

/**
 * Whether a string is a `font-weight` the browser will honour.
 *
 * The `datalist` below only SUGGESTS, so this field accepts anything typed
 * into it. `validateFontFace` refuses characters that would break the
 * stylesheet and says nothing about the grammar, so `70O` reached the sheet,
 * the browser ignored the descriptor, and the face was matched at a weight
 * nobody chose while the panel reported the add as a success.
 *
 * Both forms the descriptor allows: one absolute weight, or two making a
 * variable range.
 *
 * A range is ORDERED, which per-part checking cannot see. `900 100` is two
 * individually valid weights and not a range: the descriptor requires the
 * lower endpoint first.
 *
 * Refused rather than passed on, and the reason is NOT that a browser rejects
 * it. Measured: Chrome PARSES `font-weight: 900 100` and keeps it verbatim, so
 * the face is stored carrying a range no specification defines a meaning for,
 * and what it then matches is up to the engine. An author gets a face that
 * behaves differently in different browsers with nothing reporting why, which
 * is a worse outcome than the refusal — and the one form of it this panel can
 * see before it is stored.
 */
function isUsableWeight(weight: string): boolean {
  const parts = weight.trim().split(/\s+/);
  if (parts.length === 0 || parts.length > 2) return false;
  const low = weightValue(parts[0] ?? "");
  if (low === undefined) return false;
  if (parts.length === 1) return true;
  const high = weightValue(parts[1] ?? "");
  return high !== undefined && low <= high;
}

/**
 * One endpoint as the number it compares as, or nothing when it is not one.
 *
 * The two keywords are part of the grammar — `font-weight: bold 900` is a
 * legal descriptor — and they have fixed numeric meanings, so ordering can be
 * judged across a mixed pair rather than only across two numerals.
 */
function weightValue(part: string): number | undefined {
  if (part === "normal") return 400;
  if (part === "bold") return 700;
  // The spelling is checked BEFORE the conversion, because the conversion is
  // what loses the difference: `Number` and CSS read different languages.
  if (!CSS_NUMBER.test(part)) return undefined;
  const value = Number(part);
  return value >= 1 && value <= 1000 ? value : undefined;
}

/**
 * A CSS `<number>`: an optional sign, digits with an optional fraction, and an
 * optional exponent.
 *
 * A decimal point must be FOLLOWED BY A DIGIT. The tokenizer consumes `.` only
 * when a digit comes next, so `400.` ends the number at `400` and leaves the
 * point as a separate token — which the descriptor grammar does not admit.
 * Measured in a browser: `font-weight: 400.` inside `@font-face` is dropped,
 * while `400.0` and `400.5` are kept.
 *
 * `Number` was doing this job and reads a LARGER language than CSS does, which
 * fails in the silent direction: `0x190` converts to 400 and passes any bound
 * checked afterwards, while the string stored in the descriptor is still
 * `0x190` — which CSS cannot parse, so the browser drops the declaration and
 * matches the face at a weight nobody chose. Measured, the three radix
 * prefixes `0x`, `0b` and `0o` all reach that outcome.
 *
 * Written to the CSS grammar rather than as a list of JavaScript's extras, so
 * a spelling nobody enumerated is refused rather than admitted. The forms CSS
 * does allow are kept, and they are not exotic: `1e3`, `.5e3`, `400.` and
 * `+400` are all valid `<number>` tokens and all reach here through the free
 * text field.
 */
const CSS_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A key that separates the faces a family is really split into.
 *
 * Subsetting by `unicodeRange` is the ordinary way to ship a large script, and
 * those faces share family, weight and style by design — keyed on those three
 * alone they collide, and React cannot reconcile the rows.
 */
function faceKey(face: FontFaceDef): string {
  return [
    face.family,
    face.weight ?? "",
    face.style ?? "",
    face.unicodeRange ?? "",
    face.src.map(source => source.url).join("|"),
  ].join("::");
}

/** What a family's source means, in words an author can act on. */
function sourceNote(reading: FamilyReading): string {
  switch (reading.source) {
    case "hosted":
      return "this site loads a font file for it";
    case "generic":
      return "a generic family every browser resolves";
    case "dynamic":
      return "a custom property, resolved when the page renders — what it holds cannot be read from here";
    case "not-provided":
      return "this site provides no font file for it — readers see it only if it is already installed on their device";
  }
}

function FamilyLine({
  reading,
}: {
  reading: FamilyReading;
}): React.JSX.Element {
  return (
    <li className="nx-fonts__family">
      <span className="nx-fonts__family-name">{reading.family}</span>
      <span className="nx-fonts__family-note">{sourceNote(reading)}</span>
    </li>
  );
}

/**
 * What a row needs said, one line per affected mode.
 *
 * Its own component so the row stays layout, and a list because a token can be
 * sound in light and not in dark. The mode is named only when the token
 * actually declares a dark value: naming it otherwise would imply a mode the
 * author never configured.
 */
function TokenNotes({
  row,
  onOpenTokens,
}: {
  row: FontTokenRow;
  onOpenTokens?: () => void;
}): React.JSX.Element | null {
  const notes = tokenNotes(row);
  if (notes.length === 0) return null;
  const named = row.darkReading !== undefined;
  return (
    <>
      {notes.map(note => (
        <p className="nx-fonts__note nx-fonts__note--attention" key={note.mode}>
          {named ? `In ${note.mode} mode: ${note.text}` : note.text}
          {onOpenTokens === undefined ? null : (
            <>
              {" "}
              <button
                type="button"
                className="nx-fonts__jump"
                onClick={onOpenTokens}
              >
                Edit in Tokens
              </button>
            </>
          )}
        </p>
      ))}
    </>
  );
}

function TokenRow({
  row,
  onOpenTokens,
}: {
  row: FontTokenRow;
  onOpenTokens?: () => void;
}): React.JSX.Element {
  return (
    <li className="nx-fonts__token">
      <div className="nx-fonts__token-head">
        <span className="nx-fonts__token-name">{row.token.name}</span>
        {/*
          The specimen carries the token's WHOLE stack, so what is drawn is what
          the page draws. Rendering only the first family would show the author
          a typeface the browser may never reach.
        */}
        <span
          className="nx-fonts__specimen"
          style={specimenStyle(row.token.values.light)}
        >
          {SPECIMEN}
        </span>
      </div>
      <TokenNotes row={row} onOpenTokens={onOpenTokens} />
      <ul className="nx-fonts__families">
        {row.reading.families.map(family => (
          <FamilyLine key={family.family} reading={family} />
        ))}
      </ul>
    </li>
  );
}

/** The faces the site loads, each drawn in itself. */
function FaceList({
  faces,
}: {
  faces: readonly FontFaceDef[];
}): React.JSX.Element {
  // The list says "font files this site loads", so it shows what the compiler
  // will emit. A shaped-but-refused face — a remote `src`, an empty one — is
  // kept by the stored tier so its issues can be reported, and listing it here
  // would claim a file loads when the site sheet contains no `@font-face` for
  // it. The empty state is derived from the same list, so a site whose only
  // faces are refused correctly reads as loading none.
  const emittable = emittableFaces(faces);
  if (emittable.length === 0) {
    return (
      <p className="nx-fonts__note">
        This site loads no font files of its own. Tokens may still name generic
        families, and any typeface a reader has installed.
      </p>
    );
  }
  /*
   * Grouped by family, because that is the unit an author thinks in: adding a
   * typeface means adding its regular, its bold and its italic, and a flat list
   * repeats the same name down the panel while saying nothing about which
   * weights the family actually covers. The grouping is by the name AS WRITTEN,
   * for the reason `hostedFamilies` lowercases only for comparison — two faces
   * spelled differently declare different families to the browser, and drawing
   * them under one heading would claim a coverage the page does not have.
   */
  const families = new Map<string, { display: string; faces: FontFaceDef[] }>();
  for (const face of emittable) {
    // Keyed the way `hostedFamilies` compares, because CSS resolves a family
    // name case-insensitively: `Brand` and `brand` are ONE family to the
    // browser, and two headings here would claim a split the page does not
    // have. The first spelling seen is kept for display — the panel shows what
    // an author wrote rather than a normalised form they never typed.
    const key = face.family.toLowerCase();
    const group = families.get(key);
    if (group === undefined) {
      families.set(key, { display: face.family, faces: [face] });
    } else {
      group.faces.push(face);
    }
  }

  return (
    <ul className="nx-fonts__faces">
      {[...families].map(([key, group]) => (
        <li className="nx-fonts__family-group" key={key}>
          <span className="nx-fonts__face-name">{group.display}</span>
          <ul className="nx-fonts__family-faces">
            {group.faces.map(face => (
              <li className="nx-fonts__face" key={faceKey(face)}>
                <span className="nx-fonts__face-cut">{faceCut(face)}</span>
                <span
                  className="nx-fonts__specimen"
                  style={faceSpecimenStyle(face)}
                >
                  {specimenFor(face)}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Which cut of the family a face is, in the words a type foundry uses.
 *
 * A face declaring neither is the family's ordinary weight, and saying
 * "400 normal" for it would be louder than the fact deserves — the row exists
 * to distinguish cuts, so an undistinguished one says "Regular".
 */
function faceCut(face: FontFaceDef): string {
  const weight = face.weight?.trim() ?? "";
  /*
   * Any style that is not `normal`, rather than `italic` alone. `oblique` and
   * `oblique 10deg` are valid descriptors the specimen renders faithfully, so
   * recognising only italic labelled one of them `Regular` while the letters
   * beside it visibly slanted — the row contradicting the thing it describes.
   */
  const style = face.style?.trim() ?? "";
  const slanted = style !== "" && style.toLowerCase() !== "normal";
  if (weight === "" && !slanted) return "Regular";
  const label = slanted ? style.charAt(0).toUpperCase() + style.slice(1) : "";
  return [weight, label].filter(part => part !== "").join(" ");
}

/**
 * The family a filename suggests, as a starting point the author can correct.
 *
 * `Inter-BoldItalic.woff2` is `Inter`: the stem up to the first separator, with
 * the rest dropped because it usually names the weight and style, which are
 * asked for separately. A guess about the FAMILY is safe to prefill — the
 * author sees it in a field and reads it against the file they just chose —
 * where a guess about weight would be applied silently and match nothing.
 */
function familyFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  const head = stem.split(/[-_]/)[0] ?? stem;
  return head.trim();
}

/**
 * The controls that add a face.
 *
 * NOT a `<form>`, and that is the whole design. This panel is rendered inside
 * the entry editor, whose fields already sit in one — `EntryFormProvider`
 * writes it — and HTML forbids a form inside a form. React builds the element
 * anyway, and the result is worse than invalid markup: a submit raised in here
 * BUBBLES, and React delivers it to the entry form's own handler, so pressing
 * Enter in the family field saved the page entry. `preventDefault` does not
 * help, because the default action is not the problem; the propagation is.
 *
 * Saving the entry from here is not merely surprising. The builder is a
 * takeover surface that holds its work privately and writes it back on the way
 * out, so a save started while it is open commits the document as it was
 * BEFORE the session — the same trap `blockImplicitSubmit` was written for on
 * the admin's side of the boundary.
 *
 * Enter still adds the font. Refusing the keystroke outright would protect the
 * entry and take away the affordance every other text field in the product
 * has; intercepting it does both jobs, since a keystroke handled here never
 * reaches the form outside.
 */
function AddFaceForm({
  onAddFace,
  acceptFiles,
}: {
  onAddFace: (request: FontFaceUpload) => Promise<string | undefined>;
  acceptFiles?: string;
}): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [family, setFamily] = useState("");
  const [weight, setWeight] = useState("400");
  const [style, setStyle] = useState("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Whether the family in the field came from an author or from a filename.
   *
   * Emptiness cannot answer this. Reading "is it blank" refuses to overwrite a
   * GUESS as well as a typed name, so re-picking after choosing the wrong file
   * left the first file's family in place and stored the second file's bytes
   * under it — silently, which is the failure this form exists to avoid.
   */
  const [familyAuthored, setFamilyAuthored] = useState(false);
  /*
   * The picker element itself, because clearing it is not a state change.
   *
   * A file input is uncontrolled: `setFile(null)` forgets the choice on this
   * side and leaves the element still holding it, filename displayed. A
   * browser raises `change` only when the SELECTION changes, so choosing the
   * same file again after a successful add raises nothing, this component
   * never learns of it, and the button stays disabled — with the author
   * looking at a picker that shows the file they just chose.
   *
   * That is the ordinary path rather than an edge: one variable font is added
   * once per style, so re-picking the same file is how a family gets its
   * italic.
   */
  const picker = useRef<HTMLInputElement | null>(null);

  const chooseFile = (chosen: File | null): void => {
    setFile(chosen);
    setError(null);
    // A guess is replaced by a better guess; what an author typed is theirs.
    if (chosen !== null && !familyAuthored) {
      setFamily(familyFromFilename(chosen.name));
    }
  };

  const submit = async (): Promise<void> => {
    if (file === null || family.trim() === "" || busy) return;
    if (!isUsableWeight(weight)) {
      setError(
        "A weight is one number from 1 to 1000, or two making a variable range with the lighter one first — 400, or 100 900."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const refusal = await onAddFace({
        file,
        family: family.trim(),
        weight: weight.trim(),
        style,
      });
      if (refusal !== undefined) {
        setError(refusal);
        return;
      }
      /*
       * Cleared only on success, so a refusal leaves every field where the
       * author left it and the fix is one edit rather than a re-entry.
       *
       * The CUT is cleared with the rest. Adding a family means adding its
       * regular, its bold and its italic in turn, so a retained `700 Italic`
       * is applied to the NEXT file by default — a face stored under a weight
       * nobody chose, which loads and matches nothing.
       */
      setFile(null);
      // The element, not just this component's memory of it — see `picker`.
      if (picker.current !== null) picker.current.value = "";
      setFamily("");
      setFamilyAuthored(false);
      setWeight("400");
      setStyle("normal");
    } finally {
      setBusy(false);
    }
  };

  /*
   * Enter adds the font, and stops there.
   *
   * `preventDefault` for the entry form's implicit submission — a single-line
   * input inside a form submits it on Enter, and this panel's fields are
   * inside one. `stopPropagation` is not needed and not used: nothing above
   * listens for a keystroke, and the default action is the whole mechanism.
   *
   * A COMPOSING keystroke is exempt. An author using an IME presses Enter to
   * accept the candidate they are part-way through typing; the browser does
   * not submit on it, so taking it would make these fields unusable in
   * Japanese, Chinese and Korean to prevent nothing. Read from the native
   * event, which is where `isComposing` lives — and `keyCode === 229` is how
   * the same state reaches engines that report the composition instead.
   */
  const addOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div
      aria-labelledby="nx-fonts-add-heading"
      className="nx-fonts__add"
      role="group"
    >
      <h4 className="nx-fonts__add-heading" id="nx-fonts-add-heading">
        Add a font file
      </h4>

      <label className="nx-fonts__add-label" htmlFor="nx-fonts-file">
        Font file
      </label>
      <input
        accept={acceptFiles}
        className="nx-fonts__add-file"
        id="nx-fonts-file"
        onChange={event => chooseFile(event.target.files?.[0] ?? null)}
        ref={picker}
        type="file"
      />

      <label className="nx-fonts__add-label" htmlFor="nx-fonts-family">
        Family
      </label>
      <input
        className="nx-fonts__add-text"
        id="nx-fonts-family"
        onChange={event => {
          setFamily(event.target.value);
          setFamilyAuthored(true);
        }}
        onKeyDown={addOnEnter}
        placeholder="Inter"
        type="text"
        value={family}
      />

      <label className="nx-fonts__add-label" htmlFor="nx-fonts-weight">
        Weight
      </label>
      {/*
        A list rather than a closed select: a variable font declares a RANGE
        (`100 900`), which no menu of fixed weights can express, and a face
        stored with a single weight from such a file is matched for one weight
        and ignored for the rest.
      */}
      <input
        className="nx-fonts__add-text"
        id="nx-fonts-weight"
        list="nx-fonts-weights"
        onChange={event => setWeight(event.target.value)}
        onKeyDown={addOnEnter}
        type="text"
        value={weight}
      />
      <datalist id="nx-fonts-weights">
        {["100", "200", "300", "400", "500", "600", "700", "800", "900"].map(
          value => (
            <option key={value} value={value} />
          )
        )}
      </datalist>

      <label className="nx-fonts__add-label" htmlFor="nx-fonts-style">
        Style
      </label>
      <select
        className="nx-fonts__add-text"
        id="nx-fonts-style"
        onChange={event => setStyle(event.target.value)}
        value={style}
      >
        <option value="normal">Normal</option>
        <option value="italic">Italic</option>
      </select>

      {/*
        `type="button"` stated rather than left to default. A button inside a
        form defaults to `submit`, and this one is inside the entry's.
      */}
      <button
        className="nx-fonts__add-submit"
        disabled={busy || file === null || family.trim() === ""}
        onClick={() => void submit()}
        type="button"
      >
        {busy ? "Adding…" : "Add font file"}
      </button>

      {error !== null && (
        <p className="nx-fonts__add-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Faces absent: a read in flight and a read that failed need different words. */
function FacesAbsent({
  absence,
}: {
  absence?: "pending" | "failed";
}): React.JSX.Element {
  return (
    <div className="nx-fonts">
      <p className="nx-inspector__note">
        {absence === "failed"
          ? "This site's fonts could not be read."
          : "Loading fonts…"}
      </p>
    </div>
  );
}

/**
 * The panel.
 *
 * Faces first, then tokens: the faces are what the site HAS, and a token is a
 * claim measured against them. Reading the claims before the evidence would put
 * every "no font file for it" note in front of the list that explains it.
 */
export function FontsPanel({
  faces,
  tokens,
  absence,
  onOpenTokens,
  onAddFace,
  acceptFiles,
}: FontsPanelProps): React.JSX.Element {
  if (faces === undefined) return <FacesAbsent absence={absence} />;

  const rows = fontTokenRows(tokens, faces);

  return (
    <div className="nx-fonts">
      <section aria-labelledby="nx-fonts-faces">
        <h3 className="nx-fonts__heading" id="nx-fonts-faces">
          Font files this site loads
        </h3>
        <FaceList faces={faces} />
        {onAddFace !== undefined && (
          <AddFaceForm acceptFiles={acceptFiles} onAddFace={onAddFace} />
        )}
      </section>

      <section aria-labelledby="nx-fonts-tokens">
        <h3 className="nx-fonts__heading" id="nx-fonts-tokens">
          Typeface tokens
        </h3>
        <p className="nx-fonts__note" role="status">
          {tokenSummary(rows, rowsNeedingAttention(rows))}
        </p>
        <ul className="nx-fonts__tokens">
          {rows.map(row => (
            <TokenRow
              key={row.token.id ?? row.token.name}
              row={row}
              onOpenTokens={onOpenTokens}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
