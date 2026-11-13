/**
 * Cases for migration runs: the schema lock, the data-loss consent, and the migration files.
 *
 * @module cli/__tests__/error-cases/migrations
 */
import { tableBusyError } from "../../../domains/schema/busy-table/report";
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
import { uniqueIndexNameHeldError } from "../../../domains/schema/migrate/one-to-one-uniques";
import { planChangedAfterConsent } from "../../../domains/schema/migrate/plan-changed-after-consent";
import {
  resolveMigration,
  type ResolveMigrationArgs,
} from "../../../domains/schema/migrate/resolve";
import { uniqueColumnRepeatsError } from "../../../domains/schema/migrate/unique-column-guard";
import { parseSnapshotFile } from "../../../domains/schema/migrate-create/snapshot-io";
import type { NextlySchemaSnapshot } from "../../../domains/schema/pipeline/diff/types";
import { describeHolder } from "../../../domains/schema/pipeline/schema-lock";
import { NextlyError } from "../../../errors/nextly-error";
import {
  appliedFilesMissing,
  oldBuilderFilesChanged,
} from "../../commands/migrate";
import { refusalOf } from "../../commands/migrate-down";
import { CliError, dataLossRefusal, type CliErrorCode } from "../../errors";
import {
  coreDestructiveNeedsTerminal,
  migrationFileEdited,
  migrationSnapshotInvalid,
  migrationSnapshotMissing,
  resolveModeRequired,
  schemaChangeWithoutMigration,
  settingsChangeWithoutMigration,
  snapshotWithoutMigration,
} from "../../errors/areas/migrations";
import { requireConsented } from "../../utils/data-loss-consent";
import { builderMigrationRemedy } from "../../utils/migration-discovery";

import { PROJECT, type ErrorCase, type ErrorCases } from "./types";
import { assertRunnableStatements } from "../../../domains/schema/migrate/split-sql";
import {
  requiredColumnMigrationRefusal,
  uncountedAtStatement,
} from "../../../domains/schema/migrate/required-column-guard";
import { requiredColumnUncountedError } from "../../../domains/schema/required-column-refusal";

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
      findFileRollbacks: () => Promise.resolve([]),
      recordChecksum: () => Promise.resolve(),
      insertEvent: () => Promise.resolve("evt_2"),
      supersede: () => Promise.resolve(),
      markRolledBack: () => Promise.resolve(),
      currentOldBuilderMarks: () => Promise.resolve(new Map()),
      recordRemoval: () => Promise.resolve("evt_3"),
      listFileRemovals: () => Promise.resolve([]),
    },
    fileExists: () => Promise.resolve(true),
    loadTargetSnapshot: () => Promise.resolve(null),
    marksNoTransaction: () => Promise.resolve(false),
    fileChecksum: () => Promise.resolve("a".repeat(64)),
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
  NEXTLY_MIGRATE_LOCK_BUSY: () => {
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
  // As `tableBusyError` builds it once a migration's tries for a busy table run out with nothing
  // of the file left, the holder a PostgreSQL session.
  TABLE_BUSY: () =>
    tableBusyError({
      change: "20261020_120000_add_posts.sql",
      ended: {
        table: "dc_posts",
        holder: {
          kind: "named",
          sessions: [
            {
              id: "4242",
              user: "app",
              clientAddress: "10.0.0.5",
              applicationName: "worker",
              transactionOpenSeconds: 180,
            },
          ],
          unreadable: [],
        },
      },
      tries: 7,
      elapsedMs: 89_600,
      appliedBefore: ["20261019_090000_add_tags.sql"],
      outcome: { kind: "nothing-changed" },
      cause: "table-busy",
      endedAtLease: false,
    }),
  DATA_LOSS_CONSENT_REQUIRED: async () =>
    dataLossRefusal(await refusedVerdict(undefined)),
  DATA_LOSS_CONSENT_NOT_COVERED: async () =>
    dataLossRefusal(await refusedVerdict("dc_authors")),
  // As `runPrune` in `cli/commands/prune.ts` throws it, once a table appeared after the consent.
  PLAN_CHANGED_AFTER_CONSENT: () =>
    planChangedAfterConsent({
      command: "nextly prune",
      message:
        "What `nextly prune` would drop changed after it was agreed to, so nothing was dropped. " +
        "Run `nextly prune` again to see what it would drop now.",
      agreed: ["dc_tags"],
      current: ["dc_tags", "dc_tags_locales"],
    }),
  // The consent's own parser, given a list it cannot read.
  DATA_LOSS_CONSENT_MALFORMED: () => {
    try {
      resolveDataLossConsent({ flag: "dc_posts summary", env: {} });
    } catch (error) {
      return error;
    }
    throw new Error("expected the consent to be refused");
  },
  // As `requireConsented` ends a run whose deletion prompt was answered no.
  DATA_LOSS_DECLINED: () => {
    try {
      requireConsented({ kind: "declined" });
    } catch (error) {
      return error;
    }
    throw new Error("expected the declined deletion to end the run");
  },
  // Reserved for `nextly migrate`'s check of applied files, which the guides document; nothing
  // raises them yet, so each case is the error as that check is to raise it.
  MIGRATION_TAMPERED: () =>
    new CliError("MIGRATION_TAMPERED", {
      what: "`20261020_120000_add_posts.sql` has changed since it was applied, so `nextly migrate` ran nothing.",
      why: "Its checksum no longer matches the one recorded when it ran on this database.",
      next: "Restore the file as it was when it ran, and put the change in a new migration with `nextly migrate:create`.",
    }),
  // As `assertAppliedFilesPresent` in `cli/commands/migrate.ts` throws it.
  MIGRATION_MISSING: () =>
    appliedFilesMissing(
      "nextly migrate",
      ["20261020_120000_add_posts.sql"],
      []
    ),
  // As `oldBuilderFilesChanged` in `cli/commands/migrate.ts` raises it.
  OLD_BUILDER_FILE_SNAPSHOT_ADDED: () =>
    oldBuilderFilesChanged("nextly migrate", [
      {
        file: "1761732000000_create_posts.sql",
        change: "snapshot",
        lacks: ["snapshot"],
      },
    ]),
  // As `oldBuilderFilesChanged` in `cli/commands/migrate.ts` raises it.
  OLD_BUILDER_FILE_VARIANT_ADDED: () =>
    oldBuilderFilesChanged("nextly migrate", [
      {
        file: "1761732000000_create_posts.sql",
        change: "variant",
        lacks: ["variant"],
      },
    ]),
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
  // As `refuseUnrecognisedBuilderFiles` in `cli/commands/migrate.ts` throws it.
  BUILDER_MIGRATION_SNAPSHOT_MISSING: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
      publicMessage:
        `nextly migrate does not apply a file with a Schema Builder name that is not recognised as an earlier Builder's: ` +
        `${BUILDER_FILE}, which has a statement on a table that is not its own entity's, or one that cannot be read. ` +
        builderMigrationRemedy(BUILDER_FILE),
      logContext: { files: [BUILDER_FILE] },
    }),
  NEXTLY_MIGRATION_SNAPSHOT_MISSING: () => resolving({ mode: "applied" }),
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
  NEXTLY_CORE_DESTRUCTIVE_REFUSED: () =>
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
  // As `upgradeAction` in `cli/commands/upgrade.ts` throws it with no terminal to confirm on.
  CORE_DESTRUCTIVE_NEEDS_TERMINAL: () =>
    coreDestructiveNeedsTerminal(["drops column 'nextly_users.legacy_role'"]),
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
  NEXTLY_MIGRATION_CONCURRENT_RUN: () =>
    concurrentRunError({ filename: FILE, direction: "up", partial: false }),
  // As `partialFailure` in `domains/schema/migrate/migration-transaction.ts` builds it.
  NEXTLY_MIGRATION_PARTIALLY_APPLIED: () => {
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
  NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION: () =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
      publicMessage:
        "This migration would leave 3 row(s) referencing rows that do not exist (dc_posts → dc_authors). It was rolled back, and nothing was applied.",
      logContext: {
        reason: "dangling-reference",
        added: [{ table: "dc_posts", parent: "dc_authors", rows: 3 }],
      },
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
  CHECKSUM_MISMATCH: () =>
    migrationFileEdited(
      FILE,
      "9f2c4e1a7b3d5f60812a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d",
      "3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d"
    ),
  MISSING_SNAPSHOT: () => migrationSnapshotMissing(FILE, `${MIGRATIONS}/meta`),
  INVALID_SNAPSHOT: () => {
    try {
      parseSnapshotFile("{", "20261020_120000_add_posts.snapshot.json");
    } catch (error) {
      return migrationSnapshotInvalid(
        error instanceof Error ? error.message : String(error)
      );
    }
    throw new Error("expected the snapshot to be refused");
  },
  MISSING_MIGRATION: () =>
    snapshotWithoutMigration(
      "20261020_120000_add_posts.snapshot.json",
      "20261020_120000_add_posts"
    ),
  SCHEMA_DRIFT: () =>
    schemaChangeWithoutMigration(2, [
      "+ add_column dc_posts.subtitle (text)",
      "+ add_table dc_authors",
    ]),
  SETTINGS_CHANGE_WITHOUT_MIGRATION: () =>
    settingsChangeWithoutMigration(1, ["~ posts: labels.singular"]),
  // The runner's own check, run for real on a file that holds a statement no transaction can.
  REFUSED_STATEMENT: () => {
    try {
      assertRunnableStatements(
        ["VACUUM"],
        "sqlite",
        "20261029_090000_compact.sql"
      );
    } catch (error) {
      return error;
    }
    throw new Error("expected the statements to be refused");
  },
  REQUIRED_COLUMN_HAS_NULLS: () =>
    requiredColumnMigrationRefusal(
      [
        {
          entity: { kind: "collection", slug: "posts" },
          field: "subtitle",
          count: 2,
          added: false,
        },
      ],
      { source: "20261103_101500_posts.sql", dialect: "postgresql" }
    ),
  REQUIRED_COLUMN_UNCOUNTED: () =>
    requiredColumnUncountedError({
      table: "dc_posts",
      field: "subtitle",
      cause: new Error("connection reset"),
    }),
  UNIQUE_COLUMN_HAS_REPEATS: () =>
    uniqueColumnRepeatsError(
      [
        {
          entity: { kind: "collection", slug: "profiles" },
          field: "person",
          table: "dc_profiles",
          column: "person",
          repeats: [
            { value: "3f2c9a1e-7b44-4d2a-9c61-0e5d8b7a2f10", entries: 2 },
          ],
          showValues: true,
        },
      ],
      "20261111_120000_profiles.sql"
    ),
  UNIQUE_INDEX_NAME_TAKEN: () =>
    uniqueIndexNameHeldError([
      "profiles.person (its index uq_dc_profiles_person is the name of the index on dc_people)",
    ]),
} satisfies ErrorCases;

/**
 * The causes that were codes of their own before the guides' documented code was kept for them:
 * each still has its own reading, so each still has its case, under the code it now ends as.
 */
export const MIGRATION_MERGED_CASES: Record<
  string,
  { code: CliErrorCode; make: ErrorCase }
> = {
  // Not a former code: the reading the code has when the count fails part-way through a file,
  // after statements before it ran.
  REQUIRED_COLUMN_UNCOUNTED_AT_A_STATEMENT: {
    code: "REQUIRED_COLUMN_UNCOUNTED",
    make: () =>
      uncountedAtStatement(
        requiredColumnUncountedError({
          table: "dc_posts",
          field: "subtitle",
          cause: new Error("connection reset"),
        }),
        "20261103_101500_posts.sql",
        "mysql",
        {
          index: 1,
          statements: [
            "UPDATE `dc_posts` SET `subtitle` = '' WHERE `id` = 'p2'",
            "ALTER TABLE `dc_posts` MODIFY COLUMN `subtitle` text NOT NULL",
          ],
          transaction: false,
        }
      ),
  },
  // Not a former code: the reading when the table is named through a qualifier that may reach
  // another schema, which nothing counts.
  REQUIRED_COLUMN_UNCOUNTED_THROUGH_A_QUALIFIER: {
    code: "REQUIRED_COLUMN_UNCOUNTED",
    make: () =>
      requiredColumnUncountedError({
        table: "archive.dc_posts",
        field: "subtitle",
        cause: undefined,
        through: "archive",
      }),
  },
  MIGRATION_ATTEMPT_UNFINISHED: {
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    make: () =>
      thrown(() =>
        assertNotPartiallyApplied(
          { filename: FILE, transaction: false },
          "postgresql",
          { findFileApplies: () => Promise.resolve([FAILED_ATTEMPT]) },
          "rerun"
        )
      ),
  },
  SQLITE_FOREIGN_KEYS_STILL_ON: {
    code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
    make: () =>
      new NextlyError({
        code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
        publicMessage:
          "Foreign-key enforcement could not be switched off for this migration, because another transaction was open on the connection. Nothing was applied; re-run it once that transaction has finished.",
        logContext: { reason: "enforcement-still-on" },
      }),
  },
};
