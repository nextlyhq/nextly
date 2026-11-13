/**
 * The Single create's check that no other Single's tables would meet the new one's.
 *
 * Shared by the Builder's Single create and the address check the Builder asks before it, so the
 * check answers an address exactly as the create does.
 *
 * @module dispatcher/handlers/single-table-family
 */
import { singleTableFamiliesCollide } from "../../domains/singles/services/resolve-single-table-name";
import { NextlyError } from "../../errors";

/** What the check reads of the Singles registry: each Single's address and table. */
export interface SingleTablesRegistry {
  getAllSingles(): Promise<ReadonlyArray<{ slug: string; tableName: string }>>;
}

/**
 * Refuses a new Single `slug`, stored in `tableName`, whose tables another Single already holds.
 *
 * Keyed on the TABLE FAMILY rather than the slug. A slug is normalised on its way to a table name,
 * so `foo-bar` and `foo_bar` name one physical table while looking like two free slugs, and a
 * Single's storage spans its main table AND the `_locales` companion beside it, so `foo-locales`
 * collides with `foo` the same way. Asked before any DDL runs: the registry's own check runs after
 * it, by which point the create has already acted against the table that exists and rebound the
 * runtime to the request's fields.
 */
export async function assertSingleTablesUnowned(
  registry: SingleTablesRegistry,
  slug: string,
  tableName: string
): Promise<void> {
  const owner = (await registry.getAllSingles()).find(single =>
    singleTableFamiliesCollide(single.tableName, tableName)
  );
  if (owner) {
    throw NextlyError.duplicate({
      logContext: {
        reason: "single-table-conflict",
        slug,
        tableName,
        ownedBy: owner.slug,
      },
    });
  }
}
