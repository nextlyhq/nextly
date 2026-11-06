/**
 * Webhooks Prune Command
 *
 * Implements `nextly webhooks:prune` — run a single webhook retention pass by
 * hand. The queue tables (`nextly_events`, `nextly_webhook_deliveries`) are
 * normally pruned opportunistically on content writes and by the drain, but a
 * self-hoster without a running drain (for example, a cron-driven deploy) needs
 * a manual trigger. `--dry-run` reports what a pass would remove without
 * deleting. A pass that deletes takes the data-loss consent
 * (`--accept-data-loss`, or `NEXTLY_ACCEPT_DATA_LOSS`), with this release's
 * grace for a run nobody can be asked in. The command name is `webhooks:prune` because `prune` already drops
 * orphaned collection schema.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/webhooks-prune
 * @example
 * ```bash
 * nextly webhooks:prune                     # asks first at a terminal
 * nextly webhooks:prune --accept-data-loss  # prune without asking
 * nextly webhooks:prune --dry-run           # report what would be removed
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { pruneWebhookData } from "../../domains/webhooks/prune";
import { exitWithError } from "../errors";
import { createContext, type CommandContext } from "../program";
import {
  openOrConnect,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import {
  judgeDataLossWithGrace,
  readDataLossConsent,
  type AcceptDataLossOption,
} from "../utils/data-loss-consent";
import { installRegistryResolver } from "../utils/registry-resolver";

interface WebhooksPruneCommandOptions {
  dryRun?: boolean;
  acceptDataLoss?: AcceptDataLossOption;
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

  // Resolve the policy before requiring a database: a disabled-retention install
  // should report that and exit cleanly even with no DATABASE_URL configured.
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

  // A pass that deletes is consented to before the database is reached; a
  // dry run deletes nothing and needs none.
  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    await judgeDataLossWithGrace({
      command: "webhooks:prune",
      deletions: [
        { kind: "rows", table: "nextly_events" },
        { kind: "rows", table: "nextly_webhook_deliveries" },
      ],
      consent: readDataLossConsent({
        flag: options.acceptDataLoss,
        warn: message => logger.warn(message),
      }),
      print: line => logger.info(line),
      warn: message => logger.warn(message),
    });
  }

  const dbValidation = requireDatabaseEnv(logger);
  const configuredDialect = dbValidation.dialect;

  const adapter = await openOrConnect(
    { dialect: configuredDialect, databaseUrl: dbValidation.databaseUrl },
    dryRun,
    logger
  );
  if (adapter === undefined) return;

  try {
    // The ORM resolves table names through a SchemaRegistry, and this command
    // creates none of its own. The webhook queue tables are static system
    // tables, so the static registration alone is enough (no component sweep).
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;
    installRegistryResolver(drizzleAdapter);

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

/** The action of `nextly webhooks:prune`, loaded when it runs. */
export async function webhooksPruneAction(
  cmdOptions: { dryRun?: boolean; acceptDataLoss?: AcceptDataLossOption },
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);
  try {
    await runWebhooksPruneCommand(
      { ...cmdOptions, config: globalOpts.config, cwd: globalOpts.cwd },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
