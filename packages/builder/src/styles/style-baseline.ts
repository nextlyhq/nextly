/**
 * Which style values the Style tab withholds until web.dev's Baseline marks
 * them "widely available".
 *
 * The first release offers only CSS every core browser has shipped for thirty
 * months, so a page an author builds today looks the same for every visitor.
 * Newer properties and keywords join as the data moves, one reviewed bump of
 * the pinned release at a time.
 *
 * **Only the answer ships, never the data.** The web-features dataset is
 * several megabytes and the editor needs one bit per value from it, so this
 * module holds the short list of what is withheld and
 * `style-baseline.test.ts` holds that list to the pinned release in both
 * directions: everything offered must be widely available, and everything
 * withheld must still not be. The package imports `web-features` from that
 * test alone, and the layering test refuses it anywhere else, so it cannot
 * reach the admin bundle.
 *
 * **Withheld is not removed.** A stored value the gate withholds is still on
 * the page — written before the gate, or through the API, which never asks the
 * editor — so the panel keeps showing it, clear-only, and says why it is no
 * longer offered.
 *
 * @module style-baseline
 */

/**
 * The web-features release this list was checked against: the exact version
 * the package's `devDependencies` pins, which the test asserts.
 */
export const BASELINE_DATA_RELEASE = "3.44.0";

/**
 * A withheld property, or one withheld keyword of it.
 *
 * Addressed by the CSS property a catalog leaf emits rather than by the
 * catalog key, because that is what the data tracks: `width` and `maxWidth`
 * are two catalog keys, and Baseline answers for `width` and `max-width`.
 */
export interface WithheldStyleValue {
  readonly cssProperty: string;
  /** Omitted to withhold the whole property, every keyword with it. */
  readonly keyword?: string;
}

/**
 * Everything the catalog declares that web-features 3.44.0 does not mark
 * widely available, each with the feature that holds it back.
 *
 * A keyword of several words is withheld when any one of its words is, so
 * `display: block ruby` and `container-type: inline-size scroll-state` need no
 * entry of their own.
 */
export const BASELINE_WITHHELD: readonly WithheldStyleValue[] = [
  // Not on iOS Safari, so the feature is not Baseline at all.
  { cssProperty: "background-attachment" },
  // Anchor positioning.
  { cssProperty: "align-items", keyword: "anchor-center" },
  // Tracked on its own, and not yet everywhere.
  { cssProperty: "align-content", keyword: "last baseline" },
  // Overflow alignment: newly available, widely available later. Each is a
  // word of a keyword (`safe center`) rather than a value of its own.
  { cssProperty: "justify-content", keyword: "safe" },
  { cssProperty: "justify-content", keyword: "unsafe" },
  { cssProperty: "align-items", keyword: "safe" },
  { cssProperty: "align-items", keyword: "unsafe" },
  { cssProperty: "align-content", keyword: "safe" },
  { cssProperty: "align-content", keyword: "unsafe" },
  // Supported everywhere, but the feature is held back by accessibility
  // defects in how browsers expose the element's own role.
  { cssProperty: "display", keyword: "contents" },
  // Ruby layout.
  { cssProperty: "display", keyword: "ruby" },
  { cssProperty: "display", keyword: "ruby-base" },
  { cssProperty: "display", keyword: "ruby-base-container" },
  { cssProperty: "display", keyword: "ruby-text" },
  { cssProperty: "display", keyword: "ruby-text-container" },
  // The `stretch` sizing keyword.
  { cssProperty: "width", keyword: "stretch" },
  { cssProperty: "height", keyword: "stretch" },
  { cssProperty: "min-width", keyword: "stretch" },
  { cssProperty: "min-height", keyword: "stretch" },
  { cssProperty: "max-width", keyword: "stretch" },
  { cssProperty: "max-height", keyword: "stretch" },
  // MathML's own keywords.
  { cssProperty: "font-size", keyword: "math" },
  { cssProperty: "text-transform", keyword: "math-auto" },
  // Not yet in every core browser.
  { cssProperty: "text-align", keyword: "match-parent" },
  { cssProperty: "text-transform", keyword: "full-size-kana" },
  { cssProperty: "text-transform", keyword: "full-width" },
  { cssProperty: "mix-blend-mode", keyword: "plus-darker" },
  // Scroll-state container queries.
  { cssProperty: "container-type", keyword: "scroll-state" },
];

/** Whether the gate withholds a whole property, every keyword of it included. */
export function propertyWithheld(cssProperty: string): boolean {
  return BASELINE_WITHHELD.some(
    entry => entry.cssProperty === cssProperty && entry.keyword === undefined
  );
}

/**
 * Whether the gate withholds one keyword of a property: the keyword itself,
 * any word of it, or the property as a whole.
 */
export function keywordWithheld(cssProperty: string, keyword: string): boolean {
  if (propertyWithheld(cssProperty)) return true;
  const words = new Set([keyword, ...keyword.split(" ")]);
  return BASELINE_WITHHELD.some(
    entry =>
      entry.cssProperty === cssProperty &&
      entry.keyword !== undefined &&
      words.has(entry.keyword)
  );
}

/**
 * Why a stored value is shown clear-only, in an author's words.
 *
 * One sentence for every withheld value, because the reason is the same for
 * each: the value works in some browsers and not in all of them.
 */
export const BASELINE_WITHHELD_HINT =
  "No longer offered: not every major browser supports it yet. It can be cleared.";
