/**
 * `nextly migrate:resolve` — operator recovery command (spec §4.8).
 *
 * Thin CLI shell over `resolveMigration`. Exactly one of --applied /
 * --rolled-back / --failed-cleanup must be supplied. Wrapped in the shared
 * migrate lock (spec §4.6.2). Idempotent operations exit 0 with a message.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-resolve
 * @since v0.0.3-alpha
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import type { SupportedDialect } from "../../database/schema-registry";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { checksumOf } from "../../domains/schema/migrate/applied-checksums";
import { executeTransaction } from "../../domains/schema/migrate/migration-transaction";
import {
  resolveMigration,
  type ResolveMigrationArgs,
  type ResolveMode,
  type ResolveRepo,
} from "../../domains/schema/migrate/resolve";
import { resolveDeclaredSchema } from "../../domains/schema/migrate/resolved-schema";
import { marksNoTransaction } from "../../domains/schema/migrate/split-sql";
import { parseSnapshotFile } from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { snapshotComparableTables } from "../../domains/schema/pipeline/managed-tables";
import { NextlyError } from "../../errors/index";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { exitWithError } from "../errors";
import { resolveModeRequired } from "../errors/areas/migrations";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import { openMigrationCommand } from "../utils/command-prerequisites";
import {
  discoverMigrationGroups,
  selectVariant,
} from "../utils/migration-discovery";

import { commandRun } from "./command-run";
import { maybeForceUnlock } from "./migrate";
import { dryRunRefusalOf } from "./migrate-create";

interface ResolveCommandOptions {
  applied?: string;
  rolledBack?: string;
  failedCleanup?: string;
  /** `--removed <file>`: record an applied migration's file removed on purpose. */
  removed?: string;
  /** `--file-missing`: with `--rolled-back`, the file is gone from the folder. */
  fileMissing?: boolean;
  skipVerify?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
  /** `--dry-run`: run the checks, name the ledger writes, make none. */
  dryRun?: boolean;
}

/**
 * The ledger as a dry run writes to it: reads go to the real ledger, so the
 * resolve's checks see what a real run sees, and each write is named in
 * `changes` instead of made.
 */
function recordingRepo(
  repo: ResolveRepo,
  filename: string,
  changes: DryRunChange[]
): ResolveRepo {
  const record = (target: string): Promise<void> => {
    changes.push({ action: "record", target });
    return Promise.resolve();
  };
  return {
    findFileApplies: name => repo.findFileApplies(name),
    findFileRollbacks: name => repo.findFileRollbacks(name),
    insertEvent: values =>
      record(`a ${String(values.status)} ledger row for ${filename}`).then(
        () => "dry-run"
      ),
    supersede: ({ supersededEventIds }) =>
      supersededEventIds.length === 0
        ? Promise.resolve()
        : record(
            `${supersededEventIds.length} earlier ledger row(s) of ${filename} as superseded`
          ),
    markRolledBack: id =>
      record(`ledger row ${id} of ${filename} as rolled_back`),
    recordChecksum: id =>
      record(`the file's current checksum on ledger row ${id} of ${filename}`),
    recordRemoval: () =>
      record(`the removal of ${filename} from the migrations folder`).then(
        () => "dry-run"
      ),
    listFileRemovals: () => repo.listFileRemovals(),
  };
}

interface ResolvedOptions extends ResolveCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

function pickMode(opts: ResolveCommandOptions): {
  mode: ResolveMode;
  filename: string;
} {
  const chosen = [
    opts.applied !== undefined ? (["applied", opts.applied] as const) : null,
    opts.rolledBack !== undefined
      ? (["rolled-back", opts.rolledBack] as const)
      : null,
    opts.failedCleanup !== undefined
      ? (["failed-cleanup", opts.failedCleanup] as const)
      : null,
    opts.removed !== undefined ? (["removed", opts.removed] as const) : null,
  ].filter((x): x is readonly [ResolveMode, string] => x !== null);

  if (chosen.length !== 1) {
    throw resolveModeRequired(chosen.length);
  }
  const [mode, filename] = chosen[0];
  // `--file-missing` says what `--rolled-back` may assume, and nothing else.
  if (opts.fileMissing === true && mode !== "rolled-back") {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage:
        "--file-missing goes with --rolled-back: it says the file being recorded rolled back is gone from the migrations folder.",
    });
  }
  return { mode, filename };
}

/**
 * The path of the file `nextly migrate` reads for this migration on
 * `dialect`, its dialect's variant before the base file (`selectVariant`), or
 * undefined where the folder has none. Every read here goes through it, so
 * the file recorded is the one the run compares: a project shipping `x.sql`
 * beside `x.postgresql.sql` is recorded from the variant on PostgreSQL.
 */
export async function migrationFileIn(
  dir: string,
  filename: string,
  dialect: SupportedDialect
): Promise<string | undefined> {
  const base = filename.replace(/\.sql$/i, "");
  const group = (await discoverMigrationGroups(dir)).get(base);
  const file = group && selectVariant(group.variants, dialect);
  return file === undefined ? undefined : resolve(dir, file);
}

/**
 * The text of the file `nextly migrate` reads (`migrationFileIn`). Asked only
 * after the file is known to exist, so a read failure here is a real one and
 * travels.
 */
async function migrationTextIn(
  dir: string,
  filename: string,
  dialect: SupportedDialect
): Promise<string> {
  const path = await migrationFileIn(dir, filename, dialect);
  if (path === undefined) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_FILE_MISSING",
      publicMessage: `Migration file not found: ${filename.replace(/\.sql$/i, "")}.sql`,
    });
  }
  return readFile(path, "utf-8");
}

async function loadSnapshot(
  metaDir: string,
  filename: string
): Promise<NextlySchemaSnapshot | null> {
  const base = filename.replace(/\.sql$/, "");
  const file = `${base}.snapshot.json`;
  try {
    const content = await readFile(resolve(metaDir, file), "utf-8");
    return parseSnapshotFile(content, file).snapshot;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * What `--failed-cleanup` reports. Every attempt since the file's last other
 * event that failed or recorded no outcome is cleared together, so it says
 * how many when that is more than one.
 */
function cleanedUpMessage(filename: string, cleared: number): string {
  return cleared === 1
    ? `Cleaned up the failed or unfinished attempt for ${filename}.`
    : `Cleaned up ${cleared} failed or unfinished attempts for ${filename}.`;
}

async function safeListTables(adapter: CLIDatabaseAdapter): Promise<string[]> {
  try {
    return await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
}

export async function runMigrateResolve(
  options: ResolvedOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { mode, filename } = pickMode(options);

  logger.header("Migrate Resolve");

  // A dry run opens the database read-only, and one that is not there has
  // said so and ends here.
  const opened = await openMigrationCommand(options, logger);
  if (opened === undefined) return;
  const { dbValidation, configResult, cwd, migrationsDir, adapter } = opened;
  const dialect = dbValidation.dialect;
  const metaDir = resolve(migrationsDir, "meta");

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const repo = new SchemaEventsRepository(db, dialect);

    // The checks and reads a resolve makes, the same for a real run and a
    // dry run; only where its ledger writes go differs.
    const resolveArgs = {
      mode,
      filename,
      skipVerify: options.skipVerify,
      fileMissing: options.fileMissing === true,
      dialect,
      repo,
      fileExists: async name =>
        (await migrationFileIn(migrationsDir, name, dialect)) !== undefined,
      loadTargetSnapshot: () => loadSnapshot(metaDir, filename),
      marksNoTransaction: async () =>
        marksNoTransaction(
          await migrationTextIn(migrationsDir, filename, dialect)
        ),
      fileChecksum: async () =>
        checksumOf(await migrationTextIn(migrationsDir, filename, dialect)),
      introspectLive: async () => {
        // Config and the Builder manifest, merged as generation merges them,
        // so the verifier excludes the same derived tables the snapshot never
        // held. Resolved HERE rather than before the lock because this
        // callback is its only consumer and a malformed `ui-schema.json`
        // throws: loading it eagerly would take --rolled-back,
        // --failed-cleanup and --skip-verify down with it, and those are the
        // modes an operator reaches for when something is already broken.
        const resolvedSchema = await resolveDeclaredSchema({
          projectRoot: cwd,
          config: configResult.config,
          deferredExtends: configResult.deferredExtends,
        });
        const live = await safeListTables(adapter);
        // Managed main tables only. A localized companion is
        // migration-owned and never appears in a `migrate:create` snapshot,
        // so including one here can never match the file this is compared
        // against and the equivalence check refuses the command.
        // Junctions are excluded for exactly the reason the comment above
        // gives for companions: neither is declared by config, so neither
        // appears in the snapshot this is compared against, and a live
        // snapshot carrying one can never match it. The target's own tables
        // are the declaration, so a collection whose name resembles the
        // generated junction shape is not mistaken for one.
        // The same snapshot `loadTargetSnapshot` returns, read again rather
        // than threaded: it is a file read, and the two callbacks are
        // independent by design so the verifier can be driven without one.
        // A missing snapshot is the verifier's own error to report; here it
        // just means no declaration is available, and the name pattern alone
        // decides.
        const target = await loadSnapshot(metaDir, filename);
        const managed = snapshotComparableTables(
          live,
          new Set((target?.tables ?? []).map(t => t.name)),
          // A custom `options.junctionTable` name matches no convention and
          // is in no snapshot, so without it the verifier compares a live
          // scope containing the junction against a target that never could
          // and refuses a recovery the operator has no other way to make.
          resolvedSchema.knownJunctions
        );
        return introspectLiveSnapshot(db, dialect, managed);
      },
    } satisfies Omit<ResolveMigrationArgs, "atomically">;

    // A dry run takes no lock and clears none: it runs the same checks, and
    // its ledger writes are named, not made.
    if (options.dryRun === true) {
      await previewResolve(resolveArgs, repo, {
        filename,
        forceUnlock: options.forceUnlock === true,
        logger,
      });
      return;
    }

    // Clear a stale lock first when --force-unlock is passed (e.g. left by a
    // crashed prior run): the lock-busy error tells operators to re-run with
    // this flag, and recovery is exactly when a stale lock is most likely.
    await maybeForceUnlock(options, db, dialect);

    const outcome = await withMigrateLock(
      adapter as unknown as DrizzleAdapter,
      dialect,
      () =>
        resolveMigration({
          ...resolveArgs,
          // A mode's ledger writes commit together: a stop between a
          // rolled-back row and its retiring the applied one would leave the
          // file pending with an applied row the next apply's guard trips on.
          atomically: work =>
            executeTransaction(adapter as unknown as DrizzleAdapter, tx =>
              work(repo.boundTo(tx.db))
            ),
        }),
      // A held lock is waited for, about a minute, and then the run stops naming its holder.
      { command: "nextly migrate:resolve", mode: "wait" }
    );

    // A held lock throws rather than reporting `ran: false`, and no `isSettled` is passed, so
    // this branch is unreachable today. Asserted rather than assumed, because
    // "unreachable" is a property of the caller's options and those move.
    if (!outcome.ran) {
      throw new NextlyError({
        code: "NEXTLY_RESOLVE_LOCK_NOT_HELD",
        publicMessage:
          "The migrate lock was released without resolving the migration. " +
          "Nothing was written; retry once no other schema operation is running.",
      });
    }
    const result = outcome.value;

    switch (result.kind) {
      case "applied":
        logger.success(
          `Marked ${filename} as applied${result.supersededFailedId ? " (superseded the prior failed or unfinished attempt)" : ""}.`
        );
        // Said when nothing was compared without the operator asking for
        // that, so the record of what was checked stays honest.
        if (!result.verified && !options.skipVerify) {
          logger.info(
            `${filename} has no snapshot, so the live schema was not compared.`
          );
        }
        break;
      case "checksum-accepted":
        logger.success(
          `Accepted the edit to ${filename}: its new checksum is recorded, and later runs of \`nextly migrate\` go on.`
        );
        break;
      case "rolled-back":
        logger.success(
          `Recorded rolled_back for ${filename}; it will re-run on next migrate.`
        );
        break;
      case "failed-cleanup":
        logger.success(cleanedUpMessage(filename, result.updatedIds.length));
        break;
      case "removed":
        logger.success(
          `Recorded that ${filename} was removed from the migrations folder on purpose. It stays applied, and later runs of \`nextly migrate\` go on.`
        );
        break;
      case "noop":
        logger.info(result.reason);
        break;
    }
  } finally {
    await adapter.disconnect();
  }
}

/**
 * `migrate:resolve --dry-run`: the resolve itself, run with a ledger that
 * reads the real one and names each write instead of making it, so its checks
 * and refusals are the real run's. It takes no lock and clears none; under
 * `--force-unlock` it says the real run would clear the lock first.
 */
async function previewResolve(
  resolveArgs: Omit<ResolveMigrationArgs, "atomically">,
  repo: SchemaEventsRepository,
  {
    filename,
    forceUnlock,
    logger,
  }: {
    filename: string;
    forceUnlock: boolean;
    logger: CommandContext["logger"];
  }
): Promise<void> {
  const changes: DryRunChange[] = forceUnlock
    ? [{ action: "remove", target: "any migrate lock held" }]
    : [];
  try {
    await resolveMigration({
      ...resolveArgs,
      atomically: work => work(recordingRepo(repo, filename, changes)),
    });
  } catch (error) {
    const refusal = dryRunRefusalOf(error);
    if (refusal === undefined) throw error;
    reportDryRun(logger, { changes, refusals: [refusal] });
    return;
  }
  reportDryRun(logger, { changes });
}

/**
 * The action of `nextly migrate:resolve`, loaded when it runs.
 */
export async function migrateResolveAction(
  cmdOptions: ResolveCommandOptions,
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  const resolvedOptions: ResolvedOptions = options;
  try {
    await runMigrateResolve(resolvedOptions, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

export { registerMigrateResolveCommand } from "./migrate-resolve.command";
