/**
 * The one way a command confirms a backup before it changes stored data: by
 * its flag, or by a yes at a terminal. The move of an earlier release's
 * migration records and the steps over data an earlier release stored both
 * ask through here, each with its own two refusals.
 *
 * @module cli/commands/backup-confirmation
 */

import type { NextlyError } from "../../errors";

export interface BackupConfirmation {
  /** Whether the operator stated a backup exists (`--backup-confirmed`). */
  backupConfirmed: boolean;
  /** Whether a person is at a terminal to be asked. */
  interactive: boolean;
  /** Asks that person whether the database is backed up; only called when `interactive`. */
  askBackedUp?: (() => Promise<boolean>) | undefined;
  /** The refusal with no confirmation and nobody to ask. */
  notConfirmed: () => NextlyError;
  /** The refusal of a no at the question. */
  declined: () => NextlyError;
}

/**
 * Returns once the backup is confirmed, by the flag or by a yes; otherwise
 * throws the caller's refusal, with nothing asked where nobody can answer.
 */
export async function confirmBackup(args: BackupConfirmation): Promise<void> {
  if (args.backupConfirmed) return;
  if (!args.interactive || args.askBackedUp === undefined) {
    throw args.notConfirmed();
  }
  if (!(await args.askBackedUp())) throw args.declined();
}
