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

import { attributedActorName } from "./history-story-attribution";

/** What history shows a version's author as. */
export function versionAuthorLabel(
  version: Pick<VersionMeta, "author" | "createdBy">
): string {
  const name = version.author?.name;
  // An agent that wrote the version for its author is named beside them,
  // through the one wording the history and Team activity share. Its name
  // outlives the author's, so a version an agent wrote still says so.
  const agentName = version.author?.agentName;
  if (agentName) {
    return attributedActorName(name || "someone not recorded", {
      agentName,
      actorIsKey: version.author?.kind === "apiKey",
    });
  }
  if (name) return name;
  return version.createdBy ? "Author unavailable" : "Author not recorded";
}
