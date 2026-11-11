/**
 * The language a content route serves a request in: from the route's
 * `[locale]` segment where the route sits under one, otherwise the language
 * the route is configured to read in.
 *
 * @module runtime/routing/request-language
 */
import {
  languageAddressOf,
  languageOfSegment,
} from "../../domains/i18n/language-addresses";

/** The language a request is served in, and where it was read from. */
export interface RequestLanguage {
  /** The language read in; undefined where the route names none. */
  locale?: string;
  /**
   * Whether it came from a `[locale]` segment. Such a request is served at the
   * address the site's language rule forms (`/de/about`), so the address
   * handed on (a redirect, the page's head) carries the language as well.
   */
  fromSegment: boolean;
}

/** Waits for Nextly to start, as a route reading through it does. */
async function startedNextly(): Promise<unknown> {
  // Loaded when first asked: the start imports the routing modules, so a
  // static import here would be a cycle.
  const { requireNextlyOnceStarted } = await import("../../direct-api/nextly");
  return requireNextlyOnceStarted();
}

/**
 * The language of a request whose route params carry `segment` (the value of
 * `[locale]`, or undefined where the route has no such segment), or `null`
 * where the segment names none of the site's languages, which the route
 * answers as not found. The site's languages are read after `boot`, since a
 * route's reader may start Nextly on its first read; without one, once
 * Nextly has started.
 */
export async function requestLanguage(
  segment: unknown,
  configured: string | undefined,
  boot: () => Promise<unknown> = startedNextly
): Promise<RequestLanguage | null> {
  if (segment === undefined) {
    return {
      ...(configured === undefined ? {} : { locale: configured }),
      fromSegment: false,
    };
  }
  if (typeof segment !== "string") return null;
  await boot();
  const locale = await languageOfSegment(segment);
  return locale === undefined ? null : { locale, fromSegment: true };
}

/**
 * The address `path` is served at in `language`: as the site's language rule
 * forms it where the language came from the route's segment, and `path` as
 * it is where the route is mounted for one language by the site itself.
 */
export async function servedAddress(
  path: string,
  language: RequestLanguage
): Promise<string> {
  if (!language.fromSegment || language.locale === undefined) return path;
  const address = await languageAddressOf(path, language.locale);
  return address.status === "resolved" ? address.path : path;
}
