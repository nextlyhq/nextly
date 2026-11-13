/**
 * `nextly repair-columns`, declared. Its action is loaded from
 * `./repair-columns` when it runs, so declaring the command loads none of the
 * schema or database code.
 *
 * @module cli/commands/repair-columns.command
 */
import type { Command } from "commander";

import type { CommandContext, GlobalOptions } from "../context";
import { lazyAction } from "../lazy-action";

const REPAIR_COLUMNS_COMMAND = "repair-columns";

export function registerRepairColumnsCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  program
    .command(REPAIR_COLUMNS_COMMAND)
    .description(
      "Report every column whose type or nullability differs from its field; with --apply, convert the safe ones"
    )
    // Without it the run only reports and changes nothing; with it the run takes the schema lock.
    .option(
      "--apply",
      "Convert each column whose stored values all convert exactly, and record each repair",
      false
    )
    // The one data-loss consent, read by the same parser as every command's. A repair takes only
    // the form naming its columns: the form without a list, or a table alone, never clears one.
    .option(
      "--accept-data-loss [targets]",
      "With --apply, convert each lossy column named as table.column (--accept-data-loss=dc_posts.meta), clearing the values its report names; the form without a list, or a table alone, covers none. Same as NEXTLY_ACCEPT_DATA_LOSS."
    )
    // One versioned document on standard output, for CI; nothing else is written there.
    .option(
      "--json",
      "Write one JSON document with every column and its outcome to standard output",
      false
    )
    .action(
      lazyAction(async () =>
        (await import("./repair-columns")).repairColumnsAction(createContext)
      )
    );
}
