/**
 * How search results may show a page: Google's display controls from the
 * robots meta tag page
 * (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).
 *
 * The site asks for large image previews on every listed page unless its
 * settings switch that off; each page may choose its own image preview size,
 * a shorter text under its link or none, keep its pictures out of image
 * search, name a date after which it leaves search, and switch on
 * `noarchive` and `nocache` for other search engines. Nothing else turns
 * either of those two on.
 *
 * Pure and free of Node, so the SEO tab works the page's display out with
 * the same functions the page's head is served from.
 *
 * @module resolver/display
 */
import type { PageImagePreview, PageRobots } from "@nextlyhq/plugin-sdk";

/** Google's image preview sizes, as a person chooses them. */
export const IMAGE_PREVIEW_SIZES: readonly PageImagePreview[] = [
  "large",
  "standard",
  "none",
];

/** What a person chose for the page's display in its `seo` group. */
export interface TypedDisplay {
  imagePreview?: PageImagePreview;
  /** The most characters of text under the link: a whole number above 0. */
  maxSnippet?: number;
  nosnippet?: true;
  noimageindex?: true;
  /** When the page leaves search, as ISO 8601. */
  unavailableAfter?: string;
  noarchive?: true;
  nocache?: true;
}

/** The page's display, as its answer carries it. */
export interface SearchDisplay {
  /** The image preview size asked for, and whether the page or site chose it. */
  imagePreview?: { value: PageImagePreview; from: "page" | "site" };
  maxSnippet?: number;
  nosnippet?: true;
  noimageindex?: true;
  /** The date the page leaves search, and whether it has passed. */
  unavailableAfter?: { value: string; passed: boolean };
  noarchive?: true;
  nocache?: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored date as ISO 8601, where it names a moment. */
function momentOf(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : new Date(at).toISOString();
}

/**
 * The display a page's `seo` group asks for. A value Google could not read
 * as asked, such as a size with no name or a snippet of no characters, is
 * read as nothing chosen: 0 characters would hide the text without the
 * words that say what that costs, which only "no snippet" carries.
 */
export function typedDisplay(seo: unknown): TypedDisplay {
  const group = isRecord(seo) ? seo : {};
  const display: TypedDisplay = {};
  const size = group.maxImagePreview;
  if ((IMAGE_PREVIEW_SIZES as readonly unknown[]).includes(size)) {
    display.imagePreview = size as PageImagePreview;
  }
  const snippet = group.maxSnippet;
  if (typeof snippet === "number" && Number.isInteger(snippet) && snippet > 0) {
    display.maxSnippet = snippet;
  }
  if (group.nosnippet === true) display.nosnippet = true;
  if (group.noimageindex === true) display.noimageindex = true;
  const after = momentOf(group.unavailableAfter);
  if (after !== undefined) display.unavailableAfter = after;
  if (group.noarchive === true) display.noarchive = true;
  if (group.nocache === true) display.nocache = true;
  return display;
}

/**
 * The page's display from what it chose and the site's default for image
 * previews (on unless `false`), with whether its date to leave search has
 * passed at `now`.
 */
export function searchDisplay(
  page: TypedDisplay,
  largeImagePreviews: boolean | undefined,
  now: number
): SearchDisplay {
  const display: SearchDisplay = {};
  if (page.imagePreview !== undefined) {
    display.imagePreview = { value: page.imagePreview, from: "page" };
  } else if (largeImagePreviews !== false) {
    display.imagePreview = { value: "large", from: "site" };
  }
  // No snippet hides the text whatever its length, so a limit beside it
  // says nothing more.
  if (page.nosnippet === true) display.nosnippet = true;
  else if (page.maxSnippet !== undefined) display.maxSnippet = page.maxSnippet;
  if (page.noimageindex === true) display.noimageindex = true;
  if (page.unavailableAfter !== undefined) {
    display.unavailableAfter = {
      value: page.unavailableAfter,
      passed: Date.parse(page.unavailableAfter) <= now,
    };
  }
  if (page.noarchive === true) display.noarchive = true;
  if (page.nocache === true) display.nocache = true;
  return display;
}

/**
 * The robots directives a listed page's display adds to its head, each under
 * the answer's name for it. A page kept out of search is served none: they
 * say how it shows in results it is not in.
 */
export function displayDirectives(
  display: SearchDisplay
): Omit<PageRobots, "index" | "follow"> {
  return {
    ...(display.imagePreview === undefined
      ? {}
      : { maxImagePreview: display.imagePreview.value }),
    ...(display.maxSnippet === undefined
      ? {}
      : { maxSnippet: display.maxSnippet }),
    ...(display.nosnippet ? { nosnippet: true } : {}),
    ...(display.noimageindex ? { noimageindex: true } : {}),
    ...(display.unavailableAfter === undefined
      ? {}
      : { unavailableAfter: display.unavailableAfter.value }),
    ...(display.noarchive ? { noarchive: true } : {}),
    ...(display.nocache ? { nocache: true } : {}),
  };
}
