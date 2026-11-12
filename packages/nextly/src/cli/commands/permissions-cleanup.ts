import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import {
  PermissionSeedService,
  type SeedResult,
} from "../../domains/auth/services/permission-seed-service";
import {
  assertNoMigrationInFlight,
  withMigrationExcluded,
} from "../../domains/field-groups/migration/sync-guard";
import type { Logger } from "../../shared/types";
import { reportDryRun } from "../dry-run";
import { exitWithError, toCliError } from "../errors";
import { createContext } from "../program";
import { openCommandAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  judgeDataLossWithGrace,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import type { Logger as CliLogger } from "../utils/logger";

/**
 * Delete every orphaned permission, holding the schema lock throughout.
 *
 * A permission is orphaned when no collection, single or component in the registry names its
 * resource. That is a judgement on the registry, so it is read under the same lock every schema
 * change takes: a migration, a sync or a promote that registers an entity while this runs would
 * otherwise have its fresh permissions judged against the registry as it stood before, and
 * deleted. The registry read and the deletes all happen inside the lock, never before it, taken as
 * `db:sync` and a Schema Builder save take it (`withMigrationExcluded`).
 *
 * - A held lock is waited for, about a minute, and then the run stops with
 *   `NEXTLY_MIGRATE_LOCK_BUSY` naming the holder, having deleted nothing.
 * - While a field-group storage migration has stopped part way, the run is refused, changing
 *   nothing, with the message `db:sync` gives: mid-migration the registry's slugs can name storage
 *   neither layout matches, so no permission can be judged orphaned.
 * - The lock tables are never created: the cleanup deletes rows and issues no DDL, so a role with
 *   SELECT and DELETE rights but none for DDL keeps the command. The lock is taken wherever its
 *   table exists; a database without one has never run a schema change of this version.
 * - An interrupt does not hand the claim away while the deletes run: the orphans are judged once
 *   and then deleted row by row, each its grants and then itself, outside any one transaction, and
 *   the signal does not stop that loop. Released early, a migration could register an entity and
 *   seed its permissions while the remaining deletes still act on the judgement made before. A
 *   killed process's claim lapses within one lease instead.
 */
/** The command as the lock and its refusals name it. */
const CLEANUP_LABEL = "nextly permissions:cleanup";

export async function cleanupOrphanedPermissionsUnderLock(args: {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** How long a held lock is waited for, in milliseconds. */
  lockWaitMs?: number;
}): Promise<SeedResult> {
  const { adapter, logger } = args;
  return withMigrationExcluded(
    {
      adapter,
      logger,
      label: CLEANUP_LABEL,
      whenHeld: "wait",
      mayCreateLock: false,
      releaseOnInterrupt: false,
      ...(args.lockWaitMs !== undefined ? { waitMs: args.lockWaitMs } : {}),
    },
    () =>
      new PermissionSeedService(adapter, logger).cleanupOrphanedPermissions()
  );
}

/**
 * The action of `nextly permissions:cleanup`, loaded when it runs. It deletes
 * permissions and their grants, so it takes the data-loss consent before it
 * connects, with this release's grace for a run nobody can be asked in.
 */
export async function permissionsCleanupAction(
  cmdOptions: { acceptDataLoss?: AcceptDataLossOption; dryRun?: boolean },
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  let adapter: CLIDatabaseAdapter | null = null;

  try {
    console.log("🧹 Starting orphaned permissions cleanup...\n");
    context.logger.info("Loading Nextly configuration...");

    await loadConfig({
      configPath: context.configPath ?? "./nextly.config.ts",
    });

    // A dry run deletes nothing, so it asks for no consent.
    const dryRun = cmdOptions.dryRun === true;
    if (!dryRun) {
      await judgeDataLossWithGrace({
        command: "permissions:cleanup",
        deletions: [
          { kind: "rows", table: "permissions" },
          { kind: "rows", table: "role_permissions" },
        ],
        consent: readDataLossConsent({
          flag: cmdOptions.acceptDataLoss,
          warn: message => context.logger.warn(message),
        }),
        print: line => context.logger.info(line),
        warn: message => context.logger.warn(message),
      });
    }

    context.logger.info("Validating database environment...");
    const dbValidation = databaseEnvOrThrow();
    const dialect = dbValidation.dialect;

    context.logger.info("Creating database adapter...");
    // A failure here already carries its code: `createCliAdapter` gives it one.
    // A dry run opens read-only, and one whose database is not there has said
    // so and ends here.
    const opened = await openCommandAdapter(
      {
        dialect,
        databaseUrl: dbValidation.databaseUrl,
        logger: context.options.verbose ? context.logger : undefined,
        dryRun,
      },
      context.logger
    );
    if (opened === undefined) process.exit(0);
    adapter = opened;

    context.logger.success("✅ Database connected\n");

    // The CLI adapter is structurally a DrizzleAdapter, as every command that hands it to a
    // service treats it.
    await runPermissionsCleanup(
      adapter as unknown as DrizzleAdapter,
      context.logger,
      { dryRun }
    );

    await adapter.disconnect();
    process.exit(0);
  } catch (error) {
    if (adapter) {
      await adapter.disconnect();
    }
    exitWithError(context.logger, error);
  }
}

/**
 * Deletes the permissions no collection, Single or component declares any
 * more, with their grants, under the schema lock, and reports what was done.
 * A dry run names each one the real run deletes, from the same listing, and
 * deletes nothing and takes no lock.
 */
export async function runPermissionsCleanup(
  adapter: DrizzleAdapter,
  logger: CliLogger,
  { dryRun }: { dryRun: boolean }
): Promise<void> {
  if (dryRun) {
    // The precondition the real run asks once it holds the lock, asked here without taking it: it
    // only reads the migration marker. A storage migration in flight is the real run's refusal.
    try {
      await assertNoMigrationInFlight({
        adapter,
        logger,
        action: CLEANUP_LABEL,
      });
    } catch (error) {
      const refused = toCliError(error);
      if (refused.code !== "FIELD_GROUP_MIGRATION_IN_FLIGHT") throw error;
      reportDryRun(logger, { changes: [], refusals: [refused.what] });
      return;
    }
    const orphaned = await new PermissionSeedService(
      adapter,
      logger
    ).findOrphanedPermissions();
    reportDryRun(logger, {
      changes: orphaned.map(permission => ({
        action: "remove",
        target: `permission ${permission.slug} and its grants`,
      })),
    });
    return;
  }

  logger.info("📊 Scanning for orphaned permissions...\n");

  // The CLI adapter is structurally a DrizzleAdapter, as every command that hands it to a
  // service treats it.
  const result = await cleanupOrphanedPermissionsUnderLock({
    adapter,
    logger,
  });

  console.log("\n" + "=".repeat(60));
  logger.success("Cleanup complete!");
  console.log("=".repeat(60));
  console.log(`   📋 Total orphaned permissions found: ${result.total}`);
  console.log(`   ✅ Successfully deleted: ${result.created}`);
  console.log(`   ⚠️  Skipped (errors): ${result.skipped}`);
  console.log(`   ❌ Errors: ${result.errors}`);
  console.log("=".repeat(60));

  if (result.created > 0) {
    logger.success(
      "\n✨ Your permissions table has been cleaned up successfully!"
    );
    logger.info("Refresh your admin panel to see the changes.");
  } else if (result.total === 0) {
    logger.success(
      "\n✨ No orphaned permissions found. Your database is clean!"
    );
  } else {
    logger.warn(
      "\n⚠️  Some permissions could not be deleted. Check the logs above for details."
    );
  }
}
