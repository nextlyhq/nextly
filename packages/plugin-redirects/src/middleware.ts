/**
 * Next.js middleware helper for `@nextlyhq/plugin-redirects` — the
 * `@nextlyhq/plugin-redirects/middleware` entry.
 *
 * Plugin routes are namespaced, so transparent root-path redirects live in the
 * APP, not the plugin (same model as Payload's plugin-redirects). Drop this into
 * your `middleware.ts`: it looks up the incoming path against the plugin's
 * lookup route and issues a 301/302 when there's a match, otherwise passes
 * through. Best-effort — a lookup failure never breaks the request.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { createRedirectsMiddleware } from "@nextlyhq/plugin-redirects/middleware";
 * export const middleware = createRedirectsMiddleware();
 * export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
 * ```
 */
import { NextResponse, type NextRequest } from "next/server";

const LOOKUP_PATH = "/api/plugins/@nextlyhq/plugin-redirects/lookup";

export interface RedirectsMiddlewareOptions {
  /**
   * Base URL of the Nextly app serving the plugin route. Defaults to the
   * incoming request's origin (correct for single-origin apps).
   */
  baseUrl?: string;
  /** Seconds to cache the lookup response (Next fetch revalidate; default 60). */
  revalidate?: number;
}

/** Create a Next.js middleware that applies plugin-managed redirects. */
export function createRedirectsMiddleware(
  opts: RedirectsMiddlewareOptions = {}
) {
  const revalidate = opts.revalidate ?? 60;

  return async function redirectsMiddleware(
    request: NextRequest
  ): Promise<NextResponse> {
    const base = opts.baseUrl ?? request.nextUrl.origin;
    const from = request.nextUrl.pathname;

    try {
      // `next.revalidate` is a Next.js fetch extension (not in the DOM
      // RequestInit type) — declare it on a typed init so it stays type-clean.
      const init: RequestInit & { next?: { revalidate?: number } } = {
        next: { revalidate },
      };
      const res = await fetch(
        `${base}${LOOKUP_PATH}?from=${encodeURIComponent(from)}`,
        init
      );
      if (res.ok) {
        const match = (await res.json()) as {
          to?: string;
          type?: string;
        } | null;
        if (match?.to) {
          const status = match.type === "302" ? 302 : 301;
          return NextResponse.redirect(new URL(match.to, base), status);
        }
      }
    } catch {
      // Best-effort: never break the request pipeline on a lookup failure.
    }

    return NextResponse.next();
  };
}
