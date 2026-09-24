/**
 * What a plugin ships instead of loose `.sql` files.
 *
 * A generated TypeScript MODULE, because a module import is always in a
 * Next.js server bundle and loose files inside `node_modules` are not. A
 * plugin whose migrations cannot be found at runtime is a plugin whose tables
 * never reach production, and the failure arrives as a query against a missing
 * table rather than as anything about migrations.
 *
 * ## The checksum, and why there are two of them
 *
 * The module carries a checksum over its own SQL, which catches a module
 * edited after generation — the author's mistake. The LEDGER separately stores
 * the sha256 of what actually ran, which catches a module changed after it was
 * applied — everyone else's problem, because the database no longer matches
 * the file that claims to describe it.
 *
 * Neither check subsumes the other: the first fires on an unapplied module and
 * the second on an applied one, and an edit between generation and application
 * is only visible to the first.
 *
 * @module domains/schema/migrate/plugin/plugin-migration
 * @since 1.0.0
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import type { TableSpec } from "../../pipeline/diff/types";

/** The statements one dialect runs, in order. */
export interface DialectStatements {
  up: string[];
  down: string[];
}

export interface PluginMigrationSnapshot {
  tables: TableSpec[];
}

export interface PluginMigration {
  /** Ordered by name, so the timestamp prefix decides the sequence. */
  name: string;
  /** The plugin's declared schema version after this migration. */
  schemaVersion: number;
  /** sha256 over the canonical form of `dialects`. */
  checksum: string;
  dialects: Record<SupportedDialect, DialectStatements>;
  /** The owner's tables AFTER this migration, per dialect. */
  snapshot: Record<SupportedDialect, PluginMigrationSnapshot>;
  /** The owner's tables BEFORE it — the previous module's snapshot, or empty. */
  before: Record<SupportedDialect, PluginMigrationSnapshot>;
  /**
   * Tables this owner does NOT own, carrying elements it contributed.
   *
   * A plugin may add a column to a declared dependency's table, and that
   * column has to travel in this plugin's module: the plugin ships its own
   * migrations precisely so installing it does not require the app to
   * regenerate, and a column left out of them never reaches an existing
   * installation.
   *
   * Kept OUT of `snapshot` deliberately. `snapshot` is what the apply path
   * records ownership from, and a dependency's table listed there would let
   * this plugin overwrite its owner — the table belongs to the dependency; only
   * the element is this plugin's. These two sides feed the diff and the
   * reconcile, never the owner rows.
   */
  contributed?: Record<SupportedDialect, PluginMigrationSnapshot>;
  /** The same foreign tables BEFORE this module, for the same diff. */
  contributedBefore?: Record<SupportedDialect, PluginMigrationSnapshot>;
}

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * The canonical form a checksum is taken over.
 *
 * Keys are emitted in a fixed order rather than whatever `JSON.stringify`
 * happens to produce, so a module regenerated on a different day hashes the
 * same when its SQL is the same. A checksum that moves without the SQL moving
 * would refuse a module nobody touched.
 */
export function canonicalMigrationForm(
  dialects: Record<SupportedDialect, DialectStatements>
): string {
  return JSON.stringify(
    DIALECTS.map(dialect => [
      dialect,
      dialects[dialect]?.up ?? [],
      dialects[dialect]?.down ?? [],
    ])
  );
}

/** The checksum a generated module carries. */
export function migrationChecksum(
  dialects: Record<SupportedDialect, DialectStatements>
): string {
  return createHash("sha256")
    .update(canonicalMigrationForm(dialects))
    .digest("hex");
}

/** The ledger filename a plugin's migration is recorded under. */
export function qualifiedFilename(
  pluginName: string,
  migrationName: string
): string {
  // Qualified, so the ledger's existing "one applied row per filename" rule
  // keeps working unchanged: two plugins may both ship `001_init` and those
  // are different migrations.
  return `plugin:${pluginName}/${migrationName}`;
}

/**
 * Refuse a module whose SQL no longer matches its checksum.
 *
 * An edited module is refused rather than re-hashed. Re-hashing would accept
 * whatever is on disk, which is precisely the state this exists to detect:
 * the SQL that will run is not the SQL that was reviewed.
 */
export function assertModuleIntact(
  pluginName: string,
  migration: PluginMigration
): void {
  const actual = migrationChecksum(migration.dialects);
  if (actual === migration.checksum) return;

  throw new NextlyError({
    code: "MIGRATION_CHECKSUM_MISMATCH",
    publicMessage:
      "A plugin migration has been changed since it was generated. Regenerate it, or restore the original.",
    logContext: {
      plugin: pluginName,
      migration: migration.name,
      expected: migration.checksum,
      actual,
    },
  });
}

/**
 * Refuse an APPLIED module whose SQL differs from what ran.
 *
 * Distinct from the check above, and not covered by it: a module can be
 * internally consistent — regenerated, checksum rewritten — and still differ
 * from the statements that built the live database. The ledger is the only
 * record of what actually ran.
 */
export function assertAppliedUnchanged(
  pluginName: string,
  migration: PluginMigration,
  recordedSha256: string | null
): void {
  if (recordedSha256 === null) return;
  const actual = migrationChecksum(migration.dialects);
  if (actual === recordedSha256) return;

  throw new NextlyError({
    code: "MIGRATION_CHECKSUM_MISMATCH",
    publicMessage:
      "A plugin migration that has already been applied no longer matches what was applied. The database does not match the file that claims to describe it.",
    logContext: {
      plugin: pluginName,
      migration: migration.name,
      applied: recordedSha256,
      onDisk: actual,
    },
  });
}

/**
 * The modules a plugin ships, in the order they must run.
 *
 * Sorted by name rather than trusting the array's order: the generated
 * `index.ts` is rewritten by a tool, and a hand-edit that reorders it would
 * otherwise silently change which migration runs first.
 */
export function orderedMigrations(
  migrations: readonly PluginMigration[]
): PluginMigration[] {
  return [...migrations].sort((a, b) => a.name.localeCompare(b.name));
}
