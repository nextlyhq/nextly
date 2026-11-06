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
      "Report every column whose type or nullability differs from its field (changes nothing)"
    )
    .action(
      lazyAction(async () =>
        (await import("./repair-columns")).repairColumnsAction(createContext)
      )
    );
}
