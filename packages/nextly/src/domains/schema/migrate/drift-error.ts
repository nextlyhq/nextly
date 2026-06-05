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
}

export function migrationDriftError(args: MigrationDriftArgs): NextlyError {
  const lines = args.driftItems
    .map(d => `    ${d.kind} ${d.detail}`)
    .join("\n");

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
