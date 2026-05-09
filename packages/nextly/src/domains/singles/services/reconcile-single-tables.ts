/**
 * Reconcile the `dynamic_singles` registry with the actual physical tables.
 *
 * Why: on every dev-server startup, the registry may think a Single exists
 * (registry row + canonical table_name) while the physical table is missing
 * (fresh DB, dropped table, failed migration, partially-completed sync).
 * Without reconciliation, reads against the missing table throw
 * "no such table" and the admin page errors even though the Single is
 * "registered."
 *
 * Before this helper, `performSinglesAutoSync` in dev-server gated DDL
 * creation on whether the registry thought any singles were newly created or
 * updated. That guard silently skipped table creation whenever the registry
 * already had the row even if the physical table was missing. Reconciliation
 * runs unconditionally after sync to make the "registry says it exists" and
 * "the table actually exists" invariant hold on every dev-server startup.
 *
 * The caller injects DB primitives so this function stays pure and
 * unit-testable.
 */

/**
 * Registry row shape the reconciler needs. Intentionally minimal: we only
 * need the slug (for createTable config) and the canonical tableName.
 */
export interface RegisteredSingle {
  slug: string;
  tableName: string;
}

/**
 * Dependencies the reconciler depends on. Pass real adapters in production,
 * mocks in tests.
 */
export interface SingleTableReconciler {
  /** Return every Single registered in `dynamic_singles`. */
  registeredSingles: () => Promise<RegisteredSingle[]>;
  /** Return the set of tables that currently exist in the DB. */
  existingTableNames: () => Promise<Set<string>>;
  /** Create the single's data table. Implementation-specific (DDL). */
  createTable: (single: RegisteredSingle) => Promise<void>;
}

/**
 * Walk the registry, create any physical tables that are missing.
 *
 * Idempotent: tables that already exist are left alone. Errors from
 * `createTable` propagate so the caller can decide whether to abort
 * startup.
 */
export async function reconcileSingleTables(
  reconciler: SingleTableReconciler
): Promise<void> {
  const [registered, existing] = await Promise.all([
    reconciler.registeredSingles(),
    reconciler.existingTableNames(),
  ]);

  for (const single of registered) {
    if (existing.has(single.tableName)) continue;
    await reconciler.createTable(single);
  }
}
