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
   * The database holds a schema migrations have never been told about — this
   * migration expected to start from nothing and found tables already there,
   * with every difference being one of them.
   *
   * Worth naming separately because the generic advice is actively wrong for
   * it: none of the three recoveries below can succeed on an un-adopted
   * database, so offering them leaves the operator trying each in turn and
   * getting a different refusal from each.
   */
  looksUnadopted?: boolean;
}

export function migrationDriftError(args: MigrationDriftArgs): NextlyError {
  const lines = args.driftItems
    .map(d => `    ${d.kind} ${d.detail}`)
    .join("\n");

  if (args.looksUnadopted) {
    return new NextlyError({
      code: "NEXTLY_MIGRATION_DRIFT",
      statusCode: 409,
      publicMessage: [
        "Migration cannot be applied: this database is not managed by migrations yet",
        "",
        `  Migration:  ${args.migration}`,
        `  File:       ${args.file}`,
        "",
        "  Every difference below is a table that EXISTS in your database but",
        "  that migrations have no record of. That is what a project built with",
        "  `db:sync` looks like: the schema is real, it simply has no starting",
        "  snapshot to measure changes against.",
        "",
        `  Tables already present (${args.driftItems.length}):`,
        lines,
        "",
        "  Fix — adopt the database, then create your migration again:",
        "        pnpm nextly migrate:baseline",
        `        pnpm nextly migrate:create --name ${args.migration}`,
        "        pnpm nextly migrate",
        "",
        "  Baselining records the schema you already have as the starting",
        "  point. It changes nothing in the database.",
        "",
        "  Details: https://docs.nextlyhq.com/guides/migration-drift",
      ].join("\n"),
      logContext: {
        migration: args.migration,
        file: args.file,
        driftCount: args.driftItems.length,
        unadopted: true,
      },
    });
  }

  const publicMessage = [
    "Migration cannot be applied: schema drift detected",
    "",
    `  Migration:  ${args.migration}`,
    `  File:       ${args.file}`,
    "",
    "  Your database differs from BOTH the pre-migration baseline and the",
    "  expected post-migration state. This usually means schema changes were",
    "  made outside Nextly's tracked paths (manual SQL, a failed prior run,",
    "  divergent teammate state).",
    "",
    `  Drift summary (${args.driftItems.length} differences):`,
    lines,
    "",
    "  Recovery (pick one):",
    "    [A] Sync the DB to your config, then re-run migrate:",
    "          pnpm nextly db:sync && pnpm nextly migrate",
    "    [B] Mark it applied without executing (if you applied it manually):",
    `          pnpm nextly migrate:resolve --applied ${args.migration}`,
    "    [C] Capture the drift in a new migration:",
    "          pnpm nextly migrate:create --name capture_drift && pnpm nextly migrate",
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
      suggestedActions: ["A", "B", "C"],
    },
  });
}
