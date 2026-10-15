/**
 * Clearing passwords an earlier release stored as given.
 *
 * Account creation once kept a raw password of 32 characters or more that
 * contained a colon exactly as it was typed, and the write that takes a hash
 * kept whatever it was handed. Such a value has never signed anyone in, since
 * sign-in compares only against a hash, but it is a readable credential in the
 * database and in every backup of it. This finds those accounts and clears the
 * value, ending their sessions; the person sets a new password through a reset,
 * or an administrator sets one.
 *
 * Run by `nextly users:clear-plaintext-passwords`, which previews unless told
 * to apply, and counted by `nextly migrate`. Never run at boot: it changes
 * stored credentials, so an operator runs it.
 *
 * Not every value that is not core's hash is plain text. An app can pass its
 * own `passwordHasher` to `getNextly`, and the account creation that kept raw
 * values was written to accept a hash made elsewhere; either may have stored a
 * hash in another format, which an app's hasher can still sign people in with.
 * So a value in a format such hashers write is never cleared: an argon2,
 * scrypt or pbkdf2 string in the modular-crypt form their libraries write,
 * with that format's fields and alphabet, or a hex salt and digest joined by a
 * colon. A value that only starts with `$` is not one of them. A raw password
 * that happens to take one of those shapes is left in place, which the
 * preview still cannot see; one taken for plain text would lock its owner
 * out.
 *
 * @module domains/users/services/plaintext-password-cleanup
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, asc, eq, gt, isNotNull } from "drizzle-orm";

import { isPasswordHash } from "../../../auth/password/index";
import { NextlyError } from "../../../errors/nextly-error";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import {
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "./password-write";

/** Rows read per page while looking, so a large table is never read whole. */
const PAGE_SIZE = 500;

/** A salt or digest field of a modular-crypt string: base64, `.` for `+`. */
const B64 = "[A-Za-z0-9+/.]+={0,2}";

/**
 * The modular-crypt forms argon2, scrypt and pbkdf2 libraries write, each with
 * its own fields: argon2's version and cost, scrypt's cost, pbkdf2's rounds,
 * then a salt and a digest.
 */
const MODULAR_CRYPT = [
  new RegExp(
    `^\\$argon2(?:id|i|d)\\$v=\\d+\\$m=\\d+,t=\\d+,p=\\d+\\$${B64}\\$${B64}$`
  ),
  new RegExp(`^\\$scrypt\\$ln=\\d+,r=\\d+,p=\\d+\\$${B64}\\$${B64}$`),
  new RegExp(`^\\$pbkdf2(?:-sha(?:1|256|512))?\\$\\d+\\$${B64}\\$${B64}$`),
];

/** A hex salt and a hex digest joined by a colon, as scrypt libraries write. */
const HEX_SALT_AND_DIGEST = /^[0-9a-f]{16,}:[0-9a-f]{32,}$/i;

/**
 * Whether a stored value is in a format another password hasher writes, and
 * so is never taken for plain text. See the module comment.
 */
export function isOtherHasherFormat(value: string): boolean {
  return (
    MODULAR_CRYPT.some(format => format.test(value)) ||
    HEX_SALT_AND_DIGEST.test(value)
  );
}

/** An account holding a stored password that is not a hash, and that value. */
interface Candidate {
  id: string;
  value: string;
}

interface UsersPageReader {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        orderBy(order: unknown): {
          limit(n: number): Promise<Array<{ id: unknown; value: unknown }>>;
        };
      };
    };
  };
}

export class PlainTextPasswordCleanup extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    // Rows read per page; smaller only where a test needs several pages.
    private readonly pageSize = PAGE_SIZE
  ) {
    super(adapter, logger);
  }

  /**
   * The ids of the accounts whose stored password is set but is neither a
   * hash nor in another hasher's format.
   *
   * Each value is read only to be tested, by the same test sign-in uses, and
   * is never returned, printed or logged.
   */
  async find(): Promise<string[]> {
    const ids: string[] = [];
    for await (const page of this.candidatePages()) {
      for (const candidate of page) ids.push(candidate.id);
    }
    return ids;
  }

  /**
   * Clear each such value and end that account's sessions, returning how many
   * accounts changed. Every other account is left as it is, and a second run
   * finds nothing to change.
   *
   * Each account is cleared in its own transaction, and only while it still
   * holds the value that was found: a password set in between, by a reset or
   * an administrator, is a hash and stays. Each page is cleared before the
   * next is read, so no more than one page of values is held at once.
   *
   * Its refresh tokens go in the same transaction, so the account's sessions
   * cannot be renewed, and the same write raises its session epoch, so an
   * access token already issued is refused within seconds wherever a session
   * is read.
   */
  async clear(): Promise<number> {
    const { users } = this.tables;
    let changed = 0;
    for await (const page of this.candidatePages()) {
      for (const candidate of page) {
        const now = new Date();
        try {
          await this.withTransaction(async tx => {
            changed += await updateUserEndingSessions(
              tx as PasswordWriteTx,
              this.tables,
              this.dialect,
              {
                userId: candidate.id,
                // Moving the password version refuses a sign-in or refresh
                // already under way with the old credentials.
                set: {
                  passwordHash: null,
                  passwordUpdatedAt: now,
                  updatedAt: now,
                },
                when: eq(users.passwordHash, candidate.value),
              }
            );
          });
        } catch (error) {
          // The database's error can quote the statement's parameters, and
          // one of them is the value being cleared, so it is reported by
          // account and kind, never by its text or its cause.
          throw NextlyError.internal({
            logContext: {
              reason: "plaintext-password-clear-failed",
              userId: candidate.id,
              errorName: error instanceof Error ? error.name : typeof error,
            },
          });
        }
      }
    }
    return changed;
  }

  /**
   * The accounts holding a password value that is neither core's hash nor in
   * another hasher's format, a page at a time.
   */
  private async *candidatePages(): AsyncGenerator<Candidate[]> {
    const { users } = this.tables;
    const db = this.db as unknown as UsersPageReader;
    let after: string | undefined;
    for (;;) {
      const page = await db
        .select({ id: users.id, value: users.passwordHash })
        .from(users)
        .where(
          after === undefined
            ? isNotNull(users.passwordHash)
            : and(isNotNull(users.passwordHash), gt(users.id, after))
        )
        .orderBy(asc(users.id))
        .limit(this.pageSize);
      const found: Candidate[] = [];
      for (const row of page) {
        // An empty value is no password, as null is: there is nothing to
        // clear, and ending its sessions would sign out an account that signs
        // in another way.
        if (
          typeof row.value === "string" &&
          row.value !== "" &&
          !isPasswordHash(row.value) &&
          !isOtherHasherFormat(row.value)
        ) {
          found.push({ id: String(row.id), value: row.value });
        }
      }
      yield found;
      if (page.length < this.pageSize) return;
      after = String(page[page.length - 1].id);
    }
  }
}
