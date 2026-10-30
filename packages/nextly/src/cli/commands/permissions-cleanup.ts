import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { Command } from "commander";

import { PermissionSeedService } from "../../domains/auth/services/permission-seed-service";
import { exitWithError } from "../errors";
import { createContext } from "../program";
import { createCliAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import { databaseEnvOrThrow } from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";

/**
 * CLI command to cleanup orphaned permissions
 *
 * Usage: nextly permissions:cleanup
 */
export function createPermissionsCleanupCommand(): Command {
  const command = new Command("permissions:cleanup")
    .description("Remove permissions for deleted collections and singles")
    .action(async (_cmdOptions: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      let adapter: CLIDatabaseAdapter | null = null;

      try {
        console.log("🧹 Starting orphaned permissions cleanup...\n");
        context.logger.info("Loading Nextly configuration...");

        await loadConfig({
          configPath: context.configPath ?? "./nextly.config.ts",
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

        const drizzleAdapter = adapter as unknown as DrizzleAdapter;

        const permissionSeedService = new PermissionSeedService(
          drizzleAdapter,
          context.logger
        );

        context.logger.info("📊 Scanning for orphaned permissions...\n");

        const result = await permissionSeedService.cleanupOrphanedPermissions();

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
    });

  return command;
}
