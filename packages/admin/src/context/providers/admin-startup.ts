/**
 * What the admin's startup request asks for: the GETs every screen of a
 * fresh tab makes before its own data, each spelled exactly as the code that
 * makes it spells it, so each takes its answer from the startup request.
 *
 * Counts and the schema journal are left out: they are polled on their own
 * schedule, and a count is the kind of slow read a startup request must not
 * wait on. A plugin page adds the reads it declares it makes as it opens,
 * where it is the page a tab opens on (`startupPathsForPage`).
 *
 * @module context/providers/admin-startup
 */

import {
  ADMIN_STARTUP_SCREENS_ELEMENT_ID,
  MAX_STARTUP_PATHS,
} from "nextly/config";

import { NAV_COLLECTIONS_PARAMS } from "@admin/hooks/queries/useCollections";
import { NAV_SINGLES_PARAMS } from "@admin/hooks/queries/useSingles";
import { BASE_URL } from "@admin/lib/api/fetcher";
import {
  beginStartupRequest,
  startupResponseHeaders,
} from "@admin/lib/api/startup-request";
import { applyServerSwitch } from "@admin/lib/device-memory/server-answer";
import { collectionsListPath } from "@admin/services/collectionApi";
import { singlesListPath } from "@admin/services/singleApi";

/**
 * The paths every screen needs first, as the screens ask for them. The one
 * list: the admin sends it, and the prebuilt page's script sends what this
 * returned when the page was built (`AdminStartupScript`).
 */
export function adminStartupPaths(): string[] {
  return [
    "/auth/setup-status",
    "/auth/session",
    "/admin-meta",
    "/admin-meta/workspace",
    "/me",
    "/me/permissions",
    "/me/capabilities",
    "/general-settings",
    collectionsListPath(NAV_COLLECTIONS_PARAMS),
    singlesListPath(NAV_SINGLES_PARAMS),
  ];
}

/**
 * The paths the startup request names for the page at `pathname`: `common`,
 * what every screen needs first, then the reads the page declares, where it
 * is a plugin page that declares any, at most `max` in all. `screensJson` is
 * what the admin layout writes into the page (`adminStartupScreensJson`),
 * whose `reads` are each plugin page's address and the paths it reads. An
 * address no page declares reads for, or a page without them, gets `common`
 * alone.
 *
 * The page is named from the admin's own segment on (`/admin/...`), so a
 * prefix in front of it changes nothing, and without a trailing slash.
 *
 * One implementation for the admin and the page's script, which runs its
 * source text before any of the admin's code has loaded: so it is kept free
 * of closures and imports, and nothing it does can throw.
 */
export function startupPathsForPage(
  pathname: string,
  common: readonly string[],
  screensJson: string | null,
  max: number
): string[] {
  const paths = common.slice(0, max);
  let screens: unknown = null;
  try {
    screens = screensJson === null ? null : JSON.parse(screensJson);
  } catch {
    screens = null;
  }
  if (typeof screens !== "object" || screens === null) return paths;
  // The pages' reads, beside what else the page says of its screens.
  screens = (screens as { reads?: unknown }).reads;
  if (typeof screens !== "object" || screens === null) return paths;
  let address = pathname;
  try {
    address = decodeURI(pathname);
  } catch {
    address = pathname;
  }
  const at = (address + "/").indexOf("/admin/");
  address = (at === -1 ? address : address.slice(at)).replace(/\/+$/, "");
  const declared: unknown = Object.prototype.hasOwnProperty.call(
    screens,
    address
  )
    ? (screens as Record<string, unknown>)[address]
    : null;
  if (!Array.isArray(declared)) return paths;
  for (const path of declared) {
    if (paths.length >= max) break;
    if (typeof path === "string" && paths.indexOf(path) === -1) {
      paths.push(path);
    }
  }
  return paths;
}

/** The plugin pages' startup reads the admin layout wrote into the page. */
function startupScreensJson(): string | null {
  return (
    document.getElementById(ADMIN_STARTUP_SCREENS_ELEMENT_ID)?.textContent ??
    null
  );
}

/**
 * Send the admin's startup request, once per page, in the browser; or take
 * the one the page's script already sent.
 */
export function beginAdminStartup(): void {
  if (typeof window === "undefined") return;
  beginStartupRequest(
    BASE_URL,
    startupPathsForPage(
      window.location.pathname,
      adminStartupPaths(),
      startupScreensJson(),
      MAX_STARTUP_PATHS
    )
  );
  // Its answer says whether the site lets the admin remember anything on this
  // device; off removes what was kept, on the sign-in page as on any other.
  void startupResponseHeaders().then(headers => {
    if (headers !== null) applyServerSwitch(headers);
  });
}
