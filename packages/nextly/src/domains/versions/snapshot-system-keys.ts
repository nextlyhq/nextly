/**
 * The framework-managed keys at the top of a version snapshot.
 *
 * They describe the document's record (its id, timestamps, author and
 * lifecycle state), never what an editor wrote. A comparison of two versions
 * and the question "did this save change anything" both leave them out, so they
 * are named once here rather than listed by each.
 *
 * @module domains/versions/snapshot-system-keys
 */

import type { SystemColumnEntity } from "../../lib/system-columns";

const SHARED_KEYS = ["id", "createdAt", "updatedAt", "status"];

const KEYS_BY_ENTITY: Readonly<
  Record<SystemColumnEntity, ReadonlySet<string>>
> = {
  // A collection's owner column. A Single has none, so a field a Single
  // declares under that name is content like any other.
  collection: new Set([...SHARED_KEYS, "createdBy"]),
  single: new Set(SHARED_KEYS),
};

/** Keys on a top-level document of this kind that are never user content. */
export function documentSystemKeys(
  entity: SystemColumnEntity
): ReadonlySet<string> {
  return KEYS_BY_ENTITY[entity];
}
