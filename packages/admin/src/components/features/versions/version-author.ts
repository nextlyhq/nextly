/**
 * Who a version is credited to, as history shows it.
 *
 * A version written before authors were recorded, or by a write that carried no
 * person, has no author. It reads "Author not recorded": blank space would look
 * like a failed lookup, and "Unknown" would suggest someone nobody could
 * identify, when the truth is that nothing was recorded.
 *
 * @module components/features/versions/version-author
 */

import type { VersionMeta } from "@admin/services/versionApi";

/** What history shows a version's author as. */
export function versionAuthorLabel(
  version: Pick<VersionMeta, "author">
): string {
  return version.author?.name ?? "Author not recorded";
}
