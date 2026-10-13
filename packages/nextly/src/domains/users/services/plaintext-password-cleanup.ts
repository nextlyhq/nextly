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
 * So a value in a format such hashers write is never cleared: a modular-crypt
 * string (`$` and an algorithm id, as argon2, scrypt and pbkdf2 libraries
 * write) or a hex salt and digest joined by a colon. A raw password that
 * happens to take one of those shapes is left in place, which the preview
 * still cannot see; one taken for plain text would lock its owner out.
 *
 * @module domains/users/services/plaintext-password-cleanup
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, asc, eq, gt, isNotNull } from "drizzle-orm";

import { isPasswordHash } from "../../../auth/password/index";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

import {
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "./password-write";

/** Rows read per page while looking, so a large table is never read whole. */
const PAGE_SIZE = 500;

/** A hex salt and a hex digest joined by a colon, as scrypt libraries write. */
const HEX_SALT_AND_DIGEST = /^[0-9a-f]{16,}:[0-9a-f]{32,}$/i;

/**
 * Whether a stored value is in a format another password hasher writes, and
 * so is never taken for plain text. See the module comment.
 */
export function isOtherHasherFormat(value: string): boolean {
  return value.startsWith("$") || HEX_SALT_AND_DIGEST.test(value);
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
  constructor(adapter: DrizzleAdapter, logger: Logger) {
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
    return (await this.candidates()).map(candidate => candidate.id);
  }

  /**
   * Clear each such value and end that account's sessions, returning how many
   * accounts changed. Every other account is left as it is, and a second run
   * finds nothing to change.
   *
   * Each account is cleared in its own transaction, and only while it still
   * holds the value that was found: a password set in between, by a reset or
   * an administrator, is a hash and stays.
   */
  async clear(): Promise<number> {
    const { users } = this.tables;
    let changed = 0;
    for (const candidate of await this.candidates()) {
      const now = new Date();
      await this.withTransaction(async tx => {
        changed += await updateUserEndingSessions(
          tx as PasswordWriteTx,
          this.tables,
          this.dialect,
          {
            userId: candidate.id,
            // Moving the password version ends the access tokens issued
            // before, as any password write does; the refresh tokens go in
            // the same transaction.
            set: { passwordHash: null, passwordUpdatedAt: now, updatedAt: now },
            when: eq(users.passwordHash, candidate.value),
          }
        );
      });
    }
    return changed;
  }

  /**
   * Every account holding a password value that is neither core's hash nor in
   * another hasher's format, read a page at a time.
   */
  private async candidates(): Promise<Candidate[]> {
    const { users } = this.tables;
    const db = this.db as unknown as UsersPageReader;
    const found: Candidate[] = [];
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
        .limit(PAGE_SIZE);
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
      if (page.length < PAGE_SIZE) return found;
      after = String(page[page.length - 1].id);
    }
  }
}
