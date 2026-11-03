import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import {
  PermissionSeedService,
  type SeedResult,
} from "../../domains/auth/services/permission-seed-service";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { NextlyError } from "../../errors/nextly-error";
import type { Logger } from "../../shared/types";
import { exitWithError } from "../errors";
import { createContext } from "../program";
import { createCliAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  judgeDataLossWithGrace,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";

/**
 * Delete every orphaned permission, holding the schema lock throughout.
 *
 * A permission is orphaned when no collection, single or component in the registry names its
 * resource. That is a judgement on the registry, so it is read under the same lock every schema
 * change takes: a migration, a sync or a promote that registers an entity while this runs would
 * otherwise have its fresh permissions judged against the registry as it stood before, and
 * deleted. The registry read and the deletes all happen inside `withMigrateLock`, never before it.
 *
 * A held lock is waited for, about a minute, and then the run stops with
 * `NEXTLY_MIGRATE_LOCK_BUSY` naming the holder, having deleted nothing.
 */
export async function cleanupOrphanedPermissionsUnderLock(args: {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** How long a held lock is waited for, in milliseconds. */
  lockWaitMs?: number;
}): Promise<SeedResult> {
  const { adapter, logger } = args;
  const outcome = await withMigrateLock(
    adapter,
    adapter.getCapabilities().dialect,
    () =>
      new PermissionSeedService(adapter, logger).cleanupOrphanedPermissions(),
    {
      command: "nextly permissions:cleanup",
      mode: "wait",
      waitMs: args.lockWaitMs,
      logger: {
        warn: (m: string) => logger.warn(m),
        info: (m: string) => logger.info(m),
      },
    }
  );
  // `ran: false` comes only from an `isSettled` wait, which this does not ask for: reporting a
  // count here would claim a cleanup that never ran.
  if (!outcome.ran) {
    throw NextlyError.internal({
      logContext: {
        reason: "schema lock settled without a settle check",
        command: "nextly permissions:cleanup",
      },
    });
  }
  return outcome.value;
}

/**
 * The action of `nextly permissions:cleanup`, loaded when it runs. It deletes
 * permissions and their grants, so it takes the data-loss consent before it
 * connects, with this release's grace for a run nobody can be asked in.
 */
export async function permissionsCleanupAction(
  cmdOptions: { acceptDataLoss?: AcceptDataLossOption },
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

    context.logger.info("Validating database environment...");
    const dbValidation = databaseEnvOrThrow();
    const dialect = dbValidation.dialect;

    context.logger.info("Creating database adapter...");
    // A failure here already carries its code: `createCliAdapter` gives it one.
    adapter = await createCliAdapter({
      dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: context.options.verbose ? context.logger : undefined,
    });

    context.logger.success("✅ Database connected\n");

    context.logger.info("📊 Scanning for orphaned permissions...\n");

    // The CLI adapter is structurally a DrizzleAdapter, as every command that hands it to a
    // service treats it.
    const result = await cleanupOrphanedPermissionsUnderLock({
      adapter: adapter as unknown as DrizzleAdapter,
      logger: context.logger,
    });

    console.log("\n" + "=".repeat(60));
    context.logger.success("Cleanup complete!");
    console.log("=".repeat(60));
    console.log(`   📋 Total orphaned permissions found: ${result.total}`);
    console.log(`   ✅ Successfully deleted: ${result.created}`);
    console.log(`   ⚠️  Skipped (errors): ${result.skipped}`);
    console.log(`   ❌ Errors: ${result.errors}`);
    console.log("=".repeat(60));

    if (result.created > 0) {
      context.logger.success(
        "\n✨ Your permissions table has been cleaned up successfully!"
      );
      context.logger.info("Refresh your admin panel to see the changes.");
    } else if (result.total === 0) {
      context.logger.success(
        "\n✨ No orphaned permissions found. Your database is clean!"
      );
    } else {
      context.logger.warn(
        "\n⚠️  Some permissions could not be deleted. Check the logs above for details."
      );
    }

    await adapter.disconnect();
    process.exit(0);
  } catch (error) {
    if (adapter) {
      await adapter.disconnect();
    }
    exitWithError(context.logger, error);
  }
}
