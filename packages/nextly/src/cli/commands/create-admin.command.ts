/**
 * The declaration of `nextly users:create-admin`: its options and help, with
 * the action loaded from `./create-admin` only when the command runs.
 */
import type { Command } from "commander";

import type { CommandContext, GlobalOptions } from "../context";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export const CREATE_ADMIN_COMMAND = "users:create-admin";

/** Where the password is read from when no prompt can ask for it. */
export const ADMIN_PASSWORD_ENV = "NEXTLY_ADMIN_PASSWORD";

/** Register `nextly users:create-admin`. */
export function registerCreateAdminCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command(CREATE_ADMIN_COMMAND)
      .description(
        `Create the first administrator in this install's database (password from ${ADMIN_PASSWORD_ENV} or a prompt)`
      )
  )
    .option("--email <email>", "The administrator's email")
    .option("--name <name>", "The administrator's name")
    .action(
      lazyAction(async () =>
        (await import("./create-admin")).createAdminAction(createContext)
      )
    );
}
