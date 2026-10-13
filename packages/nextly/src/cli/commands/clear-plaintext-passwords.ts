/**
 * `nextly users:clear-plaintext-passwords` — clear passwords an earlier
 * release stored as given.
 *
 * Account creation once kept a long raw password containing a colon exactly as
 * it was typed. Such a value never signed anyone in, but it is a readable
 * credential in the database and its backups. This command finds the accounts
 * holding one and, with `--apply`, clears the value and ends their sessions;
 * each person then sets a new password through a password reset, or an
 * administrator sets one.
 *
 * ## It previews by default
 *
 * With no flags it changes nothing and prints how many accounts it would
 * clear. Only `--apply` writes. Either way it prints counts, never an address
 * or a stored value, and a second `--apply` finds nothing left to change.
 *
 * `nextly migrate` prints the same count, read-only, and names this command,
 * so an install that holds such accounts hears about it on its next migrate.
 *
 * @module cli/commands/clear-plaintext-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { PlainTextPasswordCleanup } from "../../domains/users/services/plaintext-password-cleanup";
import { describeError } from "../../errors/index";
import { consoleLogger } from "../../services/shared";
// Types only: the program hands this module its context factory, so this
// module adds no runtime import of the program that registers it.
import type { CommandContext, GlobalOptions } from "../program";
import { withAdapter, type CLIDatabaseAdapter } from "../utils/adapter";

export const CLEAR_PLAINTEXT_PASSWORDS_COMMAND =
  "users:clear-plaintext-passwords";

/** The clean-up over a CLI connection. */
export function plainTextPasswordCleanup(
  adapter: CLIDatabaseAdapter
): PlainTextPasswordCleanup {
  return new PlainTextPasswordCleanup(
    adapter as unknown as DrizzleAdapter,
    consoleLogger
  );
}

/**
 * The line `nextly migrate` prints when accounts hold such a password, or
 * `null` when none does. One wording, so the two commands cannot drift.
 */
export function plainTextPasswordNotice(count: number): string | null {
  if (count === 0) return null;
  return `${String(count)} account(s) hold a password stored as given. Run \`nextly ${CLEAR_PLAINTEXT_PASSWORDS_COMMAND}\` to review them, and add --apply to clear them and end their sessions.`;
}

/**
 * Preview, or clear with `apply`; returns how many accounts were found, or
 * changed. The connection refuses a missing or unusable database setting
 * itself, before anything is read.
 */
export async function runClearPlaintextPasswords(
  apply: boolean,
  context: CommandContext
): Promise<number> {
  const { logger } = context;
  logger.keyValue("Mode", apply ? "apply" : "preview (nothing is written)");
  logger.newline();

  return withAdapter(
    async adapter => {
      const cleanup = plainTextPasswordCleanup(adapter);
      const count = apply
        ? await cleanup.clear()
        : (await cleanup.find()).length;
      if (count === 0) {
        logger.success("No account holds a password stored as given.");
      } else if (apply) {
        logger.success(
          `Cleared the stored password of ${String(count)} account(s) and ended their sessions. Each person sets a new password through a password reset, or an administrator sets one.`
        );
      } else {
        logger.warn(
          `${String(count)} account(s) hold a password stored as given. Nothing was changed; run again with --apply to clear them and end their sessions.`
        );
      }
      return count;
    },
    { logger }
  );
}

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
    .action(async (cmdOptions: { apply?: boolean }, cmd: Command) => {
      const context = createContext(cmd.optsWithGlobals());
      await runClearPlaintextPasswords(
        cmdOptions.apply === true,
        context
      ).catch((error: unknown) => {
        context.logger.error(describeError(error));
        process.exit(1);
      });
    });
}
