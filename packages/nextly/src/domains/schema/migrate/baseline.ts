/**
 * Adopting an existing database into migrations (the `migrate:baseline` core).
 *
 * A project built with `db:sync` has no migration snapshot, so the first
 * `migrate:create` diffs the config against an EMPTY baseline and emits
 * `CREATE TABLE` for every table that already exists. Once that project also has
 * a pending config change, the generated migration bundles "adopt what exists"
 * with "apply the change", the live database matches neither side, and `migrate`
 * refuses. Recording the live schema as the starting snapshot is what unsticks
 * it — and it is the step Flyway (`baseline`), Django (`--fake-initial`),
 * Alembic (`stamp head`) and Prisma (`migrate diff --from-database`) all have.
 *
 * The decisions live here rather than in the CLI shell for the same reason
 * `resolveMigration` does: they are what is worth testing, and they should not
 * require a database, a config file or a process to exercise.
 *
 * @module domains/schema/migrate/baseline
 */
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

/** Where a baseline attempt ended up. The CLI maps these to output and exit codes. */
export type BaselineResult =
  | {
      kind: "created";
      filename: string;
      sqlPath: string;
      snapshotPath: string;
      tableCount: number;
      /** Set when recording the baseline applied was already done. */
      note?: string;
    }
  /** A snapshot already exists: the project is migration-managed already. */
  | { kind: "already-managed"; filename: string }
  /** Nothing to adopt. */
  | { kind: "empty-database" };

export interface CreateBaselineArgs {
  /** Existing starting snapshot, or null when the project has none. */
  existingSnapshot: () => Promise<{ filename: string } | null>;
  /** Live tables that a `migrate:create` snapshot would compare against. */
  listManagedTables: () => Promise<string[]>;
  /** Read the live schema of those tables. */
  introspect: (tables: string[]) => Promise<NextlySchemaSnapshot>;
  /** Persist the migration and its paired snapshot; returns their paths. */
  writeFiles: (input: {
    baseName: string;
    sqlContent: string;
    snapshot: NextlySchemaSnapshot;
  }) => Promise<{ sqlPath: string; snapshotPath: string }>;
  /** Record the baseline as applied WITHOUT executing it. */
  recordApplied: (input: {
    filename: string;
    snapshot: NextlySchemaSnapshot;
    tables: string[];
  }) => Promise<{ kind: string; reason?: string }>;
  /** Injected so the generated name is deterministic in tests. */
  now: Date;
  /** Timestamp prefix for the generated filename. */
  formatTimestamp: (d: Date) => string;
}

/** The migration file's body. */
export function formatBaselineFile(tableCount: number, now: Date): string {
  // A comment, never DDL. The schema this describes ALREADY EXISTS, so emitting
  // CREATE statements would make the file a claim about what it does that is
  // false — and `migrate:fresh` would then execute it against an empty database
  // and reproduce only the part a config-derived snapshot can express.
  return [
    "-- Migration: baseline",
    `-- Generated: ${now.toISOString()}`,
    "--",
    `-- Adoption baseline: records ${tableCount} existing table(s) as the`,
    "-- starting point for migrations. Intentionally empty — the schema it",
    "-- describes was already in the database when this was generated, so",
    "-- there is nothing to apply. The paired snapshot is what matters.",
    "",
  ].join("\n");
}

/**
 * Record the live schema as the starting snapshot for migrations.
 *
 * Refuses in two states, both because proceeding would leave the project worse
 * than it started:
 *
 * - **Already managed.** A second baseline records a second "starting point",
 *   and every later `migrate:create` diffs against whichever snapshot sorts
 *   last — silently changing what the next migration contains.
 * - **Empty database.** There is nothing to adopt, and a snapshot claiming the
 *   database holds no tables is exactly what an un-baselined project already
 *   has, only now with a journal entry implying otherwise.
 */
export async function createBaseline(
  args: CreateBaselineArgs
): Promise<BaselineResult> {
  const existing = await args.existingSnapshot();
  if (existing) return { kind: "already-managed", filename: existing.filename };

  const tables = await args.listManagedTables();
  if (tables.length === 0) return { kind: "empty-database" };

  const snapshot = await args.introspect(tables);
  const baseName = `${args.formatTimestamp(args.now)}_baseline`;
  const sqlContent = formatBaselineFile(tables.length, args.now);
  const { sqlPath, snapshotPath } = await args.writeFiles({
    baseName,
    sqlContent,
    snapshot,
  });

  const filename = `${baseName}.sql`;
  // Recorded applied rather than executed: the schema is already there. The
  // caller's recorder still verifies live against the snapshot just written
  // from it, so this passes by construction and yet fails loudly if the
  // database moved underneath the command.
  const recorded = await args.recordApplied({ filename, snapshot, tables });

  return {
    kind: "created",
    filename,
    sqlPath,
    snapshotPath,
    tableCount: tables.length,
    ...(recorded.kind === "noop" && recorded.reason
      ? { note: recorded.reason }
      : {}),
  };
}
