/**
 * The claims a saved page holds: its address in each language while it is
 * published, and, when its document splits a list into pages, that list's
 * later pages (`<address>/page/*`) as one space; and whether a stored
 * document splits a list at all, which an entry's claims ask of the design
 * serving it.
 *
 * Pure, so a page's claims are one answer the save hook, the backfill and
 * the tests all ask.
 *
 * @module address-claims/page-claims
 */
import { mayPaginateList } from "@nextlyhq/blocks-engine";
import { previewUrlFromTemplate } from "@nextlyhq/plugin-sdk";
import { slugToStaticParam } from "@nextlyhq/plugin-sdk/routing";

import { asDocument } from "../component-store-source";

import { servedAddress, type ServedAddress } from "./claim-key";

/** What a page holds in the address store. */
export interface PageClaims {
  /** Its address, once per language. */
  readonly addresses: readonly ServedAddress[];
  /** Its list's later pages, once per language, keyed by the page's address. */
  readonly spaces: readonly ServedAddress[];
}

/** A page that holds nothing: a draft, unpublished, or with no address. */
const NONE: PageClaims = { addresses: [], spaces: [] };

/**
 * The claims of the page `data` describes, as a save leaves it, in each of
 * `locales`, at the address `pathTemplate` serves it at (the host's
 * `pagePreviewPath`, such as `/blocks/{slug}`), or at its slug's own path
 * where the host names none.
 *
 * Nothing while the save is held as a working draft (the live page keeps
 * what it holds), while the page is not published, or where its slug names
 * no address the route serves. The address is spelled from the route's own
 * reading of the slug (`slugToStaticParam`), each segment encoded as a
 * request carries it, so a stored `%61bout` is not taken for `about`.
 */
export function pageClaims(
  data: Readonly<Record<string, unknown>>,
  locales: readonly string[],
  pathTemplate?: string
): PageClaims {
  if (data._isWorkingDraft === true) return NONE;
  if (data.status !== "published") return NONE;
  const param = slugToStaticParam(data.slug);
  if (param === null) return NONE;
  // Where the host serves its pages, by the interpolation its preview and
  // the page search use, so a claim names the address a visitor requests.
  // The interpolation only reads the entry, so the read-only data passes as is.
  const path =
    pathTemplate === undefined
      ? `/${param.slug.map(encodeURIComponent).join("/")}`
      : previewUrlFromTemplate(pathTemplate, { pathFields: ["slug"] })(data);
  if (path === null) return NONE;
  const addresses = locales.flatMap(locale => {
    const address = servedAddress(locale, path);
    return address === null ? [] : [address];
  });
  return { addresses, spaces: splitsList(data.content) ? addresses : [] };
}

/**
 * Whether the stored document `content` (a page's, a collection's
 * template's or an entry's own design's) splits a list into pages, so the
 * document it serves holds its address's later pages (`<address>/page/*`).
 *
 * A list split into pages as stored, or by a value bound to the entry,
 * counts: a save cannot run the binding pass that settles a bound split, so
 * the later pages are held in case, which may refuse a document there but
 * never leaves two documents at one address. The one answer a page's claims
 * and an entry's claims ask of the design serving them.
 */
export function splitsList(content: unknown): boolean {
  const document = asDocument(content);
  return document !== null && mayPaginateList(document.nodes) !== undefined;
}

/**
 * The languages a page's address is held in: every language the site
 * serves, since a page is published in all of them at once, or the one it
 * serves without localization.
 */
export function claimLocales(
  locales: readonly string[],
  defaultLocale: string | undefined
): readonly string[] {
  if (locales.length > 0) return locales;
  return [
    defaultLocale !== undefined && defaultLocale !== "" ? defaultLocale : "en",
  ];
}
