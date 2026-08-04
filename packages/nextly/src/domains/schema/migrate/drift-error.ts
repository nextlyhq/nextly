/**
 * `NEXTLY_MIGRATION_DRIFT` error formatting (spec §4.7.1).
 *
 * Built when Phase 2 finds the live DB matches neither the migration's
 * pre-baseline nor its target — i.e. out-of-band schema changes.
 *
 * @module domains/schema/migrate/drift-error
 * @since v0.0.3-alpha (Plan C2)
 */
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

  // One command, not a menu. All three generic recoveries fail on an unadopted
  // database, so listing them would cost three attempts before the real answer.
  const recovery = args.unadoptedDatabase
    ? [
        "  Recovery — record what the database already has, once:",
        "          pnpm nextly migrate:baseline",
        "",
        "  Then delete this migration and re-create it; it will contain only",
        "  what actually changed:",
        `          rm ${args.file} && pnpm nextly migrate:create --name ${args.migration.replace(/^\d+_/, "")}`,
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
