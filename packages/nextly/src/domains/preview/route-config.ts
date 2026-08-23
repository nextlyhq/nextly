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
   * Site-relative, and validated as such. Defaults to `/api/preview`, which is
   * where the scaffold puts the route file.
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

  if (!route.startsWith("/") || !isSameOrigin(route)) {
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

  // Trailing slashes are common in a hand-written config and would otherwise
  // produce `/preview/?token=...`, which is a different path on a site that
  // distinguishes them.
  return route.replace(/\/+$/, "") || "/";
}

function isSameOrigin(route: string): boolean {
  try {
    return new URL(route, RESOLUTION_BASE).origin === RESOLUTION_BASE;
  } catch {
    return false;
  }
}
