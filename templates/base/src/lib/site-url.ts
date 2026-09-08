/**
 * The origin this site's absolute URLs are built from.
 *
 * Absolute URLs are needed in places that leave the browser's context —
 * `metadataBase`, canonical links, Open Graph tags, the sitemap, RSS and
 * JSON-LD. A relative path is meaningless in all of them, so something has to
 * name the origin.
 *
 * ## Why two variables, in this order
 *
 * `NEXT_PUBLIC_SITE_URL` is where READERS find the site. `NEXT_PUBLIC_APP_URL`
 * is where the Nextly app itself lives — the admin, the API, the origin its
 * emails and preview links point at. They are usually the same host and are
 * not the same question: a headless setup serves its public pages from one
 * origin and runs the admin on another.
 *
 * So the public one wins when it is set, and the app's own origin is used when
 * it is not. That second step matters more than it looks: the generated `.env`
 * sets `NEXT_PUBLIC_APP_URL`, so without it a project that configured the only
 * URL it was given would still publish `localhost` canonicals and OG tags to
 * production — silently, because nothing about a wrong absolute URL fails at
 * build time.
 *
 * ## The development fallback reads the port it is actually served on
 *
 * Not a hardcoded 3000. Next assigns `process.env.PORT` to the port it ends up
 * listening on — after its own "port in use, using available port instead"
 * fallback — so this follows `next dev -p 4000`, and follows Next onto a
 * different port when 3000 is taken. A literal cannot do either, and the
 * failure is quiet: pages render while every absolute URL points somewhere
 * nothing is listening.
 *
 * `PORT` is a server-side value and is not inlined into client bundles, so a
 * client component importing this reads the plain default. That is the same
 * answer it would have had anyway, and client code should prefer
 * `window.location.origin`, which is exact.
 */
const DEV_PORT = process.env.PORT ?? "3000";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  `http://localhost:${DEV_PORT}`;

/**
 * Join a path onto {@link SITE_URL} without duplicating slashes.
 *
 * @param path - A root-relative path; a leading slash is optional
 * @returns The absolute URL
 */
export function absoluteUrl(path = "/"): string {
  const base = SITE_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
