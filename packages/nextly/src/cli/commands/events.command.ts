/**
 * The declaration of `nextly events` and its subcommands, for plugins' durable
 * events: their arguments, options and help, with each action loaded from
 * `./events` only when it runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** Register the `nextly events` command group. */
export function registerEventsCommand(program: Command): void {
  const events = program
    .command("events")
    .description("Inspect and settle plugins' durable event deliveries");

  events
    .command("report")
    .description(
      "List deliveries held for a subscriber that is not registered, or out of attempts"
    )
    .action(
      lazyAction(async () => (await import("./events")).eventsReportAction)
    );

  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    events
      .command("abandon [deliveryId]")
      .description(
        "Give up a delivery, or every open delivery to a subscriber, keeping its record"
      )
  )
    .option(
      "--subscriber <key>",
      "Every open delivery to this subscriber (<plugin>:<name>, as the report shows it)"
    )
    .action(
      lazyAction(async () => (await import("./events")).eventsAbandonAction)
    );
}
