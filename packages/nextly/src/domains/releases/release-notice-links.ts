/**
 * Where a release notice points, and who may see one: shared by every kind of
 * notice a release's owner is given, and by the email that copies one, so a
 * notice and its email always lead to the same page.
 *
 * @module domains/releases/release-notice-links
 * @experimental Until the notices feature is complete.
 */
import { container } from "../../di/container";
import { hasPermission } from "../../services/lib/permissions";
import type { VersionsDbApi } from "../versions/db-api";

import { RELEASES_TABLE } from "./release-tables";
import { RELEASES_RESOURCE } from "./releases-resource";

/** A release's page in the admin, as a path. @experimental */
export function releaseAdminPath(id: string): string {
  return `/admin/releases/${id}`;
}

/**
 * The releases that still exist, each with its page in the admin: one read for
 * a page of notices. A release deleted since has none, and its notice says so.
 *
 * @experimental
 */
export async function releaseNoticeLinks(
  ids: readonly string[]
): Promise<Map<string, string>> {
  if (ids.length === 0 || !container.has("adapter")) return new Map();
  const rows = await container
    .get<Pick<VersionsDbApi, "select">>("adapter")
    .select<{ id: string }>(RELEASES_TABLE, {
      columns: ["id"],
      where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
    });
  return new Map(rows.map(row => [row.id, releaseAdminPath(row.id)]));
}

/**
 * Whether a person may see release notices: a person who may no longer read
 * releases stops seeing them, as the releases themselves are hidden from them.
 *
 * @experimental
 */
export function mayReadReleaseNotices(userId: string): Promise<boolean> {
  return hasPermission(userId, "read", RELEASES_RESOURCE);
}
