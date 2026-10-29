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
 * ## `--apply` needs the operator's word on the hasher
 *
 * An app may pass its own `passwordHasher` to `getNextly`, in its code rather
 * than in `nextly.config.ts`, so this command cannot see one. A hasher that
 * writes a format the clean-up does not recognise would have its hashes taken
 * for plain text, and clearing them locks those people out. So `--apply` also
 * needs `--confirm-default-hasher`, the operator's statement that no stored
 * password was written by a custom hasher, now or earlier: an app that once
 * passed one and no longer does may still hold its hashes. Without it nothing
 * is written.
 *
 * @module cli/commands/clear-plaintext-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { PlainTextPasswordCleanup } from "../../domains/users/services/plaintext-password-cleanup";
import { consoleLogger } from "../../services/shared";
import { exitWithError } from "../errors";
import { passwordClearUnconfirmed } from "../errors/areas/commands";
// Types only: the program hands this module its context factory, so this
// module adds no runtime import of the program that registers it.
import type { CommandContext, GlobalOptions } from "../program";
import { withAdapter, type CLIDatabaseAdapter } from "../utils/adapter";

export const CLEAR_PLAINTEXT_PASSWORDS_COMMAND =
  "users:clear-plaintext-passwords";

const CONFIRM_DEFAULT_HASHER = "--confirm-default-hasher";

/** The warning every count carries, since a custom hasher is invisible here. */
const CUSTOM_HASHER_WARNING =
  "If your app passes, or ever passed, a passwordHasher to getNextly, these may be its hashes: do not clear them.";

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
  return `${String(count)} account(s) hold a password stored as given. Run \`nextly ${CLEAR_PLAINTEXT_PASSWORDS_COMMAND}\` to review them. ${CUSTOM_HASHER_WARNING}`;
}

/**
 * Preview, or clear with `apply`; returns how many accounts were found, or
 * changed. An apply without the operator's confirmation is refused with the
 * command's error, thrown before any connection is made. The connection
 * refuses a missing or unusable database setting itself, before anything is
 * read.
 */
export async function runClearPlaintextPasswords(
  apply: boolean,
  context: CommandContext,
  confirmedDefaultHasher = false
): Promise<number> {
  const { logger } = context;
  if (apply && !confirmedDefaultHasher) {
    throw passwordClearUnconfirmed(
      CONFIRM_DEFAULT_HASHER,
      CLEAR_PLAINTEXT_PASSWORDS_COMMAND
    );
  }
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
          `Cleared the stored password of ${String(count)} account(s) and ended their sessions: none can be renewed, and an access token already issued stays valid until it expires (fifteen minutes by default). Each person sets a new password through a password reset, or an administrator sets one.`
        );
      } else {
        logger.warn(
          `${String(count)} account(s) hold a password stored as given. Nothing was changed; run again with --apply ${CONFIRM_DEFAULT_HASHER} to clear them and end their sessions. ${CUSTOM_HASHER_WARNING}`
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
    .option(
      CONFIRM_DEFAULT_HASHER,
      "With --apply: state that no stored password was written by a custom passwordHasher, now or earlier",
      false
    )
    .action(
      async (
        cmdOptions: { apply?: boolean; confirmDefaultHasher?: boolean },
        cmd: Command
      ) => {
        const context = createContext(cmd.optsWithGlobals());
        // A refused apply wrote nothing, and says so with its exit status.
        await runClearPlaintextPasswords(
          cmdOptions.apply === true,
          context,
          cmdOptions.confirmDefaultHasher === true
        ).catch((error: unknown) => {
          exitWithError(context.logger, error);
        });
      }
    );
}
