/**
 * The words a header & footer set's own screen in the builder says, in one
 * place, so the words test reads them here.
 *
 * @module admin/editor/set-words
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";

/** What the canvas draws where any page goes. */
export const PAGE_PLACEHOLDER_WORDS = "Page content goes here";

/** Where the bottom bar's trail starts on a set's screen. */
export const SET_TRAIL_ROOT = "Header & footer set";

/** Said when an edit is asked of the placeholder, from any surface. */
export const SET_HAS_NO_PAGE =
  "A header & footer set has no page of its own. Edit its header or footer instead.";

/** The area's name in a sentence: "header", "footer". */
function areaWord(area: RegionArea): string {
  return area === "header" ? "header" : "footer";
}

/** What Delete says on a set's screen while its header or footer is selected. */
export function setRegionRefusal(area: RegionArea): string {
  return `The ${areaWord(area)} is chosen in this set's settings. Pick another there, or None.`;
}

/** How many pages show the set, as its settings say it. */
export function usedOnWords(
  pages: { readonly pages: number; readonly floor: boolean } | undefined
): string {
  if (pages === undefined) return "Counting the pages that use it…";
  const noun = pages.pages === 1 ? "page" : "pages";
  if (pages.floor) return `Used on at least ${String(pages.pages)} ${noun}`;
  return `Used on ${String(pages.pages)} ${noun}`;
}

/** The publish question's title, by how many pages it reaches. */
export function publishToWords(
  pages: { readonly pages: number; readonly floor: boolean } | undefined
): string {
  if (pages === undefined) return "Publish to every page that uses it?";
  const noun = pages.pages === 1 ? "page" : "pages";
  const count = pages.floor
    ? `at least ${String(pages.pages)}`
    : String(pages.pages);
  return `Publish to ${count} ${noun}?`;
}
