/**
 * How wide a title or description is on Google's results page, in pixels.
 *
 * Google cuts a title or description by the width it takes on the screen,
 * not by how many characters it has: a title of narrow letters ("il", "t")
 * fits well past 60 characters, and one of wide capitals ("W", "M") is cut
 * well short of it. Google writes both in Arial, a title at 20 px and the
 * text under it at 14 px, and on a desktop screen shows about 600 px of a
 * title and about 920 px (two lines) of a description. Google publishes none
 * of these figures; they are what measuring its results page gives, and the
 * figures the common SEO tools measure against. A phone shows a title on up
 * to two lines, so the desktop width is the one that cuts first.
 *
 * Measured from a table of Arial's own advance widths, not from a canvas, so
 * the server, the admin and the tests measure alike and the same text always
 * measures the same. Kerning is left out: in Arial it moves a title by a few
 * pixels at most.
 *
 * The one measure of a title's or description's width: the SEO tab, the SEO
 * Pages editor, the problem list and the save limit all read it. A leaf with
 * no imports, so the admin's client bundle takes it without server code.
 *
 * @module problems/text-width
 */

/** Which of a result's two texts is measured. */
export type SearchText = "title" | "description";

/** How Google draws each text: its font size, and how much of it shows. */
export const SEARCH_TEXT: Readonly<
  Record<SearchText, { fontSize: number; width: number }>
> = {
  title: { fontSize: 20, width: 600 },
  description: { fontSize: 14, width: 920 },
};

/** Arial's units to its em: each width below is in these units. */
const UNITS_PER_EM = 2048;

/**
 * Arial's advance width for each character from the space (U+0020) to the
 * tilde (U+007E), in font units, read from the font's own metrics table.
 */
const ASCII_WIDTHS = [
  569, 569, 727, 1139, 1139, 1821, 1366, 391, 682, 682, 797, 1196, 569, 682,
  569, 569, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 569,
  569, 1196, 1196, 1196, 1139, 2079, 1366, 1366, 1479, 1479, 1366, 1251, 1593,
  1479, 569, 1024, 1366, 1139, 1706, 1479, 1593, 1366, 1593, 1479, 1366, 1251,
  1479, 1366, 1933, 1366, 1366, 1251, 569, 569, 569, 961, 1139, 682, 1139, 1139,
  1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139,
  1139, 1139, 682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 684, 532, 684,
  1196,
];

/**
 * The same for the Latin-1 letters and signs, from the no-break space
 * (U+00A0) to ÿ (U+00FF): the accented letters of most European languages.
 */
const LATIN1_WIDTHS = [
  569, 682, 1139, 1139, 1139, 1139, 532, 1139, 682, 1509, 758, 1139, 1196, 682,
  1509, 1131, 819, 1124, 682, 682, 682, 1180, 1100, 682, 682, 682, 748, 1139,
  1708, 1708, 1708, 1251, 1366, 1366, 1366, 1366, 1366, 1366, 2048, 1479, 1366,
  1366, 1366, 1366, 569, 569, 569, 569, 1479, 1479, 1593, 1593, 1593, 1593,
  1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251, 1139, 1139, 1139,
  1139, 1139, 1139, 1821, 1024, 1139, 1139, 1139, 1139, 569, 569, 569, 569,
  1139, 1139, 1139, 1139, 1139, 1139, 1139, 1124, 1251, 1139, 1139, 1139, 1139,
  1024, 1139, 1024,
];

/** The punctuation titles use past Latin-1, as Arial draws it. */
const PUNCTUATION_WIDTHS: Readonly<Record<string, number>> = {
  " ": 410, // thin space
  "–": 1139, // en dash
  "—": 2048, // em dash
  "‘": 455,
  "’": 455,
  "“": 682,
  "”": 682,
  "•": 717, // bullet
  "…": 2048, // ellipsis
  "′": 384,
  "″": 725,
  "‹": 682,
  "›": 682,
  "€": 1139, // euro
  "™": 2048, // trade mark
  "←": 2048,
  "→": 2048,
  "−": 1196, // minus
};

/**
 * A letter of another script, which Arial draws about as wide as an "n":
 * Greek and Cyrillic average within a few units of it.
 */
const OTHER_LETTER = 1139;

/** Characters drawn a whole em wide: Chinese, Japanese, Korean, full-width. */
const WHOLE_EM =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠]/u;

/**
 * A picture: an emoji draws one em wide, however it is joined. A keycap
 * (`1️⃣`, a digit and the enclosing keycap mark) and a flag (two regional
 * indicators) are emoji whose parts are not pictographs themselves.
 */
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

/**
 * `text` as a results page draws it: a run of the spacing HTML collapses
 * (spaces, tabs, line breaks) as one space, and none at either end. A
 * no-break, ideographic or em space is drawn as it is, so it keeps its width.
 */
function drawn(text: string): string {
  return text.replace(/[ \t\n\f\r]+/g, " ").replace(/^ | $/g, "");
}

/** Characters that take no width of their own: accents, joiners, selectors. */
const NO_WIDTH = /[\p{M}\p{Cf}︀-️]/u;

/** One character's width, in font units. */
function charUnits(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return ASCII_WIDTHS[code - 0x20] ?? 0;
  if (code >= 0xa0 && code <= 0xff) return LATIN1_WIDTHS[code - 0xa0] ?? 0;
  const punctuation = PUNCTUATION_WIDTHS[char];
  if (punctuation !== undefined) return punctuation;
  if (NO_WIDTH.test(char) || code < 0x20) return 0;
  if (WHOLE_EM.test(char)) return UNITS_PER_EM;
  // An accented letter past Latin-1 ("ā", "č", "ő") is as wide as its letter.
  const parts = char.normalize("NFD");
  if (parts !== char)
    return [...parts].reduce((sum, c) => sum + charUnits(c), 0);
  return OTHER_LETTER;
}

/** `text` split into what a reader sees as one character each. */
function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), part => part.segment);
}

/**
 * One grapheme's width in font units: an emoji, however built, is one em.
 * Composed first (NFC), so text stored decomposed measures as it draws: a
 * Korean syllable kept as its two or three letters is one syllable, one em.
 */
function graphemeUnits(grapheme: string): number {
  if (PICTURE.test(grapheme)) return UNITS_PER_EM;
  return [...grapheme.normalize("NFC")].reduce(
    (sum, char) => sum + charUnits(char),
    0
  );
}

/** How wide `text` draws at `fontSize` pixels, exactly as given. */
function widthAsGiven(text: string, fontSize: number): number {
  const units = graphemes(text).reduce(
    (sum, grapheme) => sum + graphemeUnits(grapheme),
    0
  );
  return (units / UNITS_PER_EM) * fontSize;
}

/** How wide `text` draws in Arial at `fontSize` pixels, unrounded. */
export function textWidth(text: string, fontSize: number): number {
  return widthAsGiven(drawn(text), fontSize);
}

/** How long `text` reads: in characters, so an emoji counts once. */
function characters(text: string): number {
  return [...text].length;
}

/** How a title or description fits Google's results. */
export interface TextFit {
  /** How wide it draws, in whole pixels. */
  pixels: number;
  /** How many pixels of it Google shows. */
  limit: number;
  /** Whether Google shows all of it. */
  fits: boolean;
  /** Its length in characters, as a second hint. */
  characters: number;
}

/** How `text` fits as a result's `kind`: its width against what shows. */
export function textFit(kind: SearchText, text: string): TextFit {
  const { fontSize, width } = SEARCH_TEXT[kind];
  const pixels = Math.round(textWidth(text, fontSize));
  return {
    pixels,
    limit: width,
    fits: pixels <= width,
    characters: characters(text),
  };
}

/** The fit in words, as every surface writes it: "412 of 600 px". */
export function widthText(fit: TextFit): string {
  return `${fit.pixels} of ${fit.limit} px`;
}

/** The length in characters, in words: "1 character", "48 characters". */
export function charactersText(fit: TextFit): string {
  return `${fit.characters} ${fit.characters === 1 ? "character" : "characters"}`;
}

/**
 * The fit as the admin writes it under a title or description: whether
 * Google shows it whole, its width, then its characters as a hint. "Fits ·
 * 412 of 600 px · 48 characters", or "Google cuts it · …".
 */
export function fitSummary(fit: TextFit): string {
  const verdict = fit.fits ? "Fits" : "Google cuts it";
  return `${verdict} · ${widthText(fit)} · ${charactersText(fit)}`;
}

/**
 * `text` as Google shows it as a result's `kind`, its spacing as drawn:
 * whole where it fits, else cut at the last word that fits with " …" after
 * it.
 */
export function cutToFit(kind: SearchText, text: string): string {
  // Whole where the fit says it fits, the one decision the width bar and the
  // problem list make, so the preview never cuts a value they call fitting.
  const shown = drawn(text);
  if (textFit(kind, shown).fits) return shown;
  const { fontSize, width } = SEARCH_TEXT[kind];
  // The suffix is added after the cut, its space included, so its whole
  // width is kept free.
  const room = width - widthAsGiven(" …", fontSize);
  let kept = "";
  let used = 0;
  for (const grapheme of graphemes(shown)) {
    const next = used + (graphemeUnits(grapheme) / UNITS_PER_EM) * fontSize;
    if (next > room) break;
    kept += grapheme;
    used = next;
  }
  // Cut at a word where one ends inside what fits, as Google does.
  const space = kept.lastIndexOf(" ");
  const word = space > 0 ? kept.slice(0, space) : kept;
  return `${word.trimEnd()} …`;
}
