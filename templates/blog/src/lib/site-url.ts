/**
 * Resolved public site URL used for absolute links in metadata,
 * sitemap, robots, RSS, and JSON-LD.
 *
 * Reads NEXT_PUBLIC_SITE_URL from the environment with a localhost
 * fallback. Centralized here so swapping origins for staging or
 * production is a one-line env change and every generated absolute
 * URL agrees.
 */

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Join a path onto SITE_URL without duplicating slashes.
 */
export function absoluteUrl(path = "/"): string {
  const base = SITE_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
