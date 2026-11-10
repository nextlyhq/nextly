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
import * as path from "node:path";

import { Option, type Command } from "commander";

import type { Logger } from "./utils/logger";

/** The help line `--dry-run` carries on every command. */
export const DRY_RUN_HELP = "Show what would change; change nothing";

/**
 * Adds `--dry-run` to `command`, off unless given. `conflicts` names the
 * command's options a dry run cannot be combined with, such as a `--check`
 * whose own exit code would override the dry run's: given together, the run
 * is refused before anything is read or written.
 */
export function withDryRun(
  command: Command,
  { conflicts = [] }: { conflicts?: string[] } = {}
): Command {
  return command.addOption(
    new Option("--dry-run", DRY_RUN_HELP).conflicts(conflicts)
  );
}

/** One change the real run would make, by what it does to what. */
export interface DryRunChange {
  /**
   * The verb after "Would": mostly write, edit, remove, run, record or set,
   * and otherwise the verb the real run's own description of the change
   * starts with, such as an upgrade step's.
   */
  action: string;
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
export function reportDryRun(
  logger: Pick<Logger, "info">,
  plan: DryRunPlan
): void {
  for (const line of dryRunLines(plan)) logger.info(line);
}

/**
 * A file as a dry run names it: its path from the project folder `cwd`, with
 * `/` between its parts on every operating system, so the plan reads the same
 * on Windows as anywhere else. `syntax` is the path module that reads both
 * paths, the running system's unless a test names one.
 */
export function projectPath(
  cwd: string,
  file: string,
  syntax: Pick<typeof path, "relative" | "sep"> = path
): string {
  return syntax.relative(cwd, file).split(syntax.sep).join("/");
}
