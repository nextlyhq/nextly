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

  // Refused rather than resolved here, because THIS function cannot see the
  // base the value is joined under. A configured site URL may carry a path, and
  // the link builder appends the mount to it — so `..` resolved against the
  // origin gives one answer and resolved against `https://site.example/base`
  // gives another. Resolving it here would pick the first and the link would
  // use the second.
  //
  // A mount path names a route file, and a route file's path contains no `..`.
  // So the escape is a configuration fault rather than a spelling to normalise,
  // and refusing removes the divergence instead of choosing a side of it.
  if (hasParentSegment(route)) {
    throw NextlyError.invalidInput({
      message: `preview.route must not contain a ".." segment — got "${route}".`,
      logContext: {
        reason: "preview-route-has-a-parent-segment",
        remedy:
          "It names where the route file is mounted, which is a literal path. " +
          "A `..` resolves against whatever base the link is built on, and a " +
          "configured site URL carrying its own path is a different base from " +
          "the origin — so the mount would not be the one this value names.",
        route,
      },
    });
  }

  // The parser's pathname rather than the configured string: it is what the
  // link builder assigns, so percent-encoding and `.` segments are settled the
  // same way in both places.
  //
  // Trailing slashes are common in a hand-written config and would otherwise
  // produce `/preview/?token=...`, which is a different path on a site that
  // distinguishes them.
  return parsed.pathname.replace(/\/+$/, "") || "/";
}

/**
 * Whether the CONFIGURED value climbs out of wherever it is rooted.
 *
 * Read from the configured string rather than the parsed pathname, because the
 * parser has already resolved every `..` by the time it hands one back — a
 * check on `parsed.pathname` finds nothing and passes on every input, which is
 * a guard that reads as coverage and is satisfied by absence.
 *
 * Decoded first, since the parser resolves `%2E%2E` as a segment too, and
 * `\` alongside `/` because a special scheme normalises one to the other. The
 * raw form is checked as well, so a value the decoder rejects is still judged
 * on what it literally says.
 */
function hasParentSegment(route: string): boolean {
  const forms = [route];
  try {
    forms.push(decodeURIComponent(route));
  } catch {
    // An undecodable escape is not a `..`; `new URL` keeps it literal, and the
    // raw form above still answers for what is actually written.
  }
  return forms.some(form => form.split(/[/\\]/).includes(".."));
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
