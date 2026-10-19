import { getNextlyLogger } from "../observability/logger";
import { env } from "../shared/lib/env";

import { getPublicOrigin } from "./get-base-url";

/**
 * Media variant helpers
 *
 * Public-facing utilities for working with Media URLs in API responses:
 *
 *   - `getMediaVariant(media, "card")` — pick a sized image variant URL
 *     from a Media record without cracking open the `sizes` JSON.
 *   - `normalizeMediaUrls(row)` — a row's URLs as stored: the local
 *     adapter's own base (`/uploads/...` by default) or a cloud adapter's
 *     absolute URL, with `sizes` parsed whatever the dialect.
 *   - `toPublicMediaUrl(url)` — an absolute URL for a consumer outside the
 *     app, resolved against a public origin and never a guessed one.
 *
 * Variant selection rules (in order):
 *   1. If `media.sizes[name]` exists, return its URL.
 *   2. If `media.sizes[fallbackName]` exists, return its URL (when caller
 *      passes one).
 *   3. If the asset isn't an image OR no sizes are present, fall back to
 *      `media.url` (the original).
 *
 * The shape of `media` here is intentionally narrow so the helper works
 * for both the full Media row and any subset that callers pass through
 * the API.
 */

export interface MediaLike {
  url: string;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  sizes?: Record<
    string,
    { url: string; width?: number; height?: number; filesize?: number }
  > | null;
}

export interface GetMediaVariantOptions {
  /**
   * If the requested `name` isn't present, try this name next. Useful for
   * progressive fallback: `getMediaVariant(m, "card", { fallback: "thumbnail" })`.
   */
  fallback?: string;
  /**
   * If true (default), fall through to `media.thumbnailUrl` when neither the
   * requested variant nor the fallback variant exists. Set false to skip
   * straight to `media.url`.
   */
  preferThumbnail?: boolean;
}

/**
 * Return the URL for a named image-size variant, or fall back to the
 * thumbnail / original URL.
 *
 * Returns `undefined` only when `media` is null/undefined. Otherwise always
 * returns a string URL.
 */
export function getMediaVariant(
  media: MediaLike | null | undefined,
  name: string,
  options: GetMediaVariantOptions = {}
): string | undefined {
  if (!media) return undefined;

  const { fallback, preferThumbnail = true } = options;
  const sizes = media.sizes ?? null;

  if (sizes) {
    const direct = sizes[name];
    if (direct?.url) return direct.url;

    if (fallback) {
      const fb = sizes[fallback];
      if (fb?.url) return fb.url;
    }
  }

  if (preferThumbnail && media.thumbnailUrl) return media.thumbnailUrl;

  return media.url;
}

/**
 * Convenience: pick the smallest available variant URL. Useful for grid
 * thumbnails where bandwidth matters more than which exact name is used.
 *
 * Walks the variants by `width * height` and returns the smallest. Falls
 * back to `thumbnailUrl` then `url`.
 */
export function getSmallestMediaVariant(
  media: MediaLike | null | undefined
): string | undefined {
  if (!media) return undefined;
  const sizes = media.sizes ?? null;

  if (sizes) {
    const entries = Object.values(sizes).filter(
      v => v?.url && v.width && v.height
    );
    if (entries.length > 0) {
      const smallest = entries.reduce((acc, cur) =>
        (cur.width ?? 0) * (cur.height ?? 0) <
        (acc.width ?? 0) * (acc.height ?? 0)
          ? cur
          : acc
      );
      return smallest.url;
    }
  }

  return media.thumbnailUrl ?? media.url;
}

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

type MediaSizes = Record<
  string,
  { url?: string | null; [key: string]: unknown }
> | null;

/**
 * Coerce whatever shape Drizzle returned for `media.sizes` into an object
 * (or null). PostgreSQL/MySQL store the column as `jsonb`/`json` and
 * return an object; SQLite stores it as TEXT and returns a JSON string —
 * neither `keysToCamelCase` nor the drizzle better-sqlite3 driver parse
 * it. Return null on absent / unparseable input so callers can branch
 * cleanly without re-implementing the dialect check.
 */
function normalizeSizes(value: unknown): MediaSizes {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as MediaSizes;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as MediaSizes;
      }
    } catch {
      // Unparseable JSON in the DB column — fall through to null.
    }
  }
  return null;
}

/**
 * A media row with its URLs as stored: the local adapter's own base followed
 * by the file's path, or a cloud adapter's absolute URL. Returns a new object
 * and does not mutate.
 *
 * Tolerates `sizes` arriving as a JSON-encoded string (SQLite) and normalises
 * it to an object, so API consumers see one shape whatever the dialect.
 */
export function normalizeMediaUrls<
  T extends {
    url?: string | null;
    thumbnailUrl?: string | null;
    sizes?: MediaSizes | string;
  },
>(row: T): T {
  const read: T = { ...row };
  if (typeof row.url === "string") read.url = fromSiteRoot(row.url);
  if (typeof row.thumbnailUrl === "string") {
    read.thumbnailUrl = fromSiteRoot(row.thumbnailUrl);
  }
  if (!("sizes" in row)) return read;
  const sizes = normalizeSizes(row.sizes);
  return {
    ...read,
    sizes: sizes
      ? Object.fromEntries(
          Object.entries(sizes).map(([name, variant]) => [
            name,
            typeof variant?.url === "string"
              ? { ...variant, url: fromSiteRoot(variant.url) }
              : variant,
          ])
        )
      : sizes,
  };
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
