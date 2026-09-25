/**
 * A plugin's applied schema version, read from the migration ledger.
 *
 * Shared by `migrate:down`, which moves a plugin's recorded version back after
 * a rollback, and `migrate`, which stamps it onto the element rows of a plugin
 * that contributes elements to other owners' tables. One reading of "applied",
 * so the two cannot disagree about the same ledger.
 *
 * @module domains/schema/migrate/plugin/plugin-schema-version
 */
import { scopeLedgerRows } from "../../events/ledger-scope";
import { appliedFilenames } from "../../events/newest-event";
import type { SchemaEventRow } from "../../events/schema-events-repository";
import type { OwnerRecord } from "../../ownership/owner-registry";

import { qualifiedFilename } from "./plugin-migration";

/**
 * The highest `schemaVersion` among a plugin's modules that are STILL applied,
 * or null when none is.
 *
 * Read from the ledger rather than stepped down by one: a rollback can take
 * several modules, and modules can be reverted out of order, so counting would
 * describe something the ledger does not.
 *
 * "Still applied" is `appliedFilenames` — the newest event per filename. A
 * rollback is recorded by INSERTING a `rolled_back` event after the `applied`
 * one, so a filter for `applied` rows kept the module this command had just
 * reverted, and the owner rows then held the version of a module whose tables
 * were gone.
 */
export function pluginSchemaVersionFromLedger(
  rows: SchemaEventRow[],
  plugin: string,
  migrations: ReadonlyArray<{ name: string; schemaVersion: number }>
): number | null {
  const applied = appliedFilenames(scopeLedgerRows(rows, plugin));
  let version: number | null = null;
  for (const module of migrations) {
    if (!applied.has(qualifiedFilename(plugin, module.name))) continue;
    version = Math.max(version ?? 0, module.schemaVersion);
  }
  return version;
}

/**
 * Write `pluginSchemaVersionFromLedger` onto every owner row of the plugin.
 *
 * Takes the ledger reader and the owner store rather than a connection so the
 * rollback path can be exercised end to end without a database: the ledger it
 * reads is the one `recordRolledBack` has just written to.
 */
export async function recordPluginSchemaVersionFromLedger(deps: {
  plugin: string;
  migrations: ReadonlyArray<{ name: string; schemaVersion: number }>;
  listFileApplies: () => Promise<SchemaEventRow[]>;
  owners: {
    read(): Promise<OwnerRecord[]>;
    upsert(rows: readonly OwnerRecord[]): Promise<void>;
  };
}): Promise<void> {
  const mine = (await deps.owners.read()).filter(
    row => row.ownerId === deps.plugin
  );
  if (mine.length === 0) return;
  const version = pluginSchemaVersionFromLedger(
    await deps.listFileApplies(),
    deps.plugin,
    deps.migrations
  );
  await deps.owners.upsert(
    mine.map(row => ({ ...row, schemaVersion: version }))
  );
}
