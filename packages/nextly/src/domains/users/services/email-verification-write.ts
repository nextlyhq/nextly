/**
 * The columns that say an account's address is verified, and how.
 *
 * `email_verified` and `email_verified_via` are written together by every
 * path that verifies or unverifies an address: following a verification link,
 * accepting an invite, an administrator or the app vouching at creation or in
 * an update, a plugin vouching through `ctx.services.users`, and a login
 * provider through `createExternalUser`. Writing both through one function is
 * what keeps the record from describing a verification that is no longer
 * there, or a verification with no record of how it happened.
 *
 * @module domains/users/services/email-verification-write
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, isNotNull, isNull } from "drizzle-orm";

import { getDialectTables } from "../../../database/index";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";
import type {
  EmailVerifiedVia,
  UserUpdateData,
} from "../../../types/database-operations";

/**
 * `email_verified` and `email_verified_via` for one write.
 *
 * A null timestamp clears both, so an address that is no longer verified
 * keeps no claim about how it once was.
 */
export function emailVerificationColumns(
  verifiedAt: Date | null,
  via: EmailVerifiedVia
): Required<Pick<UserUpdateData, "emailVerified" | "emailVerifiedVia">> {
  return {
    emailVerified: verifiedAt,
    emailVerifiedVia: verifiedAt ? via : null,
  };
}

/** The slice of a Drizzle handle the backfill uses. */
interface UpdateCapable {
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
}

/**
 * Mark every verified address that has no record of how it was verified as
 * `"legacy"`, and return how many rows that was.
 *
 * These are addresses verified before `email_verified_via` existed, or by a
 * write outside Nextly's own paths. Saying so explicitly is the point: a null
 * beside a verified address would read the same as "not recorded yet" and
 * "nothing to record", and a later decision keyed on how an address was
 * verified (linking a sign-in to an account by email) has to be able to tell
 * an unknown origin from a known one.
 *
 * Idempotent: it touches only rows with a verification and no provenance, so
 * a second run changes nothing, and a row any current path wrote is never
 * relabelled.
 */
export async function markUnrecordedVerifications(
  db: unknown,
  dialect: SupportedDialect
): Promise<number> {
  const { users } = getDialectTables(dialect);
  const result = await (db as UpdateCapable)
    .update(users)
    .set({ emailVerifiedVia: "legacy" satisfies EmailVerifiedVia })
    .where(and(isNotNull(users.emailVerified), isNull(users.emailVerifiedVia)));
  return affectedRowCount(result, dialect);
}
