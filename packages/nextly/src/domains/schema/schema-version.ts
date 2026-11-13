/**
 * The database's schema version: one stored value saying which app
 * migrations, and which Schema Builder changes, the database holds.
 *
 * Stored as one `nextly_meta` row, `{ migration, seq }`:
 * - `migration` is the base name of the newest app migration whose registry
 *   rows are written, set by `nextly migrate` (and `migrate:down`) and by
 *   nothing else;
 * - `seq` counts registry writes: every write of the collection, Single and
 *   field group registry rows, and every plugin install or uninstall, moves
 *   it, in the same transaction as the write, so it says "the schema changed"
 *   to anything that watches it.
 *
 * A production start reads it in one statement and compares `migration` with
 * the build's (`build-schema-version.ts`): behind is warned about, ahead is
 * noted, and neither is repaired, since the start writes nothing.
 *
 * This module is the only one that spells the row's key: reading, writing
 * (on the Drizzle handle of the transaction the registry rows are written on,
 * or as SQL a migration file carries) and comparing all live here.
 *
 * @module domains/schema/schema-version
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { eq, type SQL } from "drizzle-orm";

import { loadedDialect } from "../../database/dialect-tables";
import { bumpSchemaVersion } from "../../route-handler/schema-version";
import { runReadsAndWritesInTransaction } from "../../shared/lib/read-transaction-scope";
import { clearRegistryRowCache } from "../dynamic-collections/services/collection-row-cache";

import { newestMigrationName } from "./build-schema-version";
import { isPluginLedgerRow } from "./events/ledger-scope";
import { standingsByFilename } from "./events/migration-state";
import type { SchemaEventRow } from "./events/schema-events-repository";

/** The `nextly_meta` key the schema version is stored under. */
const SCHEMA_VERSION_KEY = "schema_version";

/** The stored schema version. */
export interface SchemaVersion {
  /** The newest app migration whose registry rows are written, or none. */
  migration: string | null;
  /** How many registry writes the database has seen since it was first stored. */
  seq: number;
}

/**
 * What a registry write changes in the stored version: `wrote` says rows were
 * written (moving `seq`); `migration`, where given, is the newest app
 * migration whose rows are now written. Nothing is stored when neither
 * changes anything.
 */
export interface SchemaVersionChange {
  wrote: boolean;
  migration?: string | null;
}

/**
 * The stored version as read: absent (a database migrated before the version
 * was stored, or never migrated), or present, with `version` undefined where
 * the row holds something that is not a schema version.
 */
export type StoredSchemaVersion =
  | { present: false }
  | { present: true; version: SchemaVersion | undefined };

/** How the stored version stands against the build's. */
export type SchemaVersionStanding =
  /** The build names no migration, so nothing is compared. */
  | { kind: "no-build" }
  /** The database stores no readable version to compare. */
  | { kind: "unknown"; build: string }
  | { kind: "equal" }
  /** The database holds an older migration than the build ships. */
  | { kind: "behind"; stored: string | null; build: string }
  /** The database holds a newer migration than the build ships. */
  | { kind: "ahead"; stored: string; build: string };

/**
 * The `nextly_meta` handle this module writes and reads through, as far as
 * it goes: the three dialects' Drizzle builders all fit it.
 */
interface MetaRows extends PromiseLike<{ value: unknown }[]> {
  for?(strength: "update"): PromiseLike<{ value: unknown }[]>;
}
interface MetaInsert extends PromiseLike<unknown> {
  onConflictDoNothing?(): PromiseLike<unknown>;
  onDuplicateKeyUpdate?(config: {
    set: Record<string, unknown>;
  }): PromiseLike<unknown>;
}
interface MetaDatabase {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: SQL): { limit(count: number): MetaRows };
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): MetaInsert;
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: SQL): PromiseLike<unknown>;
    };
  };
}

/** The dialect's `nextly_meta` table and the condition naming the version's row. */
function versionRow(dialect: SupportedDialect) {
  const table = loadedDialect(dialect).tables.nextlyMeta;
  return { table, isVersion: eq(table.key, SCHEMA_VERSION_KEY) };
}

/**
 * The version a stored value holds, or undefined for anything else. The
 * value is the JSON text of the version on every dialect (PostgreSQL and
 * MySQL keep that text as a JSON string, as `MetaService` writes it), and is
 * read whichever form the driver hands back.
 */
function decodeVersion(raw: unknown): SchemaVersion | undefined {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { migration, seq } = value as Record<string, unknown>;
  if (typeof seq !== "number" || !Number.isFinite(seq)) return undefined;
  if (migration !== null && typeof migration !== "string") return undefined;
  return { migration, seq };
}

/**
 * Read the stored version in ONE statement on `db`, a Drizzle handle: the
 * pool's, or a transaction's. A production start makes this read and no
 * other of the schema; it throws where the table cannot be read, which the
 * start reports as a version it does not know.
 */
export async function readSchemaVersion(
  db: unknown,
  dialect: SupportedDialect
): Promise<StoredSchemaVersion> {
  const { table, isVersion } = versionRow(dialect);
  const rows = await (db as MetaDatabase)
    .select({ value: table.value })
    .from(table)
    .where(isVersion)
    .limit(1);
  if (rows.length === 0) return { present: false };
  return { present: true, version: decodeVersion(rows[0].value) };
}

/**
 * Store `change` on `db`, the Drizzle handle of the transaction the registry
 * rows were written on, so the version commits or rolls back with them.
 * Returns whether anything was stored.
 *
 * The row is created first where it is missing, then read locked (PostgreSQL
 * and MySQL; SQLite has one writer), so two transactions writing registry
 * rows at once each move `seq`, the later one after the earlier commits,
 * rather than both writing the same next value.
 */
export async function storeSchemaVersion(
  db: unknown,
  dialect: SupportedDialect,
  change: SchemaVersionChange
): Promise<boolean> {
  const handle = db as MetaDatabase;
  const { table, isVersion } = versionRow(dialect);
  const empty: SchemaVersion = { migration: null, seq: 0 };
  const seed = handle.insert(table).values({
    key: SCHEMA_VERSION_KEY,
    value: JSON.stringify(empty),
    updatedAt: new Date(),
  });
  // An insert that leaves an existing row alone: PostgreSQL's and SQLite's
  // conflict clause, MySQL's no-op update of the key onto itself.
  if (typeof seed.onConflictDoNothing === "function") {
    await seed.onConflictDoNothing();
  } else if (typeof seed.onDuplicateKeyUpdate === "function") {
    await seed.onDuplicateKeyUpdate({ set: { key: SCHEMA_VERSION_KEY } });
  } else {
    await seed;
  }
  const query = handle
    .select({ value: table.value })
    .from(table)
    .where(isVersion)
    .limit(1);
  const rows =
    dialect === "sqlite" || typeof query.for !== "function"
      ? await query
      : await query.for("update");
  // A row holding something else is replaced: the count starts again from it.
  const current = decodeVersion(rows[0]?.value) ?? empty;
  const migration =
    change.migration === undefined ? current.migration : change.migration;
  if (!change.wrote && migration === current.migration) return false;
  const next: SchemaVersion = { migration, seq: current.seq + 1 };
  await handle
    .update(table)
    .set({ value: JSON.stringify(next), updatedAt: new Date() })
    .where(isVersion);
  return true;
}

/**
 * The statement a migration file carries after the registry rows it writes,
 * moving `seq` in the file's transaction: one upsert, creating the row where
 * it is missing. It leaves `migration` alone, which `nextly migrate` sets once
 * the run has written every registry row (`writeRegistryRows`).
 *
 * Built as SQL because the file is SQL. The value is stored as `MetaService`
 * and {@link storeSchemaVersion} store it: JSON text, which PostgreSQL and
 * MySQL keep as a JSON string.
 */
export function schemaVersionStoreSql(dialect: SupportedDialect): string {
  const key = `'${SCHEMA_VERSION_KEY}'`;
  const first = `'${JSON.stringify({ migration: null, seq: 1 })}'`;
  if (dialect === "postgresql") {
    const stored = `("nextly_meta"."value" #>> '{}')::jsonb`;
    return (
      `INSERT INTO "nextly_meta" ("key", "value", "updated_at") ` +
      `VALUES (${key}, to_jsonb(${first}::text), now()) ` +
      `ON CONFLICT ("key") DO UPDATE SET "value" = to_jsonb(jsonb_build_object(` +
      `'migration', ${stored} -> 'migration', ` +
      `'seq', COALESCE((${stored} ->> 'seq')::bigint, 0) + 1)::text), ` +
      `"updated_at" = now();`
    );
  }
  if (dialect === "mysql") {
    const stored = "CAST(JSON_UNQUOTE(`value`) AS JSON)";
    return (
      "INSERT INTO `nextly_meta` (`key`, `value`, `updated_at`) " +
      `VALUES (${key}, JSON_QUOTE(${first}), CURRENT_TIMESTAMP) ` +
      "ON DUPLICATE KEY UPDATE `value` = JSON_QUOTE(CAST(JSON_OBJECT(" +
      `'migration', JSON_EXTRACT(${stored}, '$.migration'), ` +
      `'seq', COALESCE(JSON_EXTRACT(${stored}, '$.seq'), 0) + 1) AS CHAR)), ` +
      "`updated_at` = CURRENT_TIMESTAMP;"
    );
  }
  const now = "CAST(strftime('%s', 'now') AS INTEGER)";
  return (
    `INSERT INTO "nextly_meta" ("key", "value", "updated_at") ` +
    `VALUES (${key}, ${first}, ${now}) ` +
    `ON CONFLICT ("key") DO UPDATE SET "value" = json_object(` +
    `'migration', json_extract("nextly_meta"."value", '$.migration'), ` +
    `'seq', COALESCE(json_extract("nextly_meta"."value", '$.seq'), 0) + 1), ` +
    `"updated_at" = ${now};`
  );
}

/**
 * How `stored` stands against `build`, the build's newest migration. Names
 * compare by recency, which their timestamps give (`newestMigrationName`).
 */
export function compareSchemaVersion(
  stored: StoredSchemaVersion,
  build: string | undefined
): SchemaVersionStanding {
  if (build === undefined) return { kind: "no-build" };
  if (!stored.present || stored.version === undefined) {
    return { kind: "unknown", build };
  }
  const { migration } = stored.version;
  if (migration === build) return { kind: "equal" };
  if (
    migration !== null &&
    newestMigrationName([migration, build]) === migration
  ) {
    return { kind: "ahead", stored: migration, build };
  }
  return { kind: "behind", stored: migration, build };
}

/** The logger a start reports through. */
export interface SchemaVersionLogger {
  warn(message: string): void;
  info(message: string): void;
}

/**
 * Compare the stored version with the build's at a production start and say
 * so once: a warning where the database is behind or its version is unknown,
 * a note where it is ahead, nothing where they agree or the build names no
 * migration. ONE read, and nothing written: the start serves either way, and
 * `nextly migrate` is what brings the database up to date.
 */
export async function reportSchemaVersionAtStart(args: {
  db: unknown;
  dialect: SupportedDialect;
  build: string | undefined;
  logger: SchemaVersionLogger;
}): Promise<SchemaVersionStanding> {
  const { build, logger } = args;
  // No build version, nothing to compare: not even the read is made.
  if (build === undefined) return { kind: "no-build" };
  let stored: StoredSchemaVersion;
  try {
    stored = await readSchemaVersion(args.db, args.dialect);
  } catch {
    // A table that cannot be read is a database `nextly migrate` has not
    // prepared: reported as a version the start does not know.
    stored = { present: false };
  }
  const standing = compareSchemaVersion(stored, build);
  if (standing.kind === "unknown") {
    logger.warn(
      `The database records no schema version, so it cannot be compared with this build's (${standing.build}). Run \`nextly migrate\`, which records it. The app keeps serving meanwhile.`
    );
  } else if (standing.kind === "behind") {
    logger.warn(
      `The database's schema version (${standing.stored ?? "no migration"}) is behind this build's (${standing.build}). Run \`nextly migrate\` to bring the database up to date. The app keeps serving meanwhile, and nothing was changed.`
    );
  } else if (standing.kind === "ahead") {
    logger.info(
      `The database's schema version (${standing.stored}) is ahead of this build's (${standing.build}): an older build is serving, or a deploy was rolled back. Nothing was changed.`
    );
  }
  return standing;
}

/**
 * Each app migration the ledger records applied, by base name. Plugin
 * modules are left out; they are not the app's history.
 */
export function appliedAppMigrations(
  fileApplies: readonly SchemaEventRow[]
): Set<string> {
  const applied = new Set<string>();
  for (const [filename, standing] of standingsByFilename(fileApplies)) {
    if (isPluginLedgerRow(filename) || standing.state !== "applied") continue;
    applied.add(filename.replace(/\.sql$/i, ""));
  }
  return applied;
}

/**
 * The newest app migration the ledger records applied, by base name
 * (`newestMigrationName`, the rule the build's own version is named by), or
 * null where none is: what `migration` says once that migration's registry
 * rows are written, and the point the registry record is taken at.
 */
export function newestAppliedAppMigration(
  fileApplies: readonly SchemaEventRow[]
): string | null {
  return newestMigrationName(appliedAppMigrations(fileApplies)) ?? null;
}

/** A registry write in progress in the calling flow (`writeRegistryRows`). */
interface RegistryWrite {
  readonly tx: TransactionContext;
  wrote: boolean;
  live: boolean;
}

const registryWrite = new AsyncLocalStorage<RegistryWrite>();

/**
 * Write registry rows, and the stored version beside them, in ONE
 * transaction.
 *
 * `work` writes the rows: through `tx` itself, or through the registry
 * services, whose reads and writes inside it run on `tx`
 * (`runReadsAndWritesInTransaction`). Then the version is stored on `tx`
 * (`storeSchemaVersion`): `seq` moves where `wrote` says rows were written
 * (by default, always), and `migration` is set where `migration` names one.
 * A failure anywhere rolls back the rows and the version together.
 *
 * Called inside another registry write in the same flow, `work` runs in
 * that write's transaction and its rows count towards that write's version;
 * only the outermost write stores it, once, so no second transaction is
 * opened.
 */
export async function writeRegistryRows<T>(
  adapter: DrizzleAdapter,
  work: (tx: TransactionContext) => Promise<T>,
  version: {
    wrote?: (result: T) => boolean;
    migration?: (result: T) => string | null | undefined;
  } = {}
): Promise<T> {
  const outer = registryWrite.getStore();
  if (outer?.live === true) {
    const result = await work(outer.tx);
    outer.wrote ||= version.wrote?.(result) ?? true;
    return result;
  }
  const dialect = adapter.getCapabilities().dialect;
  try {
    const written = await adapter.transaction(async tx => {
      const own: RegistryWrite = { tx, wrote: false, live: true };
      try {
        const result = await registryWrite.run(own, () =>
          runReadsAndWritesInTransaction(tx, () => work(tx))
        );
        const migration = version.migration?.(result);
        await storeSchemaVersion(tx.getDrizzle(), dialect, {
          wrote: own.wrote || (version.wrote?.(result) ?? true),
          ...(migration === undefined ? {} : { migration }),
        });
        return result;
      } finally {
        own.live = false;
      }
    });
    // Committed: this process's next request reads the stored version at
    // once, so it serves the change and says so, rather than after the
    // interval another copy's change waits.
    bumpSchemaVersion();
    return written;
  } finally {
    // A row read and cached inside the transaction may describe a write that
    // rolled back, or one that has since committed.
    clearRegistryRowCache();
  }
}

/**
 * Count a write of registry rows made on `tx`, a transaction its caller
 * opened and commits: inside an open registry write ({@link writeRegistryRows})
 * it counts towards that write's version, stored once at its end; otherwise
 * the version is stored on `tx` now, so its count commits or rolls back with
 * the rows. The caller clears the cached registry rows once `tx` has ended,
 * as after any registry write.
 */
export async function countRegistryWriteOn(
  tx: TransactionContext,
  dialect: SupportedDialect
): Promise<void> {
  const outer = registryWrite.getStore();
  if (outer?.live === true) {
    outer.wrote = true;
    return;
  }
  await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
}

/**
 * {@link writeRegistryRows} for a caller whose adapter is optional (a Builder
 * metadata service built without one generates statements and never runs
 * them): with no adapter there is no transaction to write the version in,
 * and `work` runs as it always did.
 */
export function writeRegistryRowsWith<T>(
  adapter: DrizzleAdapter | undefined,
  work: () => Promise<T>
): Promise<T> {
  return adapter === undefined ? work() : writeRegistryRows(adapter, work);
}

/**
 * Run one step of a registry write (one row, say) so that its failure costs
 * that step alone and the write goes on: what the registry writers did
 * before their rows shared a transaction.
 *
 * Inside an open registry write, on PostgreSQL and SQLite, the step joins the
 * transaction as a savepoint, rolled back to on failure: a failed statement
 * would otherwise abort PostgreSQL's whole transaction. MySQL undoes a failed
 * statement alone and keeps the transaction usable, and a step joined there
 * would fail the whole transaction instead, so the step runs as it is.
 * Outside a registry write the step runs as it is too.
 */
export async function inRegistryStep<T>(
  adapter: DrizzleAdapter,
  work: () => Promise<T>
): Promise<T> {
  if (registryWrite.getStore()?.live !== true) return work();
  if (adapter.getCapabilities().dialect === "mysql") return work();
  return adapter.transaction(() => work());
}
