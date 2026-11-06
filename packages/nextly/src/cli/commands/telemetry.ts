/**
 * `nextly telemetry` - manage CLI telemetry consent.
 *
 * Sub-commands: status, enable, disable, reset.
 */

import * as telemetry from "@nextlyhq/telemetry";
import type { Command } from "commander";

import { createContext, type GlobalOptions } from "../context";
import { reportDryRun } from "../dry-run";
import { CLI_VERSION } from "../program";

/** The options of `enable`, `disable` and `reset`. */
export interface TelemetryChangeOptions {
  /** Name the setting it would change; change nothing. @default false */
  dryRun?: boolean;
}

/**
 * A change to the user's telemetry setting: what it sets, as a dry run names
 * it, how the real run makes it, and what the real run says once done.
 */
interface SettingChange {
  sets: readonly string[];
  apply: () => void;
  done: string;
}

const ENABLE: SettingChange = {
  sets: ["telemetry to enabled for this user"],
  apply: () => telemetry.setEnabled(true),
  done: "Telemetry enabled. Thanks for helping improve Nextly.",
};

const DISABLE: SettingChange = {
  sets: ["telemetry to disabled for this user"],
  apply: () => telemetry.setEnabled(false),
  done: "Telemetry disabled.",
};

// A reset replaces the whole stored consent with a fresh one, which is
// enabled and has not shown the notice: each of those is a change it makes.
const RESET: SettingChange = {
  sets: [
    "a new anonymous telemetry ID for this user",
    "telemetry to enabled for this user",
    "the first-run telemetry notice to show again",
  ],
  apply: () => telemetry.resetConsent(),
  done: "Telemetry consent reset. The first-run notice will show again.",
};

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

/**
 * Makes `change`, or under `--dry-run` names it. A dry run does not open the
 * consent store: opening it writes the file when there is none yet.
 */
async function changeSetting(
  change: SettingChange,
  options: TelemetryChangeOptions,
  cmd: Command
): Promise<void> {
  if (options.dryRun) {
    const globals: GlobalOptions = cmd.optsWithGlobals();
    reportDryRun(createContext(globals).logger, {
      changes: change.sets.map(target => ({ action: "set", target })),
    });
    return;
  }
  await withTelemetry(() => {
    change.apply();
    console.log(change.done);
  });
}

/** The action of `nextly telemetry enable`, loaded when it runs. */
export async function telemetryEnableAction(
  options: TelemetryChangeOptions,
  cmd: Command
): Promise<void> {
  await changeSetting(ENABLE, options, cmd);
}

/** The action of `nextly telemetry disable`, loaded when it runs. */
export async function telemetryDisableAction(
  options: TelemetryChangeOptions,
  cmd: Command
): Promise<void> {
  await changeSetting(DISABLE, options, cmd);
}

/** The action of `nextly telemetry reset`, loaded when it runs. */
export async function telemetryResetAction(
  options: TelemetryChangeOptions,
  cmd: Command
): Promise<void> {
  await changeSetting(RESET, options, cmd);
}
