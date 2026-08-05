/**
 * `NEXTLY_MIGRATION_DRIFT` error formatting (spec §4.7.1).
 *
 * Built when Phase 2 finds the live DB matches neither the migration's
 * pre-baseline nor its target — i.e. out-of-band schema changes.
 *
 * @module domains/schema/migrate/drift-error
 * @since v0.0.3-alpha (Plan C2)
 */
import { dirname, join } from "node:path";

import { NextlyError } from "../../../errors";

/** One drift line: `+` present-in-DB, `-` expected-but-absent, `?` unknown. */
export interface DriftItem {
  kind: "+" | "-" | "?";
  detail: string;
}

export interface MigrationDriftArgs {
  /** Migration name (filename without extension). */
  migration: string;
  /** Repo-relative path to the .sql file. */
  file: string;
  driftItems: DriftItem[];
  /**
   * Whether this is a database that has never been adopted into the migration
   * history — every difference is a table already standing, and the migration
   * expected to start from nothing.
   *
   * It gets its own guidance because the three generic recoveries all fail in
   * that state: `db:sync` reports no changes, `migrate:resolve --applied`
   * refuses because live does not equal the target, and `migrate:create`
   * detects no changes and writes nothing. Offering them is worse than
   * offering nothing, because each one costs a try before it fails.
   */
  unadoptedDatabase?: boolean;
}

/**
 * Where the snapshot paired with a migration lives.
 *
 * Derived from the `.sql` path rather than passed in, so the two can never
 * name different migrations. `snapshot-io` writes them as
 * `<dir>/<name>.sql` and `<dir>/meta/<name>.snapshot.json`.
 *
 * Split with `node:path` rather than on `/`: `migrate` resolves this to an
 * absolute path, which on Windows is separated by backslashes. Splitting on
 * the forward slash alone would find no directory there and name a `meta/`
 * beside the working directory instead of beside the migration, leaving the
 * real snapshot in place — and `migrate:baseline` still refusing the project.
 */
function snapshotPathFor(file: string, migration: string): string {
  const dir = dirname(file);
  return join(dir, "meta", `${migration}.snapshot.json`);
}

/**
 * Every `.sql` belonging to one migration, as a shell glob.
 *
 * A migration can be written once per dialect (`<name>.mysql.sql` beside
 * `<name>.sql`), and discovery selects one of them. Naming only the selected
 * file leaves its siblings behind, and `migrate:baseline` then refuses the
 * project because the history is not empty — which is the same dead end the
 * ordering here exists to avoid.
 */
function variantGlobFor(file: string, migration: string): string {
  return join(dirname(file), `${migration}*.sql`);
}

export function migrationDriftError(args: MigrationDriftArgs): NextlyError {
  const lines = args.driftItems
    .map(d => `    ${d.kind} ${d.detail}`)
    .join("\n");

  const cause = args.unadoptedDatabase
    ? [
        "  This database already has tables, and this migration expects to start",
        "  from an empty one. That is what a project managed by `db:sync` looks",
        "  like the first time it creates a migration: the schema is real, but",
        "  nothing has recorded where the history begins.",
      ]
    : [
        "  Your database differs from BOTH the pre-migration baseline and the",
        "  expected post-migration state. This usually means schema changes were",
        "  made outside Nextly's tracked paths (manual SQL, a failed prior run,",
        "  divergent teammate state).",
      ];

  // One recovery, not a menu. All three generic ones fail on an unadopted
  // database, so listing them would cost three attempts before the real answer.
  //
  // The order matters and is the opposite of the obvious one. This migration
  // was written with a snapshot beside it, and `migrate:baseline` refuses a
  // project that already has one — so baselining first reports "already
  // baselined" and nothing happens. Both files have to go first, and deleting
  // only the `.sql` leaves the snapshot behind to do the same thing.
  const recovery = args.unadoptedDatabase
    ? [
        "  Recovery — this migration cannot be applied and has to go first.",
        "  Remove it and its snapshot (the glob covers per-dialect variants,",
        "  which are one migration and have to go together):",
        `          rm ${variantGlobFor(args.file, args.migration)} ${snapshotPathFor(args.file, args.migration)}`,
        "",
        "  Record what the database already has, once:",
        "          pnpm nextly migrate:baseline",
        "",
        "  Then re-create the migration; it will contain only what changed:",
        `          pnpm nextly migrate:create --name ${args.migration.replace(/^\d+_/, "")}`,
      ]
    : [
        "  Recovery (pick one):",
        "    [A] Sync the DB to your config, then re-run migrate:",
        "          pnpm nextly db:sync && pnpm nextly migrate",
        "    [B] Mark it applied without executing (if you applied it manually):",
        `          pnpm nextly migrate:resolve --applied ${args.migration}`,
        "    [C] Capture the drift in a new migration:",
        "          pnpm nextly migrate:create --name capture_drift && pnpm nextly migrate",
      ];

  const publicMessage = [
    "Migration cannot be applied: schema drift detected",
    "",
    `  Migration:  ${args.migration}`,
    `  File:       ${args.file}`,
    "",
    ...cause,
    "",
    `  Drift summary (${args.driftItems.length} differences):`,
    lines,
    "",
    ...recovery,
    "",
    "  Details: https://docs.nextlyhq.com/guides/migration-drift",
  ].join("\n");

  return new NextlyError({
    code: "NEXTLY_MIGRATION_DRIFT",
    statusCode: 409,
    publicMessage,
    logContext: {
      migration: args.migration,
      driftItems: args.driftItems,
      suggestedActions: args.unadoptedDatabase ? ["baseline"] : ["A", "B", "C"],
      unadoptedDatabase: args.unadoptedDatabase === true,
    },
  });
}
