/**
 * `--lock-timeout` and `--lock-timeout-total`, with the one meaning they have on every command that
 * runs a schema change: how long one try, and every try together, waits for a table another
 * database session is using. A command adds them through `withBusyTableBounds`; the values are
 * checked when the command runs (`busyTableBounds`), before anything changes.
 *
 * @module cli/busy-table-options
 */
import type { Command } from "commander";

import {
  LOCK_TIMEOUT_HELP,
  LOCK_TIMEOUT_TOTAL_HELP,
} from "../domains/schema/busy-table/bounds-values";

import type { Logger } from "./utils/logger";

/** Adds both bounds to `command`, as strings, so a malformed value is refused by name later. */
export function withBusyTableBounds(command: Command): Command {
  return command
    .option("--lock-timeout <seconds>", LOCK_TIMEOUT_HELP)
    .option("--lock-timeout-total <seconds>", LOCK_TIMEOUT_TOTAL_HELP);
}

/**
 * Where a command sends the line said at each try for a busy table: standard error, so a `--json`
 * run keeps one document on standard output, unless the command runs with `--quiet`, which shows
 * errors only. A try's notice is not an error; the stop once the tries run out is, and the command
 * reports it through its logger, so `--quiet` still shows it. Read when each notice is sent, as
 * the logger has `--quiet` then.
 */
export function busyTableNotices(
  logger: Pick<Logger, "getOptions">
): (line: string) => void {
  return line => {
    if (logger.getOptions().quiet === true) return;
    process.stderr.write(`${line}\n`);
  };
}
