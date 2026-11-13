/**
 * What the admin's startup request asks for: the GETs every screen of a
 * fresh tab makes before its own data, each spelled exactly as the code that
 * makes it spells it, so each takes its answer from the startup request.
 *
 * Counts and the schema journal are left out: they are polled on their own
 * schedule, and a count is the kind of slow read a startup request must not
 * wait on.
 *
 * @module context/providers/admin-startup
 */

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
 * The paths the startup request names, as the screens ask for them. The one
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
 * Send the admin's startup request, once per page, in the browser; or take
 * the one the page's script already sent.
 */
export function beginAdminStartup(): void {
  beginStartupRequest(BASE_URL, adminStartupPaths());
  // Its answer says whether the site lets the admin remember anything on this
  // device; off removes what was kept, on the sign-in page as on any other.
  void startupResponseHeaders().then(headers => {
    if (headers !== null) applyServerSwitch(headers);
  });
}
