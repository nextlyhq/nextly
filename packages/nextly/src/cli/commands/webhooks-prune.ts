/**
 * Webhooks Prune Command
 *
 * Implements `nextly webhooks:prune` — run a single webhook retention pass by
 * hand. The queue tables (`nextly_events`, `nextly_webhook_deliveries`) are
 * normally pruned opportunistically on content writes and by the drain, but a
 * self-hoster without a running drain (for example, a cron-driven deploy) needs
 * a manual trigger. `--dry-run` reports what a pass would remove without
 * deleting. The command name is `webhooks:prune` because `prune` already drops
 * orphaned collection schema.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/webhooks-prune
 * @example
 * ```bash
 * nextly webhooks:prune            # prune aged events + terminal deliveries
 * nextly webhooks:prune --dry-run  # report what would be removed
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import { pruneWebhookData } from "../../domains/webhooks/prune";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

interface WebhooksPruneCommandOptions {
  dryRun?: boolean;
  config?: string;
  cwd?: string;
}

/** Execute the `nextly webhooks:prune` command. */
export async function runWebhooksPruneCommand(
  options: WebhooksPruneCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Webhooks prune");

  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) logger.error(error);
    process.exit(1);
  }

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });

  // The loaded config already resolves the retention policy: `null` means the
  // operator switched retention off (webhooks.retention = false); an absent
  // config resolves to defaults. Only the explicit-off case skips work.
  const policy = configResult.config.webhookRetention;
  if (!policy) {
    logger.info("Webhook retention is disabled (webhooks.retention = false).");
    return;
  }

  let adapter: CLIDatabaseAdapter;
  try {
    adapter = await createAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
    });
  } catch (error) {
    logger.error(`Failed to connect to database: ${describeError(error)}`);
    process.exit(1);
  }

  try {
    // The ORM resolves table names through a SchemaRegistry, and this command
    // creates none of its own. The webhook queue tables are static system
    // tables, so the static registration alone is enough (no component sweep).
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;
    const { dialect } = drizzleAdapter.getCapabilities();
    const schemaRegistry = new SchemaRegistry(dialect);
    schemaRegistry.registerStaticSchemas(getDialectTables(dialect));
    drizzleAdapter.setTableResolver(schemaRegistry);

    const dryRun = options.dryRun ?? false;
    const result = await pruneWebhookData(
      { adapter: drizzleAdapter, logger },
      policy,
      { dryRun }
    );

    const verb = dryRun ? "Would remove" : "Removed";
    logger.info(
      `${verb} ${result.events.webhook} webhook event(s), ` +
        `${result.events.audit} audit event(s), and ` +
        `${result.deliveries} terminal delivery row(s) ` +
        `across ${result.batches} batch(es).`
    );
    if (result.truncated) {
      logger.info(
        "A batch bound stopped this pass before the queue was drained — run again to continue."
      );
    }
  } finally {
    await adapter.disconnect();
  }
}

/** Register the `nextly webhooks:prune` command. */
export function registerWebhooksPruneCommand(program: Command): void {
  program
    .command("webhooks:prune")
    .description(
      "Run a webhook retention pass: prune aged events and terminal deliveries"
    )
    .option(
      "--dry-run",
      "Report what a pass would remove without deleting anything",
      false
    )
    .action(async (cmdOptions: { dryRun?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      try {
        await runWebhooksPruneCommand(
          { ...cmdOptions, config: globalOpts.config, cwd: globalOpts.cwd },
          context
        );
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
