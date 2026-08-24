/**
 * Where this application mounts the preview route.
 *
 * The mount is a route file inside the application, so nothing outside it can
 * see where that file is. The admin previously assumed the default and printed
 * a URL built from it, which meant an application that mounted the route
 * anywhere else handed its reviewers a link that answered 404 with nothing to
 * explain it. Declaring the path here lets the server — which can see both this
 * and the configured site URL — assemble the link once, and lets a wrong value
 * fail at boot rather than at share time.
 *
 * @module domains/preview/route-config
 */

import { NextlyError } from "../../errors/nextly-error";

/** Draft-preview wiring. */
export interface PreviewConfig {
  /**
   * Where this application mounts `createPreviewRoute`.
   *
   * A mount PATH: site-relative, and carrying no query or fragment of its own,
   * because the link's `token` parameter is appended to it. Validated as such
   * when the configuration is read. Defaults to `/api/preview`, which is where
   * the scaffold puts the route file.
   *
   * @default "/api/preview"
   */
  route?: string;
}

/** Where the scaffold mounts the preview route. */
export const DEFAULT_PREVIEW_ROUTE = "/api/preview";

/**
 * The configured mount, normalised, or a throw naming the remedy.
 *
 * The parser decides whether a value can leave this origin, rather than a list
 * of spellings kept by hand: `//host`, `/\host` and `/\\host` all reach another
 * origin, because a special scheme normalises a backslash to a slash. Asking
 * the parser the browser will use is the only check that cannot fall behind
 * that list.
 *
 * The base is a sentinel that appears in no output. Anything still pointing at
 * it after resolution stayed on the current origin; anything that moved away
 * named a host.
 */
const RESOLUTION_BASE = "https://preview.invalid";

export function resolvePreviewRoute(config: PreviewConfig | undefined): string {
  const route = config?.route ?? DEFAULT_PREVIEW_ROUTE;
  const parsed = parseSiteRelative(route);

  if (parsed === null) {
    // `invalidInput` rather than `validation`: this is one malformed
    // configuration value at boot, not a set of field errors from a request,
    // and the message is what an operator reads to fix their config.
    throw NextlyError.invalidInput({
      message: `preview.route must be site-relative and start with a single "/" — got "${route}".`,
      logContext: {
        reason: "preview-route-not-site-relative",
        remedy:
          "It names a path inside this application, not a URL on another " +
          'host. A protocol-relative "//host" is a URL to another origin ' +
          "wearing a path's clothes, which is why a leading slash alone is " +
          "not the test.",
        route,
      },
    });
  }

  // Refused rather than dropped. The link builder assigns this value as a
  // PATHNAME, where a `?` is percent-encoded rather than starting a query — so
  // `/api/preview?tenant=a` is handed out as `/api/preview%3Ftenant=a`, which
  // reaches no route and carries no token. Dropping the query silently would
  // hide the same mistake behind a link that happens to work, leaving the
  // operator believing a parameter is being sent that never is.
  if (parsed.search !== "" || parsed.hash !== "") {
    throw NextlyError.invalidInput({
      message: `preview.route must be a path with no query or fragment — got "${route}".`,
      logContext: {
        reason: "preview-route-carries-a-query-or-fragment",
        remedy:
          "It names where the route file is mounted, and the link's own " +
          "`token` parameter is appended to it. A mount path that carries " +
          "one of its own has nowhere to put it.",
        route,
      },
    });
  }

  // The parser's pathname rather than the configured string, because the link
  // builder assigns it as a pathname and that resolution happens there anyway:
  // a configured `/api/../evil` would otherwise be reported as one path and
  // linked as another.
  //
  // Trailing slashes are common in a hand-written config and would otherwise
  // produce `/preview/?token=...`, which is a different path on a site that
  // distinguishes them.
  return parsed.pathname.replace(/\/+$/, "") || "/";
}

/**
 * The route as the browser's parser sees it, or `null` if it leaves this origin.
 *
 * The caller needs the parsed URL rather than a verdict, because the query, the
 * fragment and the resolved pathname are all read from it — parsing twice would
 * let the check and the value it vouches for drift apart.
 */
function parseSiteRelative(route: string): URL | null {
  if (!route.startsWith("/")) return null;
  try {
    const parsed = new URL(route, RESOLUTION_BASE);
    return parsed.origin === RESOLUTION_BASE ? parsed : null;
  } catch {
    return null;
  }
}
