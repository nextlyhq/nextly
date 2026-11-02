/**
 * `nextly telemetry` - manage CLI telemetry consent.
 *
 * Sub-commands: status, enable, disable, reset.
 */

import * as telemetry from "@nextlyhq/telemetry";

import { CLI_VERSION } from "../program";

export { registerTelemetryCommand } from "./telemetry.command";

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

/** The action of `nextly telemetry status`, loaded when it runs. */
export async function telemetryStatusAction(): Promise<void> {
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
}

/** The action of `nextly telemetry enable`, loaded when it runs. */
export async function telemetryEnableAction(): Promise<void> {
  await withTelemetry(() => {
    telemetry.setEnabled(true);
    console.log("Telemetry enabled. Thanks for helping improve Nextly.");
  });
}

/** The action of `nextly telemetry disable`, loaded when it runs. */
export async function telemetryDisableAction(): Promise<void> {
  await withTelemetry(() => {
    telemetry.setEnabled(false);
    console.log("Telemetry disabled.");
  });
}

/** The action of `nextly telemetry reset`, loaded when it runs. */
export async function telemetryResetAction(): Promise<void> {
  await withTelemetry(() => {
    telemetry.resetConsent();
    console.log(
      "Telemetry consent reset. The first-run notice will show again."
    );
  });
}
