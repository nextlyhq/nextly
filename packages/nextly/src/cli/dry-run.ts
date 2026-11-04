/**
 * `--dry-run`, with the one meaning it has on every command that writes by
 * default: show what would change, change nothing. A command adds the flag
 * through `withDryRun`, builds the same plan its real run would carry out, and
 * prints it through `reportDryRun`, so every dry run reads alike.
 *
 * A dry run takes no lock, asks no confirmation or consent (it deletes
 * nothing), and exits 0. Where the real run would refuse, it says so and
 * still exits 0: the refusal is part of what the real run would do.
 */
import type { Command } from "commander";

import type { Logger } from "./utils/logger";

/** The help line `--dry-run` carries on every command. */
export const DRY_RUN_HELP = "Show what would change; change nothing";

/** Adds `--dry-run` to `command`, off unless given. */
export function withDryRun(command: Command): Command {
  return command.option("--dry-run", DRY_RUN_HELP);
}

/** One change the real run would make, by what it does to what. */
export interface DryRunChange {
  /** The verb after "Would": write, edit, remove, run, record or set. */
  action: "write" | "edit" | "remove" | "run" | "record" | "set";
  /** A path, a command line, a ledger entry or a setting. */
  target: string;
}

/** Everything a dry run reports. */
export interface DryRunPlan {
  /** The changes, in the order the real run would make them. */
  changes: readonly DryRunChange[];
  /** Why the real run would refuse, each as the real run would say it. */
  refusals?: readonly string[];
  /** What the dry run cannot show, such as a plugin hook it does not run. */
  notes?: readonly string[];
}

/** The lines a dry run prints for `plan`, the last saying nothing changed. */
export function dryRunLines(plan: DryRunPlan): string[] {
  const lines = plan.changes.map(
    change => `Would ${change.action} ${change.target}`
  );
  if (lines.length === 0 && (plan.refusals ?? []).length === 0) {
    lines.push("Nothing would change.");
  }
  for (const reason of plan.refusals ?? []) {
    lines.push(`A real run would refuse: ${reason}`);
  }
  lines.push(...(plan.notes ?? []));
  lines.push("Dry run: nothing was changed.");
  return lines;
}

/** Prints `plan` as `dryRunLines` words it. */
export function reportDryRun(logger: Logger, plan: DryRunPlan): void {
  for (const line of dryRunLines(plan)) logger.info(line);
}
