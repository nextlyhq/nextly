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
import { CliError, exitWithError } from "../errors";
import { createContext, type CommandContext } from "../program";
import { openDryRunAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import {
  openOrConnect,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import { installRegistryResolver } from "../utils/registry-resolver";

/** The longest stored value a line of output shows. */
const MAX_SHOWN = 200;

/**
 * A stored value as one printable line: a failure is a plugin's own message,
 * and a newline or a terminal escape in it would split a row or act on the
 * operator's terminal. Each control character becomes a space, and a long
 * value is cut short.
 */
function printable(value: string): string {
  // C0 controls (newline and ESC among them), DEL and the C1 controls, each
  // compared by code point.
  const isControl = (code: number): boolean =>
    code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  const line = Array.from(value, char =>
    isControl(char.codePointAt(0) ?? 0) ? " " : char
  )
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  return line.length > MAX_SHOWN ? `${line.slice(0, MAX_SHOWN - 1)}…` : line;
}

/**
 * How the command opens the database: `report` read-only, failing when the
 * database is not there; `dry-run` read-only, reporting a missing database as
 * a real run's refusal; `write` connected for writing.
 */
type OpenAs = "report" | "dry-run" | "write";

/** The database, opened `as`; undefined when a dry run found none, which it has said. */
async function openDatabase(
  context: CommandContext,
  as: OpenAs
): Promise<CLIDatabaseAdapter | undefined> {
  const env = requireDatabaseEnv(context.logger);
  const connection = { dialect: env.dialect, databaseUrl: env.databaseUrl };
  if (as !== "report") {
    return openOrConnect(connection, as === "dry-run", context.logger);
  }
  // Read-only, but not a dry run: a database that is not there is a failure
  // of the report, not a refusal a real run would make.
  const opened = await openDryRunAdapter(connection);
  if (!("missing" in opened)) return opened;
  throw new CliError("DATABASE_UNREACHABLE", {
    what: "The database to report on is not there.",
    why: opened.missing,
    next: "Check `DATABASE_URL`, and run the command where the application's database is.",
  });
}

/** Run `work` on the database, opened `as`, then close it. */
async function withDatabase(
  context: CommandContext,
  as: OpenAs,
  work: (db: DrizzleAdapter) => Promise<void>
): Promise<void> {
  const adapter = await openDatabase(context, as);
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
  await withDatabase(context, "report", async db => {
    const stuck = await reportStuckDeliveries(db);
    if (stuck.length === 0) {
      logger.info("No delivery is held or out of attempts.");
      return;
    }
    logger.table(
      ["Delivery", "Event", "Subscriber", "Status", "Attempts", "Last error"],
      stuck.map(row => [
        printable(row.id),
        printable(row.eventId),
        printable(row.subscriber),
        printable(row.status),
        row.attemptCount,
        printable(row.lastError ?? ""),
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
  await withDatabase(context, dryRun ? "dry-run" : "write", async db => {
    const named = await abandonDurableDeliveries(
      db,
      { deliveryId, subscriber: options.subscriber },
      { dryRun }
    );
    if (dryRun) {
      reportDryRun(logger, {
        changes: named.map(row => ({
          action: "abandon",
          target: `delivery ${printable(row.id)} to ${printable(row.subscriber)} (${printable(row.status)})`,
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
      logger.success(
        `Abandoned delivery ${printable(row.id)} to ${printable(row.subscriber)}.`
      );
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
