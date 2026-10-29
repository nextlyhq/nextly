/**
 * Cases for migration runs: the schema lock, the data-loss consent, and the migration files.
 *
 * @module cli/__tests__/error-cases/migrations
 */
import { assertNoLegacyBookkeeping } from "../../../domains/schema/events/legacy-detection";
import type { SchemaEventRow } from "../../../domains/schema/events/schema-events-repository";
import {
  judgeDataLoss,
  resolveDataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { migrationDriftError } from "../../../domains/schema/migrate/drift-error";
import {
  assertNotPartiallyApplied,
  concurrentRunError,
} from "../../../domains/schema/migrate/drift-reconcile";
import {
  resolveMigration,
  type ResolveMigrationArgs,
} from "../../../domains/schema/migrate/resolve";
import { parseSnapshotFile } from "../../../domains/schema/migrate-create/snapshot-io";
import type { NextlySchemaSnapshot } from "../../../domains/schema/pipeline/diff/types";
import { describeHolder } from "../../../domains/schema/pipeline/schema-lock";
import { NextlyError } from "../../../errors/nextly-error";
import { refusalOf } from "../../commands/migrate-down";
import { CliError, dataLossRefusal } from "../../errors";
import {
  migrationFileEdited,
  migrationSnapshotInvalid,
  migrationSnapshotMissing,
  resolveModeRequired,
  schemaChangeWithoutMigration,
  settingsChangeWithoutMigration,
  snapshotWithoutMigration,
} from "../../errors/areas/migrations";
import { builderMigrationRemedy } from "../../utils/migration-discovery";

import { PROJECT, type ErrorCases } from "./types";

/** A fixed clock, so the holder's start and lapse times read the same in every run. */
const NOW = Date.UTC(2026, 9, 29, 10, 2, 0);

/** The verdict a run with no terminal reaches for one column, with the consent given. */
async function refusedVerdict(flag: string | boolean | undefined) {
  const verdict = await judgeDataLoss({
    deletions: [
      { kind: "column", table: "dc_posts", column: "summary", count: 42 },
    ],
    consent: resolveDataLossConsent({ flag, env: {} }),
    interactive: false,
    ask: () => Promise.resolve(false),
    print: () => {},
  });
  if (verdict.kind !== "refused")
    throw new Error(`expected a refusal, got ${verdict.kind}`);
  return verdict;
}

/** An app migration's file, and the folder it is in. */
const FILE = "20261020_120000_add_posts.sql";
const MIGRATIONS = `${PROJECT}/migrations`;

/** A Schema Builder save's file, named as a save names it. */
const BUILDER_FILE = "1761732000000_update_posts.sql";

/** The table a migration's snapshot says it leaves. */
const POSTS: NextlySchemaSnapshot = {
  tables: [
    {
      name: "dc_posts",
      columns: [
        { name: "id", type: "text", nullable: false },
        { name: "title", type: "text", nullable: false },
      ],
    },
  ],
};

/** An attempt of `FILE` that failed, as the ledger records it. */
const FAILED_ATTEMPT: SchemaEventRow = {
  id: "evt_1",
  eventType: "file_apply",
  status: "failed",
  source: "cli-migrate",
  filename: FILE,
  sha256: null,
  scopeKind: null,
  scopeSlug: null,
  startedAt: new Date(NOW - 60_000),
  endedAt: new Date(NOW - 59_000),
  durationMs: 1000,
  note: null,
  statementsExecuted: 1,
  supersededEventIds: null,
  supersededBy: null,
};

/** `migrate:resolve`'s state machine over a ledger and a disk given here, as the command runs it. */
function resolving(
  overrides: Partial<ResolveMigrationArgs> & Pick<ResolveMigrationArgs, "mode">
): Promise<unknown> {
  return resolveMigration({
    filename: FILE,
    dialect: "postgresql",
    repo: {
      findFileApplies: () => Promise.resolve([]),
      insertEvent: () => Promise.resolve("evt_2"),
      supersede: () => Promise.resolve(),
      markRolledBack: () => Promise.resolve(),
    },
    fileExists: () => Promise.resolve(true),
    loadTargetSnapshot: () => Promise.resolve(null),
    marksNoTransaction: () => Promise.resolve(false),
    introspectLive: () => Promise.resolve(POSTS),
    ...overrides,
  }).then(
    result => {
      throw new Error(`expected a refusal, got ${result.kind}`);
    },
    (error: unknown) => error
  );
}

/** What `thrower` throws. */
async function thrown(thrower: () => Promise<unknown>): Promise<unknown> {
  try {
    await thrower();
  } catch (error) {
    return error;
  }
  throw new Error("expected it to throw");
}

export const MIGRATION_CASES = {
  // As `refusalFor` in `domains/schema/pipeline/schema-lock.ts` builds it, with the holder in the
  // lock's own words.
  SCHEMA_LOCK_HELD: () => {
    const holder = {
      kind: "schema" as const,
      owner: "build-01:4242#6f1c",
      command: "nextly db:sync",
      heldForSeconds: 120,
      lapsesInSeconds: 30,
    };
    const described = describeHolder(holder, NOW);
    return new NextlyError({
      code: "NEXTLY_MIGRATE_LOCK_BUSY",
      publicMessage:
        "`nextly migrate` did not start, and changed nothing: the schema lock is still held " +
        `after waiting 30 s. ${described[0].toUpperCase()}${described.slice(1)} Run it again once that finishes.`,
      logContext: {
        reason: "schema lock held",
        command: "nextly migrate",
        holder,
        waitedMs: 30_000,
      },
    });
  },
  DATA_LOSS_CONSENT_REQUIRED: async () =>
    dataLossRefusal(await refusedVerdict(undefined)),
  DATA_LOSS_CONSENT_NOT_COVERED: async () =>
    dataLossRefusal(await refusedVerdict("dc_authors")),
  // The consent's own parser, given a list it cannot read.
  DATA_LOSS_CONSENT_MALFORMED: () => {
    try {
      resolveDataLossConsent({ flag: "dc_posts summary", env: {} });
    } catch (error) {
      return error;
    }
    throw new Error("expected the consent to be refused");
  },
  // Reserved for `nextly migrate`'s check of applied files, which the guides document; nothing
  // raises them yet, so each case is the error as that check is to raise it.
  MIGRATION_TAMPERED: () =>
    new CliError("MIGRATION_TAMPERED", {
      what: "`20261020_120000_add_posts.sql` has changed since it was applied, so `nextly migrate` ran nothing.",
      why: "Its checksum no longer matches the one recorded when it ran on this database.",
      next: "Restore the file as it was when it ran, and put the change in a new migration with `nextly migrate:create`.",
    }),
  MIGRATION_MISSING: () =>
    new CliError("MIGRATION_MISSING", {
      what: "`20261020_120000_add_posts.sql` is recorded as applied, but its file is not in the migrations folder.",
      why: "It ran on this database and no removal of it is recorded, so the folder may be from an older build.",
      next: "Restore the file from version control, or deploy the build that has it, then run `nextly migrate` again.",
    }),
  // As `baselineCore` in `cli/commands/migrate-baseline.ts` throws it.
  BASELINE_LOCK_RELEASED: () =>
    new NextlyError({
      code: "NEXTLY_BASELINE_LOCK_NOT_HELD",
      publicMessage:
        "The migrate lock was released without adopting the database. " +
        "Nothing was written; retry once no other schema operation is running.",
    }),
  // As `runMigrateResolve` in `cli/commands/migrate-resolve.ts` throws it.
  RESOLVE_LOCK_RELEASED: () =>
    new NextlyError({
      code: "NEXTLY_RESOLVE_LOCK_NOT_HELD",
      publicMessage:
        "The migrate lock was released without resolving the migration. " +
        "Nothing was written; retry once no other schema operation is running.",
    }),
  // As `assertNoBuilderFilesWithoutSnapshot` in `cli/commands/migrate.ts` throws it.
  BUILDER_MIGRATION_SNAPSHOT_MISSING: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
      publicMessage:
        `nextly migrate does not apply a Schema Builder migration file with no snapshot. ` +
        builderMigrationRemedy(BUILDER_FILE),
      logContext: { files: [BUILDER_FILE] },
    }),
  RESOLVE_SNAPSHOT_MISSING: () => resolving({ mode: "applied" }),
  RESOLVE_FILE_NOT_FOUND: () =>
    resolving({
      mode: "applied",
      fileExists: () => Promise.resolve(false),
    }),
  RESOLVE_PLUGIN_MODULE: () =>
    resolving({ mode: "applied", filename: "plugin:@acme/blog/001_init" }),
  RESOLVE_NOT_APPLIED: () => resolving({ mode: "rolled-back" }),
  RESOLVE_NOTHING_TO_CLEAN_UP: () => resolving({ mode: "failed-cleanup" }),
  RESOLVE_SCHEMA_MISMATCH: () =>
    resolving({
      mode: "applied",
      loadTargetSnapshot: () => Promise.resolve(POSTS),
      introspectLive: () => Promise.resolve({ tables: [] }),
    }),
  RESOLVE_MODE_REQUIRED: () => resolveModeRequired(0),
  LEGACY_BOOKKEEPING_FOUND: () =>
    thrown(() =>
      assertNoLegacyBookkeeping({
        tableExists: name => Promise.resolve(name === "nextly_migrations"),
      })
    ),
  // As `reconcileCore` in `domains/schema/migrate/core-reconcile.ts` throws it in production-strict
  // mode, with the classifier's reasons.
  CORE_DESTRUCTIVE_CHANGE_REFUSED: () =>
    new NextlyError({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      publicMessage:
        "Core schema reconciliation requires destructive operations: " +
        "drops column 'nextly_users.legacy_role'; drops table 'nextly_sessions_old'" +
        ". This usually means a Nextly version mismatch. Set " +
        "NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to proceed (see release notes).",
    }),
  // As `reconcileCore` throws it when the prompt is declined.
  CORE_DESTRUCTIVE_CHANGE_DECLINED: () =>
    new NextlyError({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      publicMessage:
        "Core schema reconciliation aborted: destructive operations were not confirmed: " +
        "drops column 'nextly_users.legacy_role'" +
        ".",
    }),
  // As `reconcileCore` throws it when the core apply fails.
  CORE_SCHEMA_APPLY_FAILED: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage:
        'Core schema apply failed: column "role" of relation "nextly_users" contains null values',
    }),
  // As `runInSync` in `domains/schema/migrate/drift-reconcile.ts` throws it.
  MIGRATION_APPLY_FAILED: () => {
    const cause = new Error('relation "dc_authors" does not exist');
    return new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Migration ${FILE.replace(/\.sql$/, "")} failed: ${cause.message}`,
      cause,
    });
  },
  MIGRATION_DRIFT: () =>
    migrationDriftError({
      migration: FILE.replace(/\.sql$/, ""),
      file: `${MIGRATIONS}/${FILE}`,
      driftItems: [
        { kind: "+", detail: "column 'dc_posts.subtitle' present in DB" },
        { kind: "-", detail: "column 'dc_posts.summary' absent from DB" },
      ],
    }),
  DATABASE_NOT_BASELINED: () =>
    migrationDriftError({
      migration: "20261020_120000_000_initial",
      file: `${MIGRATIONS}/20261020_120000_000_initial.sql`,
      driftItems: [{ kind: "+", detail: "table 'dc_posts' present in DB" }],
      unadoptedDatabase: true,
    }),
  MIGRATION_CONCURRENT_RUN: () =>
    concurrentRunError({ filename: FILE, direction: "up", partial: false }),
  MIGRATION_ATTEMPT_UNFINISHED: () =>
    thrown(() =>
      assertNotPartiallyApplied(
        { filename: FILE, transaction: false },
        "postgresql",
        { findFileApplies: () => Promise.resolve([FAILED_ATTEMPT]) },
        "rerun"
      )
    ),
  // As `partialFailure` in `domains/schema/migrate/migration-transaction.ts` builds it.
  MIGRATION_PARTIALLY_APPLIED: () => {
    const cause = new Error(
      'column "summary" of relation "dc_posts" already exists'
    );
    return new NextlyError({
      code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
      publicMessage:
        `${FILE} ran outside a transaction, and its statement 3 of 4 failed. ` +
        "The 2 statement(s) before it stayed applied, and were not undone. " +
        `If you finish its remaining statements by hand, mark it applied with \`nextly migrate:resolve --applied ${FILE}\` rather than running it again; ` +
        `if you reverse the statements that ran, run \`nextly migrate:resolve --failed-cleanup ${FILE}\` and then \`nextly migrate\` again.`,
      logMessage: `${FILE}: statement 3 of 4 failed: ${cause.message}`,
      logContext: {
        source: FILE,
        failedStatement: 3,
        statements: 4,
        reason: "partially-applied",
      },
      cause,
    });
  },
  // As `executeTransaction` in `domains/schema/migrate/migration-transaction.ts` has
  // `refusingNewDanglingReferences` throw it on SQLite.
  MIGRATION_FOREIGN_KEY_VIOLATION: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      publicMessage:
        "This migration would leave 3 row(s) referencing rows that do not exist (dc_posts → dc_authors). It was rolled back, and nothing was applied.",
      logContext: {
        reason: "dangling-reference",
        added: [{ table: "dc_posts", parent: "dc_authors", rows: 3 }],
      },
    }),
  // As `assertForeignKeysOff` in `domains/schema/migrate/migration-transaction.ts` throws it.
  SQLITE_FOREIGN_KEYS_STILL_ON: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      publicMessage:
        "Foreign-key enforcement could not be switched off for this migration, because another transaction was open on the connection. Nothing was applied; re-run it once that transaction has finished.",
      logContext: { reason: "enforcement-still-on" },
    }),
  MIGRATION_IRREVERSIBLE: () =>
    refusalOf(
      { filename: FILE, downSql: "", transaction: true, statements: [] },
      { dialect: "postgresql", options: {} }
    ),
  // As `migrateDownCore` in `cli/commands/migrate-down.ts` throws it.
  PRODUCTION_ROLLBACK_UNCONFIRMED: () =>
    NextlyError.invalidInput({
      message:
        "Refusing to roll back in production without --yes. Prefer rolling forward with a corrective migration, or restore from backup. Re-run with --yes to override.",
      logContext: { reason: "production-needs-yes" },
    }),
  MIGRATION_FILE_EDITED: () =>
    migrationFileEdited(
      FILE,
      "9f2c4e1a7b3d5f60812a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d",
      "3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d"
    ),
  MIGRATION_SNAPSHOT_MISSING: () =>
    migrationSnapshotMissing(FILE, `${MIGRATIONS}/meta`),
  MIGRATION_SNAPSHOT_INVALID: () => {
    try {
      parseSnapshotFile("{", "20261020_120000_add_posts.snapshot.json");
    } catch (error) {
      return migrationSnapshotInvalid(
        error instanceof Error ? error.message : String(error)
      );
    }
    throw new Error("expected the snapshot to be refused");
  },
  SNAPSHOT_WITHOUT_MIGRATION: () =>
    snapshotWithoutMigration(
      "20261020_120000_add_posts.snapshot.json",
      "20261020_120000_add_posts"
    ),
  SCHEMA_CHANGE_WITHOUT_MIGRATION: () =>
    schemaChangeWithoutMigration(2, [
      "+ add_column dc_posts.subtitle (text)",
      "+ add_table dc_authors",
    ]),
  SETTINGS_CHANGE_WITHOUT_MIGRATION: () =>
    settingsChangeWithoutMigration(1, ["~ posts: labels.singular"]),
} satisfies ErrorCases;
