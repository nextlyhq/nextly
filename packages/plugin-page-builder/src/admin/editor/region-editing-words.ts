/**
 * What is said while a header or footer is edited in place: the bar above
 * the canvas, what is announced on entering and leaving, the top bar's Save
 * and Publish, the publish question, the Done question and its four answers,
 * the lock's refusal and a failed save's "Try again".
 *
 * One module, so every surface says the same words and the words test reads
 * one place.
 *
 * @module admin/editor/region-editing-words
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";

/** How many pages show the region: counted, and whether the count is whole. */
export type RegionReach =
  | { readonly count: number; readonly complete: boolean }
  | undefined;

/** The area as a sentence says it. */
function areaWord(area: RegionArea): "header" | "footer" {
  return area === "header" ? "header" : "footer";
}

/**
 * The pages a change reaches, as a phrase: "11 pages", "1 page", "at least
 * 40 pages" while the count is a floor, or `undefined` while none is known.
 */
function pagesPhrase(reach: RegionReach): string | undefined {
  if (reach === undefined) return undefined;
  const noun = reach.count === 1 ? "page" : "pages";
  return reach.complete
    ? `${reach.count} ${noun}`
    : `at least ${reach.count} ${noun}`;
}

/**
 * When the version edited was last changed, as the bar says it: the time
 * alone for today, else the day and the time.
 */
function changedWhen(changedAt: string, now: Date = new Date()): string {
  const at = new Date(changedAt);
  if (Number.isNaN(at.getTime())) return changedAt;
  const sameDay = at.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    sameDay
      ? { timeStyle: "short" }
      : { dateStyle: "medium", timeStyle: "short" }
  ).format(at);
}

/** The bar above the canvas, and what is announced on entering. */
export function editingWords(
  area: RegionArea,
  reach: RegionReach,
  /** When the latest version's unpublished changes were made, if it has any. */
  unpublishedFrom: string | undefined
): { bar: string; entered: string } {
  const word = areaWord(area);
  const pages = pagesPhrase(reach);
  const shows =
    pages === undefined
      ? "changes show on every page that shows it"
      : `changes show on ${pages}`;
  const draft =
    unpublishedFrom === undefined
      ? ""
      : ` · Unpublished changes from ${changedWhen(unpublishedFrom)}`;
  return {
    bar: `Editing the site ${word} · ${shows}${draft}`,
    entered: `Editing the site ${word}. ${capitalized(shows)}.`,
  };
}

/** Announced on leaving. */
export const BACK_TO_THE_PAGE = "Back to the page.";

/** The bar's way back. */
export const DONE = "Done";

/** The top bar's Save while a header is edited: "Save header". */
export function saveLabel(area: RegionArea): string {
  return area === "header" ? "Save header" : "Save footer";
}

/** The top bar's Publish while a header is edited: "Publish header". */
export function publishLabel(area: RegionArea): string {
  return area === "header" ? "Publish header" : "Publish footer";
}

/** The question a publish asks: "Publish the header to 11 pages?". */
export function publishQuestion(area: RegionArea, reach: RegionReach): string {
  const pages = pagesPhrase(reach);
  return pages === undefined
    ? `Publish the ${areaWord(area)} to every page that shows it?`
    : `Publish the ${areaWord(area)} to ${pages}?`;
}

/** Done's question about unsaved changes: "Publish your header changes?". */
export function doneQuestion(area: RegionArea): string {
  return `Publish your ${areaWord(area)} changes?`;
}

/** Done's publishing answer: "Publish to 11 pages". */
export function publishToLabel(reach: RegionReach): string {
  const pages = pagesPhrase(reach);
  return pages === undefined ? "Publish to every page" : `Publish to ${pages}`;
}

/** Done's other answers, and a failed save's way on. */
export const SAVE_AS_DRAFT = "Save as draft";
export const DISCARD = "Discard";
export const KEEP_EDITING = "Keep editing";
export const TRY_AGAIN = "Try again";

/**
 * Said when someone else has the header open: "Ana Diaz is editing this
 * header. Try again when they're done."
 */
export function lockedBy(area: RegionArea, holder: string | null): string {
  return `${holder ?? "Someone"} is editing this ${areaWord(area)}. Try again when they're done.`;
}

/** Said when a save or publish of the header did not go through. */
export function saveFailed(
  area: RegionArea,
  intent: "save" | "publish",
  why: string | null
): string {
  const what =
    intent === "publish"
      ? `The ${areaWord(area)} wasn't published.`
      : `The ${areaWord(area)} wasn't saved.`;
  return why === null ? what : `${what} ${why}`;
}

/** Said when someone saved the header since it was opened here. */
export function savedElsewhere(
  area: RegionArea,
  by: string | null | undefined
): string {
  const who = by ?? "Someone";
  return `${who} saved this ${areaWord(area)} after you started editing it. Your changes are still here.`;
}

/** Said when the header could not be opened for editing. */
export function couldNotOpen(area: RegionArea): string {
  return `The ${areaWord(area)} couldn't be opened for editing.`;
}

/** Said after a header was saved as a draft or published from here. */
export function storedWords(
  area: RegionArea,
  intent: "save" | "publish"
): string {
  return intent === "publish"
    ? `The ${areaWord(area)} is published.`
    : `The ${areaWord(area)} is saved as a draft.`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
