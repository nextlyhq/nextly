/**
 * What the problem list's server and the admin's screens agree on: the kinds
 * of problem, the words each kind is explained with, where each is fixed,
 * and the shape the list's routes answer with. Plain data only, and no
 * imports, so the admin's client bundle and any other screen reading the
 * list (a page's SEO tab) take it without bringing server code along.
 *
 * @module problems/contract
 */

/** Where the list is read, under the plugin's routes. */
export const PROBLEMS_ROUTE_PATH = "/problems";

/** Where a person asks for the whole site to be checked again. */
export const PROBLEMS_CHECK_ROUTE_PATH = "/problems/check";

/** How old the last full check may be before opening the list rechecks the site. */
export const FULL_CHECK_MAX_AGE_MS: number = 24 * 60 * 60 * 1000;

/** About as many characters of a title as Google shows. */
export const TITLE_LIMIT = 60;

/** About as many characters of a description as Google shows. */
export const DESCRIPTION_LIMIT = 160;

/** Every kind of problem the list checks for. */
export type ProblemKind =
  | "productionAddress"
  | "noAddress"
  | "noTitle"
  | "noDescription"
  | "sharedTitle"
  | "sharedDescription"
  | "longTitle"
  | "longDescription"
  | "canonical"
  | "brokenLink"
  | "shareImage"
  | "imageAlt"
  | "structuredData";

/**
 * The order the list draws its groups in: what keeps the whole site or a
 * whole type out of search first, then what changes how a page shows.
 */
export const KIND_ORDER: readonly ProblemKind[] = [
  "productionAddress",
  "noAddress",
  "noTitle",
  "sharedTitle",
  "canonical",
  "brokenLink",
  "noDescription",
  "sharedDescription",
  "longTitle",
  "longDescription",
  "shareImage",
  "imageAlt",
  "structuredData",
];

/**
 * What a problem is about: a page, by its content type's key (the
 * collection's slug, or `single:<slug>`) and id, or for a site-wide problem
 * the thing it names (a content type, the whole site).
 */
export interface ProblemSubject {
  /** The content type's key, where the subject is a page or a type. */
  type?: string;
  /** The page's id, where the subject is a page. */
  id?: string;
  /** What the list calls it: the page's title, or the type's name. */
  label: string;
  /** The page's address, or a line saying what else it is (`3 entries`). */
  detail?: string;
}

/** What a problem of the whole site is about. */
export const WHOLE_SITE: ProblemSubject = { label: "Whole site" };

/** The SEO settings' tabs a fix can land on. */
export type SettingsTab = "general" | "content-types" | "brand";

/**
 * Where a problem is fixed:
 *
 * - `page`: the page's own editor, on its SEO tab or its content, at a field;
 * - `settings`: the SEO settings, on a tab;
 * - `media`: the media library, where an image's alt text is kept;
 * - `developer`: code, so the list hands over a note to copy for a developer.
 */
export type ProblemFix =
  | { place: "page"; tab: "seo" | "content"; field?: string }
  | { place: "settings"; tab: SettingsTab }
  | { place: "media" }
  | { place: "developer"; note: string };

/** One problem, as the list draws it. */
export interface Problem {
  kind: ProblemKind;
  subject: ProblemSubject;
  /** What is wrong here, in one plain sentence or less. */
  what: string;
  /** The fix's button text, which says what it does: `Change the title`. */
  action: string;
  fix: ProblemFix;
}

/** What the list's routes answer. */
export interface ProblemListBody {
  problems: Problem[];
  /** When the whole site was last checked, as ISO text; absent before the first. */
  checkedAt?: string;
  /** How many pages the last full check read. */
  pagesChecked: number;
  /**
   * A change since the last full check can have altered another page's
   * result, such as a removal, a new address or a changed title.
   */
  outOfDate: boolean;
  /** The last full check is over a day old, or there has been none. */
  due: boolean;
}
