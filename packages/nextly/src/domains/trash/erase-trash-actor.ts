/**
 * Erase a staff account from the trash's record of who trashed what: on the
 * account deletion's own transaction, each record it trashed keeps that a
 * person did (`trashed_by_kind` "user") but no longer their id or name.
 *
 * The person-owned rows a record keeps inside its stored item (pins,
 * markers, recovery points) need nothing here: a restore puts those back
 * only for people still there.
 *
 * @module domains/trash/erase-trash-actor
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, type Column } from "drizzle-orm";

import { trashTables } from "../../schemas/trash";

/** The fluent update an account deletion's transaction offers. */
interface UpdatingTransaction {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

export async function eraseTrashActor(
  tx: UpdatingTransaction,
  dialect: SupportedDialect,
  userId: string
): Promise<void> {
  const table = trashTables(dialect).nextlyTrash as unknown as {
    trashedByKind: Column;
    trashedById: Column;
  };
  await tx
    .update(table)
    .set({ trashedById: null, trashedByName: null })
    .where(and(eq(table.trashedByKind, "user"), eq(table.trashedById, userId)));
}
