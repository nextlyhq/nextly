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
import { beginStartupRequest } from "@admin/lib/api/startup-request";
import { collectionsListPath } from "@admin/services/collectionApi";
import { singlesListPath } from "@admin/services/singleApi";

/** The paths the startup request names, as the screens ask for them. */
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

/** Send the admin's startup request, once per page, in the browser. */
export function beginAdminStartup(): void {
  beginStartupRequest(BASE_URL, adminStartupPaths());
}
