/**
 * The locks a write to a document's history takes, so it is ordered against
 * the deletions that sweep that history: the entity's registry row, the
 * document's own row, and the person's account row.
 *
 * One home for them, so every history write (a version pin, a "last looked
 * at" marker) takes the same locks in the same order as the deletions do.
 *
 * @module domains/versions/history-locks
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { VersionScopeKind } from "../../schemas/versions/types";

import type { VersionRef } from "./versions-repository";

/**
 * Where each kind of entity is registered. A page has no registry row to lock
 * here, so its history cannot be written yet: a write on one is refused as a
 * document that does not exist.
 */
export const REGISTRY_TABLES: Partial<Record<VersionScopeKind, string>> = {
  collection: "dynamic_collections",
  single: "dynamic_singles",
};

/**
 * The document's table, from a locking read of the entity's registry row on
 * the caller's transaction, so its row can be locked the way a save locks it.
 * Null when the collection or Single itself is gone.
 *
 * Locking the registry row is what orders a write to the entity's history (a
 * pin, a "last looked at" marker) against the entity's deletion, which removes
 * that row and then sweeps the history in one transaction: the write either
 * commits first and is swept, or waits and finds the entity gone.
 */
export async function documentTableName(
  tx: TransactionContext,
  ref: VersionRef
): Promise<string | null> {
  const registry = REGISTRY_TABLES[ref.scopeKind];
  if (registry === undefined) return null;
  const entity = await tx.selectOne<{ tableName: string }>(registry, {
    columns: ["tableName"],
    where: {
      and: [{ column: "slug", op: "=" as const, value: ref.scopeSlug }],
    },
    forUpdate: true,
  });
  return entity ? entity.tableName : null;
}

/**
 * Take the document's write lock, the lock every save and delete of it
 * holds, and say whether the document still exists.
 *
 * One locking read rather than a lock and then a read: on MySQL a plain read
 * returns the transaction's snapshot, which can still hold a row a delete
 * committed while this waited for the lock; a locking read sees the latest
 * committed row on every dialect.
 */
export async function lockDocument(
  tx: TransactionContext,
  ref: VersionRef
): Promise<boolean> {
  const tableName = await documentTableName(tx, ref);
  if (tableName === null) return false;
  const row = await tx.selectOne<{ id: string }>(tableName, {
    columns: ["id"],
    where: {
      and: [{ column: "id", op: "=" as const, value: ref.entryId }],
    },
    forUpdate: true,
  });
  return row !== null;
}

/**
 * Lock a person's account row, the row account deletion locks before it erases
 * what the person owns, and say whether the account still exists. A write of
 * something the person owns (their marker) then either commits before the
 * deletion and is erased with the account, or waits and finds it gone.
 */
export async function lockPerson(
  tx: TransactionContext,
  userId: string
): Promise<boolean> {
  const row = await tx.selectOne<{ id: string }>("users", {
    columns: ["id"],
    where: { and: [{ column: "id", op: "=" as const, value: userId }] },
    forUpdate: true,
  });
  return row !== null;
}
