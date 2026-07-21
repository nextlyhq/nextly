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
  const ids = [
    ...new Set(
      rows
        .map(row => row.createdBy)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];

  const byId = new Map<string, VersionAuthor>();

  if (ids.length > 0) {
    try {
      const users = getService("userService");
      for (const user of await users.listUsersByIds(ids)) {
        byId.set(user.id, { id: user.id, name: user.name });
      }
    } catch {
      // Leave the map empty: rows render unattributed rather than failing.
    }
  }

  return rows.map(row => ({
    ...row,
    author: row.createdBy ? (byId.get(row.createdBy) ?? null) : null,
  }));
}
