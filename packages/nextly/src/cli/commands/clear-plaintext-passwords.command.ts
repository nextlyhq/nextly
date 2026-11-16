/**
 * The declaration of `nextly users:clear-plaintext-passwords`: its options and
 * help, with the action loaded from `./clear-plaintext-passwords` only when
 * the command runs.
 */
import type { Command } from "commander";

import type { CommandContext, GlobalOptions } from "../context";
import { lazyAction } from "../lazy-action";

export const CLEAR_PLAINTEXT_PASSWORDS_COMMAND =
  "users:clear-plaintext-passwords";

/** The flag `--apply` also needs: the operator's word on the hasher. */
export const CONFIRM_DEFAULT_HASHER = "--confirm-default-hasher";

export function registerClearPlaintextPasswordsCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  program
    .command(CLEAR_PLAINTEXT_PASSWORDS_COMMAND)
    .description(
      "Find accounts holding a password stored as given, and with --apply clear it and end their sessions"
    )
    .option(
      "--apply",
      "Clear the values (without this, the command only previews)",
      false
    )
    .option(
      CONFIRM_DEFAULT_HASHER,
      "With --apply: state that every stored password was written by core's bcrypt or by the passwordHasher in nextly.config.ts, now and earlier",
      false
    )
    .action(
      lazyAction(async () =>
        (
          await import("./clear-plaintext-passwords")
        ).clearPlaintextPasswordsAction(createContext)
      )
    );
}
