/**
 * The declaration of `nextly telemetry` and its subcommands, with each action
 * loaded from `./telemetry` only when it runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { declareFirstLine, OWN_LINE } from "../first-line";
import { lazyAction } from "../lazy-action";

/**
 * Registers `nextly telemetry`. Each subcommand that changes the user's
 * setting takes `--dry-run`, with the one meaning and help line it has
 * everywhere.
 */
export function registerTelemetryCommand(program: Command): void {
  const cmd = program
    .command("telemetry")
    .description("Manage anonymous CLI telemetry");

  declareFirstLine(
    cmd
      .command("status")
      .description("Show whether telemetry is enabled and why")
      .action(
        lazyAction(
          async () => (await import("./telemetry")).telemetryStatusAction
        )
      ),
    OWN_LINE
  );

  declareFirstLine(
    withDryRun(
      cmd.command("enable").description("Enable telemetry for this user")
    ).action(
      lazyAction(
        async () => (await import("./telemetry")).telemetryEnableAction
      )
    ),
    OWN_LINE
  );

  declareFirstLine(
    withDryRun(
      cmd.command("disable").description("Disable telemetry for this user")
    ).action(
      lazyAction(
        async () => (await import("./telemetry")).telemetryDisableAction
      )
    ),
    OWN_LINE
  );

  declareFirstLine(
    withDryRun(
      cmd
        .command("reset")
        .description("Reset the anonymous ID and re-show the first-run notice")
    ).action(
      lazyAction(async () => (await import("./telemetry")).telemetryResetAction)
    ),
    OWN_LINE
  );
}
