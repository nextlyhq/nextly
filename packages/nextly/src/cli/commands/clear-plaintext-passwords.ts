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
 * The command loads `nextly.config.ts`, and a value the configured
 * `auth.passwordHasher` recognises is never counted. It cannot see a hasher
 * passed to `getNextly` in code, or one the app used before: a hasher that
 * writes a format the clean-up does not recognise would have its hashes taken
 * for plain text, and clearing them locks those people out. So `--apply` also
 * needs `--confirm-default-hasher`, the operator's statement that every stored
 * password was written by core's bcrypt or by the configured hasher, now and
 * earlier. Without it nothing is written.
 *
 * @module cli/commands/clear-plaintext-passwords
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import type { PasswordHasher } from "../../auth/password/policy";
import { PlainTextPasswordCleanup } from "../../domains/users/services/plaintext-password-cleanup";
import { consoleLogger } from "../../services/shared";
import { exitWithError } from "../errors";
import { passwordClearUnconfirmed } from "../errors/areas/commands";
// Types only: the program hands this module its context factory, so this
// module adds no runtime import of the program that registers it.
import type { CommandContext, GlobalOptions } from "../program";
import { withAdapter, type CLIDatabaseAdapter } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import {
  CLEAR_PLAINTEXT_PASSWORDS_COMMAND,
  CONFIRM_DEFAULT_HASHER,
} from "./clear-plaintext-passwords.command";

export {
  CLEAR_PLAINTEXT_PASSWORDS_COMMAND,
  registerClearPlaintextPasswordsCommand,
} from "./clear-plaintext-passwords.command";

/**
 * The warning every count carries: the configured hasher's values are never
 * counted, but a hasher outside the config, or an earlier one, is invisible.
 */
const CUSTOM_HASHER_WARNING =
  "If your app passes a passwordHasher to getNextly rather than in nextly.config.ts, or ever used another, these may be its hashes: do not clear them.";

/**
 * The clean-up over a CLI connection, recognising the config's
 * `auth.passwordHasher`, when it sets one, as the app's sign-in does.
 */
export function plainTextPasswordCleanup(
  adapter: CLIDatabaseAdapter,
  hasher?: PasswordHasher
): PlainTextPasswordCleanup {
  return new PlainTextPasswordCleanup(
    adapter as unknown as DrizzleAdapter,
    consoleLogger,
    { hasher }
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
  // The config names the app's hasher, whose values are never counted, and
  // the PostgreSQL schema the accounts live in.
  const { config } = await loadConfig({
    configPath: context.options.config,
    cwd: context.options.cwd,
  });

  return withAdapter(
    async adapter => {
      const cleanup = plainTextPasswordCleanup(
        adapter,
        config.auth?.passwordHasher
      );
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

/**
 * The action of `nextly users:clear-plaintext-passwords`, loaded when it
 * runs, building its context with the factory the program hands in.
 */
export function clearPlaintextPasswordsAction(
  createContext: (options: GlobalOptions) => CommandContext
): (
  cmdOptions: { apply?: boolean; confirmDefaultHasher?: boolean },
  cmd: Command
) => Promise<void> {
  return async (
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
  };
}
