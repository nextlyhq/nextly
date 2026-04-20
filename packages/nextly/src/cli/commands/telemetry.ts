/**
 * `nextly telemetry` - manage CLI telemetry consent.
 *
 * Sub-commands: status, enable, disable, reset.
 */

import * as telemetry from "@nextly/telemetry";
import { Command } from "commander";

import { CLI_VERSION } from "../program.js";

const REASONS: Record<string, string> = {
  DO_NOT_TRACK: "DO_NOT_TRACK=1 is set",
  "env-var": "NEXTLY_TELEMETRY_DISABLED=1 is set",
  production: "NODE_ENV=production",
  ci: "running in CI",
  docker: "running in Docker",
  "non-tty": "stdout is not a TTY",
  config: "disabled in ~/.config/nextly/config.json",
};

async function withTelemetry(fn: () => void | Promise<void>): Promise<void> {
  await telemetry.init({ cliName: "nextly", cliVersion: CLI_VERSION });
  try {
    await fn();
  } finally {
    await telemetry.shutdown();
  }
}

export function registerTelemetryCommand(program: Command): void {
  const cmd = program
    .command("telemetry")
    .description("Manage anonymous CLI telemetry");

  cmd
    .command("status")
    .description("Show whether telemetry is enabled and why")
    .action(async () => {
      await withTelemetry(() => {
        const status = telemetry.getStatus();
        if (!status.disabled) {
          console.log(
            "Telemetry is enabled. See https://nextlyhq.com/docs/telemetry"
          );
          return;
        }
        const reasonText = status.reason
          ? (REASONS[status.reason] ?? status.reason)
          : "unknown";
        console.log(`Telemetry is disabled (${reasonText}).`);
      });
    });

  cmd
    .command("enable")
    .description("Enable telemetry for this user")
    .action(async () => {
      await withTelemetry(() => {
        telemetry.setEnabled(true);
        console.log("Telemetry enabled. Thanks for helping improve Nextly.");
      });
    });

  cmd
    .command("disable")
    .description("Disable telemetry for this user")
    .action(async () => {
      await withTelemetry(() => {
        telemetry.setEnabled(false);
        console.log("Telemetry disabled.");
      });
    });

  cmd
    .command("reset")
    .description("Reset the anonymous ID and re-show the first-run notice")
    .action(async () => {
      await withTelemetry(() => {
        telemetry.resetConsent();
        console.log(
          "Telemetry consent reset. The first-run notice will show again."
        );
      });
    });
}
