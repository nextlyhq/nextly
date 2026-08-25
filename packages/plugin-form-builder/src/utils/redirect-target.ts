/**
 * Where a form sends the visitor after a successful submission, when the
 * author picked a PAGE rather than typing a URL.
 *
 * The plugin cannot derive this. A site's URL structure belongs to the site:
 * the playground serves the `pages` collection at `/{slug}` from its own
 * catch-all route, and another app may serve the same collection under
 * `/blog/{slug}` or behind a locale segment. Nothing inside a CMS package can
 * read that decision off the collection, so the mapping is configuration.
 *
 * A pattern covers the common case and a function covers the rest — a path
 * that depends on a parent document, a locale, or anything else the site
 * knows and this package does not.
 *
 * The pattern syntax is not invented here. `previewUrlFromTemplate` already
 * turns a `{field}` path into a URL for preview links, for the same reason and
 * with the same constraint, so this uses it rather than substituting
 * alongside it: two rules that agree today would drift, and a wrong URL still
 * looks like a URL. Encoding and the treatment of `0` and `false` come with
 * it.
 */
import { previewUrlFromTemplate } from "nextly/config";

import type { RedirectTargetDocument } from "./redirect-reference";

export type { RedirectTargetDocument } from "./redirect-reference";
export {
  parseRedirectReference,
  type RedirectReference,
} from "./redirect-reference";

/**
 * How documents in one collection become URLs.
 *
 * A string is a path with `{field}` placeholders filled from the document.
 * A function receives the document and returns the path itself.
 */
export type RedirectUrlPattern =
  | string
  | ((document: RedirectTargetDocument) => string | undefined);

/** The collection-to-pattern map, after the array shorthand is normalised. */
export type RedirectRelationships = Record<string, RedirectUrlPattern>;

/**
 * The pattern assumed for the `string[]` shorthand.
 *
 * `redirectRelationships: ["pages"]` means "pages are redirect targets" and
 * says nothing about their URLs, so it needs a default. This one matches the
 * routing the page builder ships and the scaffold templates generate.
 */
export const DEFAULT_REDIRECT_PATTERN = "/{slug}";

/**
 * Both accepted spellings of the option reduced to the map.
 *
 * Normalised at the edge so everything downstream reads ONE shape — including
 * the list of collections, which is `Object.keys` of this rather than a second
 * field that agrees with it today.
 */
export function normalizeRedirectRelationships(
  option: string[] | RedirectRelationships | undefined
): RedirectRelationships {
  if (!option) return {};
  const entries = Array.isArray(option)
    ? option.map(collection => [collection, DEFAULT_REDIRECT_PATTERN] as const)
    : Object.entries(option);

  // An empty pattern is dropped rather than kept, so that being OFFERED as a
  // redirect target and being able to PRODUCE a URL are one decision. Kept,
  // the collection appears in the picker, validation accepts a reference into
  // it, and every submission then resolves to nothing — a form that passes
  // every check and sends nobody anywhere.
  return Object.fromEntries(
    entries.filter(([, pattern]) => typeof pattern !== "string" || pattern)
  );
}

/**
 * The pattern applied to a document, or undefined when it cannot be.
 *
 * Undefined rather than a partial string: a placeholder whose field is empty
 * would otherwise produce `/undefined` or `/`, and a form that sends every
 * visitor to a broken URL is worse than one that sends them nowhere. The
 * caller reports the difference.
 */
export function applyRedirectPattern(
  pattern: RedirectUrlPattern,
  document: RedirectTargetDocument
): string | undefined {
  if (typeof pattern === "function") {
    const produced = pattern(document);
    return produced ? produced : undefined;
  }
  return previewUrlFromTemplate(pattern)(document) ?? undefined;
}
