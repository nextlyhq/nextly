/**
 * Version rows record only the id of whoever wrote them. History surfaces show
 * a person, so the read path resolves those ids to display names here.
 *
 * The projection is deliberately narrower than a user read: a name, and no
 * email. Naming whoever edited a document the caller can already read stays
 * within what other surfaces already disclose, while an email address is a
 * stronger identifier that nothing on a history surface needs. Keeping it out
 * also means reading history does not require permission to read users, which
 * would otherwise lock editors out of their own document's history.
 *
 * @module domains/versions/author-hydration
 */

import { getService } from "../../di";

import type { VersionMeta } from "./versions-repository";

/** Display identity of whoever created a version. */
export interface VersionAuthor {
  id: string;
  name: string | null;
}

/** A version row carrying its resolved author, if one could be resolved. */
export type VersionMetaWithAuthor = VersionMeta & {
  author: VersionAuthor | null;
};

/**
 * Attach a display author to each row, resolving every distinct id in one
 * query.
 *
 * Attribution decorates a read the caller has already been granted, so every
 * failure mode degrades to `author: null` rather than propagating. A deleted
 * user, or an unavailable user table, must not cost the caller their history.
 */
export async function attachVersionAuthors(
  rows: VersionMeta[]
): Promise<VersionMetaWithAuthor[]> {
  const byId = await displayNamesById(rows.map(row => row.createdBy));

  return rows.map(row => ({
    ...row,
    author: row.createdBy ? (byId.get(row.createdBy) ?? null) : null,
  }));
}

/**
 * The display names of these people, in one query: an id and a name, and
 * nothing else.
 *
 * The one rule for naming a person on a read that has already been granted,
 * used by version history and by the release list's owners, so the two can
 * never name someone differently. Someone who cannot be named (deleted, with
 * whatever their account left erased, or a lookup that failed) is simply
 * absent: the caller shows them as unavailable rather than guessing.
 */
export async function displayNamesById(
  candidates: readonly (string | null | undefined)[]
): Promise<Map<string, VersionAuthor>> {
  const ids = [
    ...new Set(
      candidates.filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    ),
  ];
  const byId = new Map<string, VersionAuthor>();
  if (ids.length === 0) return byId;
  try {
    const users = getService("userService");
    for (const user of await users.listUsersByIds(ids)) {
      byId.set(user.id, { id: user.id, name: user.name });
    }
  } catch {
    // Leave the map empty: rows render unattributed rather than failing.
  }
  return byId;
}
