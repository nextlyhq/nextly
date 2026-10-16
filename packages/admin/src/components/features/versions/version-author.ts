/**
 * Who a version is credited to, as history shows it.
 *
 * Two different absences, told apart:
 * - nothing was recorded (a version written before authors were recorded, or by
 *   a write that carried no person): "Author not recorded";
 * - an author was recorded but cannot be named now (the user has been deleted,
 *   or the lookup failed): "Author unavailable".
 *
 * Neither guesses a name, and neither is left blank, which would look like a
 * failed lookup in both cases.
 *
 * @module components/features/versions/version-author
 */

import type { VersionMeta } from "@admin/services/versionApi";

/** What history shows a version's author as. */
export function versionAuthorLabel(
  version: Pick<VersionMeta, "author" | "createdBy">
): string {
  const name = version.author?.name;
  if (name) return name;
  return version.createdBy ? "Author unavailable" : "Author not recorded";
}
