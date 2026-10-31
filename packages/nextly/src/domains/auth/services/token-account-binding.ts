/**
 * Which account a password-reset or email-verification token belongs to.
 *
 * A token is issued to an address, and an address can change hands: an
 * account moves to another address, or is deleted, and the old address is
 * later given to someone else. A token keyed by the address alone would then
 * act on whoever holds it now. So each token records the account it was issued
 * for (`user_id`), and is honoured only for that account, while it still holds
 * the token's address.
 *
 * The rules, in one place so the issuing, redeeming and revoking paths and the
 * upgrade cannot disagree:
 *
 * - Issuing, redeeming, changing an address and deleting an account each hold
 *   the account's row for the rest of their transaction (`lockAccount`), so
 *   they are ordered against each other. A token issued while its account is
 *   moving or being deleted either lands first, and is revoked by the change,
 *   or finds the account no longer at the address and is not issued.
 * - A change of address and a deletion revoke every token of the account
 *   (`revokeAccountTokens`). Revoked, a token issued before an address change
 *   stays dead when the account returns to that address.
 * - A token issued before `user_id` existed is bound to the account holding
 *   its address only when that account was created and last changed before
 *   the token was issued (`mayBindToAccount`): such an account is the one it
 *   was issued for. Any other is removed (`bindIssuedTokens`), since it may
 *   have been issued to an earlier holder of the address, and so is one whose
 *   issue time cannot be established. Until then an unbound token is
 *   refused: only a bound one is redeemed.
 *
 * @module domains/auth/services/token-account-binding
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { getDialectTables } from "../../../database/index";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";

/**
 * How long a reset or verification link lasts unless its issuer says
 * otherwise. Verification links always last this long; a reset link may be
 * given another lifetime by its caller.
 */
export const AUTH_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * An expiry as the database keeps it: the whole second the instant falls in.
 *
 * An expiry computed as `now + lifetime` carries milliseconds, and a column
 * that keeps whole seconds — MySQL's `DATETIME` — rounds rather than cuts,
 * so the stored instant could sit up to half a second after the one the
 * code computed, and a check comparing that stored value with a
 * millisecond-resolution clock accepted a password-reset token briefly past
 * its end. Bring the instant down to its own second before it is written or
 * handed on: the stored value is then never later than the one computed,
 * and a credential can only end early, by less than a second.
 */
export function wholeSecondExpiry(computed: Date): Date {
  return new Date(Math.floor(computed.getTime() / 1000) * 1000);
}

/** The two kinds of token bound to an account. */
export type AuthTokenKind = "password-reset" | "email-verification";

type Tables = Pick<
  ReturnType<typeof getDialectTables>,
  "users" | "passwordResetTokens" | "emailVerificationTokens"
>;

/** The token table of one kind. */
export function tokenTable(
  tables: Tables,
  kind: AuthTokenKind
): Tables["passwordResetTokens"] | Tables["emailVerificationTokens"] {
  return kind === "password-reset"
    ? tables.passwordResetTokens
    : tables.emailVerificationTokens;
}

/** An account as the binding rules read it. */
export interface BindingAccount {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
}

/** A token issued before `user_id` existed, as the binding rule reads it. */
export interface UnboundToken {
  identifier: string;
  expires: Date;
}

/**
 * The slice of a Drizzle database or transaction these rules use. Each
 * statement is awaitable as-is; the account read is lockable where the
 * dialect has row locks.
 */
export interface TokenBindingDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): Promise<Record<string, unknown>[]> & {
        limit(count: number): Promise<Record<string, unknown>[]> & {
          for(strength: "update"): Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** A timestamp column read back as a Date, whatever the driver handed over. */
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toAccount(row: Record<string, unknown>): BindingAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    name: typeof row.name === "string" ? row.name : null,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
    deactivatedAt:
      row.deactivatedAt === null || row.deactivatedAt === undefined
        ? null
        : asDate(row.deactivatedAt),
  };
}

/**
 * Read the account holding `email` (and, when given, with id `userId`), and
 * hold its row until the transaction `tx` belongs to ends.
 *
 * PostgreSQL and MySQL take a row lock, and re-read the row once a writer
 * holding it commits, so an account that has just moved to another address or
 * been deleted is not returned. SQLite runs one write transaction at a time,
 * so the read is already ordered against every other write.
 */
export async function lockAccount(
  tx: TokenBindingDb,
  tables: Pick<Tables, "users">,
  dialect: SupportedDialect,
  where: { email: string; userId?: string }
): Promise<BindingAccount | undefined> {
  const { users } = tables;
  const conditions: SQL[] = [eq(users.email, where.email)];
  if (where.userId !== undefined) conditions.push(eq(users.id, where.userId));
  const query = tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(and(...conditions))
    .limit(1);
  const [row] = dialect === "sqlite" ? await query : await query.for("update");
  return row ? toAccount(row) : undefined;
}

/**
 * A time no later than the token was issued, on the clock that stamps the
 * account's `created_at` and `updated_at`, or null when none can be
 * established.
 *
 * Its expiry is stamped by the same clock. A verification link always lasts
 * `AUTH_TOKEN_LIFETIME_MS`, so it was issued exactly that long before it
 * expires.
 *
 * A reset link has no such time. Its caller may have given it another
 * lifetime, so its expiry does not say when it was issued, and its
 * `created_at` is stamped by the database, whose clock and time zone nothing
 * pins to the application's. The two can agree by chance, a lifetime longer
 * than a day offsetting a database clock that is ahead, and then any estimate
 * drawn from them is later than the issue. So the answer is null, and every
 * reset link from before links recorded their account is removed.
 */
export function issuedNoLaterThan(
  kind: AuthTokenKind,
  token: UnboundToken
): Date | null {
  if (kind === "password-reset") return null;
  return new Date(token.expires.getTime() - AUTH_TOKEN_LIFETIME_MS);
}

/**
 * Whether a token issued before `user_id` existed was issued for `account`.
 *
 * It was when the account holds the token's address and was created and last
 * changed before the token was issued: the account held the address when the
 * token was issued, and addresses are unique. An account created or changed
 * afterwards may have taken the address from whoever the token was issued to.
 *
 * Strictly before. MySQL and SQLite keep these columns to the second, so a
 * change in the same second as the issue cannot be told from one after it,
 * and is treated as one. So is a token whose issue time is not known.
 */
export function mayBindToAccount(
  kind: AuthTokenKind,
  token: UnboundToken,
  account: Pick<BindingAccount, "email" | "createdAt" | "updatedAt">
): boolean {
  return (
    account.email === token.identifier && predatesToken(kind, token, account)
  );
}

/**
 * Whether `account` was created and last changed before `token` was issued,
 * judged as {@link mayBindToAccount} judges it, for an account already known
 * to hold the token's address.
 */
function predatesToken(
  kind: AuthTokenKind,
  token: UnboundToken,
  account: Pick<BindingAccount, "createdAt" | "updatedAt">
): boolean {
  const issued = issuedNoLaterThan(kind, token);
  if (issued === null) return false;
  return (
    account.createdAt.getTime() < issued.getTime() &&
    account.updatedAt.getTime() < issued.getTime()
  );
}

/** A token table, of either kind. */
export type TokenTable = ReturnType<typeof tokenTable>;

/** The token tables by their names in the database, for a presence check. */
export const TOKEN_TABLE_NAMES = {
  "password-reset": "password_reset_tokens",
  "email-verification": "email_verification_tokens",
} as const satisfies Record<AuthTokenKind, string>;

/**
 * Delete every reset and verification token of an account from `tokenTables`,
 * in the transaction `tx` belongs to: the ones bound to it, and any not yet
 * bound that were issued to one of `addresses` (the spellings it held).
 *
 * Called when the account moves to another address and when it is deleted.
 * Every token of an account was issued to the address it held, so after a
 * move none of them is for the address it holds now. The caller names the
 * tables, so a database an earlier release created without one is not
 * asked about a table it does not have.
 */
export async function revokeAccountTokens(
  tx: Pick<TokenBindingDb, "delete">,
  tokenTables: readonly TokenTable[],
  account: {
    userId: string;
    addresses: readonly string[];
    /**
     * The address the account holds once the change commits. A token bound
     * to it is kept: one issued there after an earlier change already moved
     * the account was issued for that address. Without it every bound token
     * goes, as a deletion needs.
     */
    keepAddress?: string;
  }
): Promise<void> {
  const addresses = [...new Set(account.addresses.filter(a => a !== ""))];
  for (const table of tokenTables) {
    const bound =
      account.keepAddress === undefined
        ? eq(table.userId, account.userId)
        : and(
            eq(table.userId, account.userId),
            ne(table.identifier, account.keepAddress)
          );
    const unbound =
      addresses.length > 0
        ? and(isNull(table.userId), inArray(table.identifier, addresses))
        : undefined;
    await tx.delete(table).where(unbound ? or(bound, unbound) : bound);
  }
}

/** What `bindIssuedTokens` did. */
export interface BindIssuedTokensResult {
  bound: number;
  removed: number;
}

/** How many tokens one removal names, well inside every driver's limit. */
const LOOKUP_BATCH = 500;

/**
 * Bind every token issued before `user_id` existed to the account it was
 * issued for, and remove the rest: expired ones, ones whose address no
 * account holds, and ones whose account was created or changed after they
 * were issued (`mayBindToAccount`).
 *
 * Run by the core reconcile after the column is added, on every run. It only
 * reads tokens with no account, so a second run finds nothing, and a token the
 * current code issued is never touched. Each write is conditional on the token
 * still having no account, so a run racing another changes each token once.
 *
 * Statements run one at a time rather than in one transaction, as the
 * reconcile's other data steps do. An account deleted between the read and
 * the bind fails that bind on its foreign key, and its tokens are removed
 * instead.
 */
export async function bindIssuedTokens(
  db: unknown,
  dialect: SupportedDialect,
  now: Date = new Date()
): Promise<BindIssuedTokensResult> {
  const tables = getDialectTables(dialect);
  const tx = db as TokenBindingDb;
  const result: BindIssuedTokensResult = { bound: 0, removed: 0 };

  for (const kind of [
    "password-reset",
    "email-verification",
  ] as const satisfies readonly AuthTokenKind[]) {
    const table = tokenTable(tables, kind);
    const rows = await tx
      .select({
        id: table.id,
        identifier: table.identifier,
        expires: table.expires,
      })
      .from(table)
      .where(isNull(table.userId));
    if (rows.length === 0) continue;
    // Only a live token can be bound, so only a live token's address is
    // looked up; an expired one is removed without a read.
    const holders = await holdersOf(
      tx,
      tables,
      rows
        .filter(row => asDate(row.expires) > now)
        .map(row => String(row.identifier))
    );

    const { bindTo, remove } = planBinding(
      kind,
      rows.map(row => ({
        id: Number(row.id),
        identifier: String(row.identifier),
        expires: asDate(row.expires),
        holder: holders.get(String(row.identifier)) ?? null,
      })),
      now
    );

    for (const [userId, ids] of bindTo) {
      try {
        result.bound += affectedRowCount(
          await tx
            .update(table)
            .set({ userId })
            .where(and(inArray(table.id, ids), isNull(table.userId))),
          dialect
        );
      } catch (error) {
        // The account was deleted after it was read; its tokens go with it.
        // Any other failure stops the step with the tokens as they were, so a
        // dropped connection never reads as a reason to remove them.
        if (toDbError(dialect, error).kind !== "fk-violation") throw error;
        remove.push(...ids);
      }
    }

    for (let i = 0; i < remove.length; i += LOOKUP_BATCH) {
      result.removed += affectedRowCount(
        await tx
          .delete(table)
          .where(
            and(
              inArray(table.id, remove.slice(i, i + LOOKUP_BATCH)),
              isNull(table.userId)
            )
          ),
        dialect
      );
    }
  }

  return result;
}

/**
 * The account holding each of `identifiers`, found as a redemption finds it:
 * `email = ?`, under the database's own comparison of the column. On MySQL
 * that is the column's collation, case-insensitive by default and exact
 * under `utf8mb4_bin`; on PostgreSQL and SQLite it is exact. Addresses are
 * unique under it, so each names at most one account. One read per distinct
 * address: comparing the column with another column instead could meet two
 * collations on MySQL, which it refuses.
 */
async function holdersOf(
  tx: TokenBindingDb,
  tables: Pick<Tables, "users">,
  identifiers: readonly string[]
): Promise<
  Map<string, Pick<BindingAccount, "id" | "createdAt" | "updatedAt">>
> {
  const { users } = tables;
  const holders = new Map<
    string,
    Pick<BindingAccount, "id" | "createdAt" | "updatedAt">
  >();
  for (const identifier of new Set(identifiers)) {
    const [row] = await tx
      .select({
        id: users.id,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.email, identifier))
      .limit(1);
    if (row) {
      holders.set(identifier, {
        id: String(row.id),
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      });
    }
  }
  return holders;
}

/**
 * Which unbound tokens to bind to which account, and which to remove: a live
 * token whose holder, the account the database matched to its address, was
 * created and last changed before it was issued is bound to that account;
 * every other is removed.
 */
function planBinding(
  kind: AuthTokenKind,
  tokens: readonly (UnboundToken & {
    id: number;
    holder: Pick<BindingAccount, "id" | "createdAt" | "updatedAt"> | null;
  })[],
  now: Date
): { bindTo: Map<string, number[]>; remove: number[] } {
  const bindTo = new Map<string, number[]>();
  const remove: number[] = [];
  for (const token of tokens) {
    const { holder } = token;
    if (token.expires > now && holder && predatesToken(kind, token, holder)) {
      bindTo.set(holder.id, [...(bindTo.get(holder.id) ?? []), token.id]);
    } else {
      remove.push(token.id);
    }
  }
  return { bindTo, remove };
}
