/**
 * `nextly events report` and `nextly events abandon`: an operator's view of
 * plugins' durable event deliveries that need one, and the way to give them
 * up.
 *
 * The report lists the deliveries held for a subscriber that is not
 * registered and those out of attempts, from their own rows, so it answers
 * without any plugin loaded. Abandoning one keeps its record (attempts and
 * last failure), stops it being tried again, and finishes its event once
 * nothing else is owed, so retention can remove it. No row is deleted, so no
 * data-loss consent is asked; `--dry-run` names what would be abandoned.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/events
 * @example
 * ```bash
 * nextly events report
 * nextly events abandon --subscriber @acme/loyalty:award --dry-run
 * nextly events abandon 1b4e28ba-2fa1-11d2-883f-0016d3cca427
 * ```
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { abandonDurableDeliveries } from "../../domains/plugin-events/abandon";
import { reportStuckDeliveries } from "../../domains/plugin-events/report";
import { reportDryRun } from "../dry-run";
import { exitWithError } from "../errors";
import { createContext, type CommandContext } from "../program";
import {
  openOrConnect,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import { installRegistryResolver } from "../utils/registry-resolver";

/**
 * Run `work` on the database, opened read-only when `readOnly`, then close
 * it; nothing when the database could not be opened, which has been said.
 */
async function withDatabase(
  context: CommandContext,
  readOnly: boolean,
  work: (db: DrizzleAdapter) => Promise<void>
): Promise<void> {
  const env = requireDatabaseEnv(context.logger);
  const adapter = await openOrConnect(
    { dialect: env.dialect, databaseUrl: env.databaseUrl },
    readOnly,
    context.logger
  );
  if (adapter === undefined) return;
  try {
    // Both tables are static system tables: the static registration is
    // enough.
    const db = adapter as unknown as DrizzleAdapter;
    installRegistryResolver(db);
    await work(db);
  } finally {
    await adapter.disconnect();
  }
}

/** Execute `nextly events report`. */
export async function runEventsReportCommand(
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Durable event deliveries needing an operator");
  // Read-only: the report changes nothing.
  await withDatabase(context, true, async db => {
    const stuck = await reportStuckDeliveries(db);
    if (stuck.length === 0) {
      logger.info("No delivery is held or out of attempts.");
      return;
    }
    logger.table(
      ["Delivery", "Event", "Subscriber", "Status", "Attempts", "Last error"],
      stuck.map(row => [
        row.id,
        row.eventId,
        row.subscriber,
        row.status,
        row.attemptCount,
        row.lastError ?? "",
      ])
    );
    logger.info(
      "Held: its subscriber is not registered; it runs when the subscriber is registered again. Give one up with `nextly events abandon <delivery>` or `--subscriber <key>`."
    );
  });
}

/** Execute `nextly events abandon`. */
export async function runEventsAbandonCommand(
  deliveryId: string | undefined,
  options: { subscriber?: string; dryRun?: boolean },
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  logger.header("Abandon durable event deliveries");
  const dryRun = options.dryRun ?? false;
  await withDatabase(context, dryRun, async db => {
    const named = await abandonDurableDeliveries(
      db,
      { deliveryId, subscriber: options.subscriber },
      { dryRun }
    );
    if (dryRun) {
      reportDryRun(logger, {
        changes: named.map(row => ({
          action: "abandon",
          target: `delivery ${row.id} to ${row.subscriber} (${row.status})`,
        })),
      });
      return;
    }
    // Said plainly, so a mistyped id or subscriber does not read as done.
    if (named.length === 0) {
      logger.warn(
        "No open delivery matched that is not being run right now; nothing was abandoned. `nextly events report` lists the deliveries that need an operator."
      );
      return;
    }
    for (const row of named) {
      logger.success(`Abandoned delivery ${row.id} to ${row.subscriber}.`);
    }
  });
}

/** The action of `nextly events report`, loaded when it runs. */
export async function eventsReportAction(
  _options: unknown,
  cmd: Command
): Promise<void> {
  const context = createContext(cmd.optsWithGlobals());
  try {
    await runEventsReportCommand(context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly events abandon`, loaded when it runs. */
export async function eventsAbandonAction(
  deliveryId: string | undefined,
  options: { subscriber?: string; dryRun?: boolean },
  cmd: Command
): Promise<void> {
  const context = createContext(cmd.optsWithGlobals());
  try {
    await runEventsAbandonCommand(deliveryId, options, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
