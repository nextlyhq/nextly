import { getNextlyLogger } from "../observability/logger";
import { env } from "../shared/lib/env";

import { getPublicOrigin } from "./get-base-url";

/**
 * Media URL helpers
 *
 * Public-facing utilities for working with Media URLs in API responses:
 *
 *   - `normalizeMediaUrls(row)` — a row's URLs as stored: the local
 *     adapter's own base (`/uploads/...` by default) or a cloud adapter's
 *     absolute URL, with no `sizes`.
 *   - `toPublicMediaUrl(url)` — an absolute URL for a consumer outside the
 *     app, resolved against a public origin and never a guessed one.
 *
 * An item's image is its `url`, for `next/image` to resize on request, and
 * its `thumbnailUrl` for a small preview. Fixed image sizes are no longer
 * made, so nothing here picks one.
 */

// ────────────────────────────────────────────────────────────────────────────
// URLs as stored, and a public URL for a consumer outside the app
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return `true` when the URL is already absolute (`http(s)://`) or
 * protocol-relative (`//`), as cloud storage adapters write them.
 */
function isAbsoluteUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url);
}

/**
 * Prefix a relative media URL with `baseUrl`. Absolute and protocol-relative
 * URLs are returned unchanged; `null`, `undefined` and `""` pass through.
 */
export function toAbsoluteMediaUrl<T extends string | null | undefined>(
  url: T,
  baseUrl: string
): T {
  if (!url) return url;
  if (isAbsoluteUrl(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${baseUrl.replace(/\/+$/, "")}${path}` as T;
}

/**
 * A media URL for a consumer that hands it to something outside the app, an
 * email or a feed, where a path cannot resolve.
 *
 * The local storage adapter writes URLs on its own `baseUrl`, a path
 * (`/uploads/...`) by default, which every page of the app resolves on
 * whatever host serves it. Here a relative URL is resolved against the public
 * origin Nextly uses for the absolute links it sends: `options.baseUrl` (an
 * email's settings, or a site's own base), else `NEXT_PUBLIC_APP_URL`. A URL
 * already absolute, as cloud adapters write them, is returned unchanged.
 *
 * With neither set, nothing is guessed: in development the relative URL is
 * returned with a warning naming both settings, and in production, which
 * refuses to start without `NEXT_PUBLIC_APP_URL`, the error is logged and
 * `null` returned, so the consumer leaves the medium out rather than send a
 * path that cannot resolve.
 *
 * @experimental
 */
export function toPublicMediaUrl<T extends string | null | undefined>(
  url: T,
  options: { baseUrl?: string | null } = {}
): T | null {
  if (!url || isAbsoluteUrl(url)) return url;
  const origin = getPublicOrigin(options.baseUrl);
  if (origin) return toAbsoluteMediaUrl(url, origin);
  const payload = {
    message:
      "A media URL is relative and no public origin is set to make it absolute. Set the email settings' `baseUrl`, or `NEXT_PUBLIC_APP_URL`, to the address the app is served on.",
    url,
  };
  if (env.NODE_ENV === "production") {
    getNextlyLogger().error(payload);
    return null;
  }
  getNextlyLogger().warn(payload);
  return url;
}

/**
 * A media row without its `sizes`, as every API hands media back. Returns a
 * new object and does not mutate.
 *
 * Image sizes are no longer made or offered, but a row stored before then
 * still carries the column, in whichever form its dialect returns it, until
 * its files are removed. Only the code that removes stored files reads it.
 */
export function withoutStoredSizes<T extends { sizes?: unknown }>(
  row: T
): Omit<T, "sizes"> {
  const { sizes: _stored, ...rest } = row;
  return rest;
}

/**
 * A media row with its URLs as stored: the local adapter's own base followed
 * by the file's path, or a cloud adapter's absolute URL, and without its
 * `sizes` (`withoutStoredSizes`). Returns a new object and does not mutate.
 */
export function normalizeMediaUrls<
  T extends {
    url?: string | null;
    thumbnailUrl?: string | null;
    sizes?: unknown;
  },
>(row: T): Omit<T, "sizes"> {
  const read = withoutStoredSizes(row);
  if (typeof row.url === "string") read.url = fromSiteRoot(row.url);
  if (typeof row.thumbnailUrl === "string") {
    read.thumbnailUrl = fromSiteRoot(row.thumbnailUrl);
  }
  return read;
}

/**
 * A URL as a page reads it from the site's root. A local storage `baseUrl`
 * written without its leading slash (`uploads`) stores `uploads/<key>`,
 * which a page at `/admin/media` would resolve to `/admin/media/uploads/...`;
 * an absolute, protocol-relative or root-relative URL is returned unchanged.
 */
function fromSiteRoot(url: string): string {
  if (!url || isAbsoluteUrl(url) || url.startsWith("/")) return url;
  return `/${url}`;
}
