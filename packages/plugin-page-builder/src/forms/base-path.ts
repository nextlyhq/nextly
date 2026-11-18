/**
 * The app's base path, which every address a visitor's browser uses begins
 * with (`basePath: "/site"` serves the page `/contact` at `/site/contact`).
 * Next.js builds it into every bundle as `process.env.__NEXT_ROUTER_BASEPATH`;
 * `""` for an app served at its root. Read on each call, never kept, so one
 * process answers as its app is served.
 *
 * @module forms/base-path
 */

/** The app's base path without a trailing slash, or `""`. */
function appBasePath(): string {
  return (process.env.__NEXT_ROUTER_BASEPATH ?? "").replace(/\/+$/, "");
}

/**
 * `path`, one of the app's own (`/contact`), as a browser reaches it: under
 * the app's base path. Any other address, such as another site's, is
 * returned as it was written.
 */
export function servedUnderBase(path: string): string {
  return path.startsWith("/") && !path.startsWith("//")
    ? `${appBasePath()}${path}`
    : path;
}
