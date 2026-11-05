import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import { reportDryRun } from "../dry-run";
import { exitWithError } from "../errors";
import { createContext } from "../program";
import { openCommandAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  judgeDataLossWithGrace,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import type { Logger } from "../utils/logger";

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
 * more, with their grants, and reports what was done. A dry run names each
 * one the real run deletes, from the same listing, and deletes nothing.
 */
export async function runPermissionsCleanup(
  adapter: DrizzleAdapter,
  logger: Logger,
  { dryRun }: { dryRun: boolean }
): Promise<void> {
  const permissionSeedService = new PermissionSeedService(adapter, logger);

  if (dryRun) {
    const orphaned = await permissionSeedService.findOrphanedPermissions();
    reportDryRun(logger, {
      changes: orphaned.map(permission => ({
        action: "remove",
        target: `permission ${permission.slug} and its grants`,
      })),
    });
    return;
  }

  logger.info("📊 Scanning for orphaned permissions...\n");

  const result = await permissionSeedService.cleanupOrphanedPermissions();

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
