import { randomBytes, createHash } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, and, gt, lt, isNull, or } from "drizzle-orm";

import {
  verifyPassword as verifyPasswordBcrypt,
  hashPassword as hashPasswordBcrypt,
  validatePasswordStrength,
} from "@nextly/auth/password";
import { EmailSchema } from "@nextly/schemas/_zod/validation";
import type { MinimalUser } from "@nextly/types/auth";

// PR 4 migration: switched from ServiceError + mapDbErrorToServiceError result
// shapes to throw-based NextlyError. Successful methods now return their data
// directly (or void); failures throw a NextlyError instance the consumer
// catches via try/catch or lets the unified error handler convert to JSON.
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors/nextly-error";
import { emitAuthEvent } from "../../../events/domain-events";
import { env } from "../../../lib/env";
import { BaseService } from "../../../services/base-service";
import type { EmailService } from "../../../services/email/email-service";
import type { Logger } from "../../../services/shared";
import { affectedRowCount } from "../../../shared/lib/affected-row-count";
import { requireFilterValue } from "../../../shared/lib/require-filter-value";
import { auditReason } from "../../audit/audit-reasons";
import { emailVerificationColumns } from "../../users/services/email-verification-write";
import {
  passwordColumns,
  updateUserEndingSessions,
  type PasswordWriteTx,
} from "../../users/services/password-write";
import { UserAccountService } from "../../users/services/user-account-service";
import { UserQueryService } from "../../users/services/user-query-service";
import { generateInviteTokenValue, hashInviteToken } from "../lib/invite-token";

import {
  AUTH_TOKEN_LIFETIME_MS,
  lockAccount,
  tokenTable,
  type AuthTokenKind,
  type BindingAccount,
  type TokenBindingDb,
} from "./token-account-binding";

// Re-exported: this module owned `affectedRowCount` before it was shared, and
// both its unit test and the invite flow import it from here.
export { affectedRowCount };

interface RegisterUserData {
  email: string;
  password: string;
  name?: string;
}

/**
 * Result of {@link AuthService.generatePasswordResetToken}.
 * `token` is included only in dev-fallback paths (no email service or send
 * failed) per the existing security contract; in normal operation the token
 * is delivered by email and the response is just `{}`.
 */
interface ResetPasswordTokenResult {
  token?: string;
}

/** Result of {@link AuthService.resetPasswordWithToken} on success. */
interface ConsumeResetTokenResult {
  email: string;
}

/** Result of {@link AuthService.generateInviteToken}. */
interface InviteTokenResult {
  /** The raw, single-use token. Returned once and never stored. */
  token: string;
  /** When the link stops working. */
  expiresAt: Date;
}

/** Result of {@link AuthService.acceptInvite} on success. */
interface AcceptInviteResult {
  userId: string;
}

/**
 * The fluent slice of a Drizzle transaction this service uses.
 *
 * `withTransaction` hands back `unknown` because the concrete transaction type
 * is dialect-specific; narrowing to the methods actually called keeps the body
 * typed without an `any`.
 */
interface TransactionLike extends PasswordWriteTx {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  // Only the read-back after a forced change selects: the password version
  // and the session epoch the write left.
  select(fields: { passwordUpdatedAt: unknown; sessionEpoch: unknown }): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(
          count: number
        ): Promise<
          { passwordUpdatedAt: Date | null; sessionEpoch: number | null }[]
        >;
      };
    };
  };
}

/**
 * The slice of a transaction the reset and verification flows use: the
 * account lock and token writes, and the shared password write.
 */
type TokenTransaction = TokenBindingDb &
  PasswordWriteTx &
  Pick<TransactionLike, "insert">;

/**
 * Authentication Service
 *
 * Handles user authentication, password management, and email verification.
 *
 * **Token Security**:
 * - Tokens are generated using 32 bytes (256 bits) of cryptographically secure random data
 * - Raw tokens are returned to users as 64-character hex strings
 * - Tokens are hashed using SHA-256 before storage in the database
 * - This prevents token exposure even if the database is compromised
 *
 * **Token Cleanup**:
 * - Call `cleanupExpiredTokens()` periodically to remove expired tokens
 * - Safe to run frequently as it only deletes expired tokens
 * - Prevents token table bloat and maintains database performance
 *
 * @example
 * ```typescript
 * // Periodic cleanup (run in scheduled job)
 * await authService.cleanupExpiredTokens();
 * ```
 */
/**
 * Whether a stored token has expired: the one expiry test every consume path
 * and every owner lookup applies, so a token is live to both or to neither.
 */
function tokenExpired(row: { expires: Date }): boolean {
  return row.expires < new Date();
}

/** A reset or verification token row, as the consume and the lookup read it. */
interface StoredTokenRow {
  id: number;
  identifier: string;
  /** The account it was issued for; null on a token from before that was recorded. */
  userId: string | null;
  expires: Date;
}

/** How a reset or verification token is stored: the SHA-256 of the raw token. */
function storedTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthService extends BaseService {
  readonly emailService?: EmailService;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    emailService?: EmailService
  ) {
    super(adapter, logger);
    this.emailService = emailService;
  }

  // withTransaction is inherited from BaseService which routes through
  // Drizzle native on PG/MySQL and the adapter's transaction on SQLite.
  // Do NOT override it here — the base class's dialect-aware routing
  // is what makes async transaction callbacks work on all three dialects.

  /**
   * What to return when a token could not be delivered by email.
   *
   * Outside production the raw token comes back, which is what makes a local
   * install usable before any provider is configured. In production it does
   * not: a reset or verification token is a credential, and OWASP's guidance
   * is that it may only travel by the side channel it was minted for. Handing
   * it to whoever called the endpoint turns a delivery outage into account
   * takeover for every account an attacker cares to name.
   *
   * The gate is what makes detecting more failures safe. Recognising an
   * unsuccessful send — rather than only a thrown one — necessarily routes
   * more situations here, and without this that would have widened where a
   * live token is handed back.
   */
  private undeliveredTokenFallback(rawToken: string): { token?: string } {
    if (env.NODE_ENV === "production") {
      this.logger.error(
        "A token could not be delivered and is withheld from the response",
        { event: "auth.token_delivery_failed", environment: "production" }
      );
      return {};
    }
    return { token: rawToken };
  }

  /**
   * Issue a reset or verification token for the account holding `email`
   * (and, when given, with id `userId`), replacing any earlier token of that
   * kind it holds. Returns the account, or undefined when none holds the
   * address, in which case nothing is written.
   *
   * One transaction, holding the account's row from the lookup to the
   * insert. An address change or a deletion of the account takes the same
   * row, so it either commits first, and this finds no account at the
   * address, or waits, and then revokes the token this wrote. Without the
   * lock a token could be inserted after the change revoked the account's
   * tokens, and work again once the account returned to the address.
   */
  private async issueToken(
    kind: AuthTokenKind,
    args: { email: string; userId?: string; tokenHash: string; expiresAt: Date }
  ): Promise<{ id: string; email: string; name: string | null } | undefined> {
    const table = tokenTable(this.tables, kind);
    let issued: { id: string; email: string; name: string | null } | undefined;
    await this.withTransaction(async txRaw => {
      const tx = txRaw as TokenTransaction;
      const account = await lockAccount(tx, this.tables, this.dialect, {
        email: args.email,
        userId: args.userId,
      });
      if (!account) return;
      // One live token of each kind per account: the newest link supersedes
      // the earlier ones, including one from before tokens recorded their
      // account.
      await tx
        .delete(table)
        .where(
          or(
            eq(table.userId, account.id),
            and(isNull(table.userId), eq(table.identifier, args.email))
          )
        );
      await tx.insert(table).values({
        identifier: args.email,
        userId: account.id,
        tokenHash: args.tokenHash,
        expires: args.expiresAt,
      });
      issued = { id: account.id, email: account.email, name: account.name };
    });
    return issued;
  }

  /**
   * The account a token being redeemed acts on, holding its row for the rest
   * of the transaction `tx` belongs to, or undefined when there is none: the
   * account it was issued for, while it still holds the token's address.
   *
   * A token from before tokens recorded their account acts on none. The core
   * reconcile binds it to its account, or removes it, the next time it runs;
   * judging it here as well would be a second, later reading of a rule the
   * upgrade applies once.
   */
  private async redeemingAccount(
    tx: TokenTransaction,
    token: { identifier: string; userId: string | null }
  ): Promise<BindingAccount | undefined> {
    if (token.userId === null) return undefined;
    return lockAccount(tx, this.tables, this.dialect, {
      email: token.identifier,
      userId: token.userId,
    });
  }

  /** The one public error an unusable reset link returns. */
  private invalidResetLinkError(
    logContext: Record<string, unknown>
  ): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: "token",
          code: "INVALID",
          message: "The reset link is invalid.",
        },
      ],
      logContext,
    });
  }

  /** The one public error an unusable verification link returns. */
  private invalidVerificationLinkError(
    logContext: Record<string, unknown>
  ): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: "token",
          code: "INVALID",
          message: "The verification link is invalid or has already been used.",
        },
      ],
      logContext,
    });
  }

  /**
   * Register a new user with email and password.
   *
   * @returns The newly created user (with `passwordHash` redacted).
   * @throws NextlyError(VALIDATION_ERROR) on weak passwords / invalid input.
   * @throws NextlyError on DB errors (e.g. a duplicate email surfaces as
   *   `DUPLICATE` via fromDatabaseError; see PR 5 note below).
   */
  async registerUser(userData: RegisterUserData): Promise<MinimalUser> {
    // Validate password strength up front so we never reach the DB on a
    // known-bad input. Per spec §13.8 the validation message names the
    // field but never the value.
    const passwordStrength = validatePasswordStrength(userData.password);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "password",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    // PR 4 (unified-error-system): UsersService.createLocalUser now
    // returns MinimalUser directly and throws NextlyError on failure.
    // Re-throw NextlyError instances unchanged so the caller sees the
    // proper code (DUPLICATE on email conflict, VALIDATION_ERROR on
    // bad input). Anything else is a DB error / unknown bug and goes
    // through fromDatabaseError. PR 5 will replace this entire flow
    // with the silent-success pattern (§13.8).
    let newUser;
    try {
      // Registration records `user.created`, so this service is built with the
      // same post-commit hooks the DI-registered and facade-built ones get.
      // Without them the event a self-registration produces waits for the
      // scheduled drain, which an install running on Next's `after()` alone
      // never triggers, and the outbox it lands in is never pruned from here.
      const { resolveWebhookWritePathInfra } = await import(
        "../../webhooks/write-path-infra"
      );
      const { fastDrainScheduler, retentionRunner } =
        resolveWebhookWritePathInfra(this.adapter, this.logger);
      const userService = new (
        await import("../../../services/users")
      ).UsersService(
        this.adapter,
        this.logger,
        undefined,
        undefined,
        undefined,
        fastDrainScheduler,
        retentionRunner
      );
      newUser = await userService.createLocalUser(
        {
          email: userData.email,
          name: userData.name ?? "User",
          password: userData.password,
          // Self-registration: the person supplied this address and nothing has
          // established it is theirs. The verification email sent below is what
          // proves it, and until then the account stays unverified.
          emailVerification: "pending",
        },
        undefined,
        // A stranger's registration never makes the install's administrator,
        // whoever was there before it.
        "self-registration"
      );
    } catch (error) {
      if (NextlyError.is(error)) {
        throw error;
      }
      // Normalise raw driver errors to DbError before mapping so unique
      // violation on email registration is preserved as 409 DUPLICATE
      // instead of collapsing to INTERNAL_ERROR / 500.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    // Trigger the verification email. Swallow errors so a transient
    // email outage cannot block the registration itself. The user
    // can request a resend from the login page.
    try {
      await this.generateEmailVerificationToken(userData.email);
    } catch (err) {
      this.logger.error(
        "[auth-service] Failed to send verification email on register",
        { error: err instanceof Error ? err.message : String(err) }
      );
    }

    emitAuthEvent("registered", { userId: newUser.id, email: newUser.email });

    return newUser;
  }

  /**
   * Verify user credentials for login.
   *
   * @returns The authenticated user on success (passwordHash redacted).
   * @throws NextlyError(AUTH_INVALID_CREDENTIALS) for unknown email,
   *   missing passwordHash (OAuth-only user), or wrong password — the
   *   canonical "Invalid email or password." message comes from the
   *   factory and never reveals which leg failed (§13.8).
   *
   * Checks the password only: it neither counts a failed attempt nor decides
   * whether the account may hold a session (locked, deactivated,
   * unverified). Anything that issues a session signs in through
   * `auth/credentials/verify-credentials`, which does all three.
   */
  async verifyCredentials(
    email: string,
    password: string
  ): Promise<MinimalUser> {
    const normalizedEmailResult = EmailSchema.safeParse(email);
    const normalizedEmail = normalizedEmailResult.success
      ? normalizedEmailResult.data
      : String(email).trim().toLowerCase();
    const user = await this.db.query.users.findFirst({
      where: { email: requireFilterValue(normalizedEmail, "email") },
      columns: {
        id: true,
        email: true,
        name: true,
        image: true,
        passwordHash: true,
        emailVerified: true,
      },
    });

    if (!user || !user.passwordHash) {
      // Generic public message ("Invalid email or password.") is provided by
      // the factory; logContext records *why* internally for operators.
      throw NextlyError.invalidCredentials({
        logContext: {
          reason: auditReason(!user ? "user-not-found" : "no-password-hash"),
        },
      });
    }

    const isValidPassword = await verifyPasswordBcrypt(
      password,
      user.passwordHash
    );

    if (!isValidPassword) {
      throw NextlyError.invalidCredentials({
        logContext: {
          reason: auditReason("password-mismatch"),
          userId: user.id,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      passwordHash: null,
    };
  }

  /**
   * Change user password.
   *
   * @throws NextlyError(AUTH_INVALID_CREDENTIALS) when the current password
   *   is wrong, the user has no password (OAuth-only), or the user does not
   *   exist — all three legs collapse to the same public message per §13.8
   *   to avoid leaking account state.
   * @throws NextlyError on DB errors.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    let user;
    try {
      user = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(userId, "userId") },
        columns: {
          passwordHash: true,
        },
      });
    } catch (error) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    if (!user || !user.passwordHash) {
      // Same generic message as a wrong-password leg. Operator-only context
      // captures whether the user existed for debug purposes.
      throw NextlyError.invalidCredentials({
        logContext: {
          reason: auditReason(!user ? "user-not-found" : "no-password-hash"),
          userId,
        },
      });
    }

    const isValidPassword = await verifyPasswordBcrypt(
      currentPassword,
      user.passwordHash
    );

    if (!isValidPassword) {
      throw NextlyError.invalidCredentials({
        logContext: {
          reason: auditReason("current-password-mismatch"),
          userId,
        },
      });
    }

    const newPasswordHash = await hashPasswordBcrypt(newPassword);

    // The users service's own-password write, so both services that change
    // a user's own password make the one write: conditional on the account
    // not being deactivated, in the same statement, and ending every session
    // the account holds in the same transaction. A deactivated account's
    // credentials are frozen, as they are for a reset link, an invite and the
    // forced first-sign-in change: an access token still inside its
    // lifetime, or a Direct API token, must not set a password for a later
    // reactivation to switch on. Decided by the write rather than a read
    // before it, which could not see a deactivation landing while the
    // password was hashed.
    const changed = await new UserAccountService(
      this.adapter,
      this.logger
    ).changeOwnPasswordHash(userId, newPasswordHash);
    if (!changed) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("inactive"), userId },
      });
    }

    emitAuthEvent("passwordChanged", { userId });
  }

  /**
   * Generate password reset token
   *
   * @param email - User email address
   * @param options.disableEmail - Skip sending the reset email and always return the token
   * @param options.expiration - Token lifetime in seconds (defaults to AUTH_TOKEN_LIFETIME_MS)
   */
  async generatePasswordResetToken(
    email: string,
    options?: {
      disableEmail?: boolean;
      expiration?: number;
      redirectPath?: string;
    }
  ): Promise<ResetPasswordTokenResult> {
    const disableEmail = options?.disableEmail ?? false;
    const expirationMs =
      options?.expiration != null
        ? options.expiration * 1000
        : AUTH_TOKEN_LIFETIME_MS;

    // Normalize email to ensure consistent matching with verifyCredentials
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + expirationMs);

      // Issued for the account holding the address, holding its row so an
      // address change or a deletion running at the same time is ordered
      // against this: either it lands first and this finds no account at the
      // address, or this lands first and it revokes the token.
      const user = await this.issueToken("password-reset", {
        email: normalizedEmail,
        tokenHash,
        expiresAt,
      });

      if (!user) {
        // Silent success: don't reveal whether the email exists. Same shape
        // as a successful run with no token (since email "would have been
        // sent" in the normal flow).
        return {};
      }

      if (disableEmail) {
        return { token: rawToken };
      }

      if (this.emailService) {
        let delivered = false;
        try {
          // The result matters as much as the absence of a throw: a provider
          // failure is converted to `{ success: false }` rather than raised, so
          // awaiting alone would read a failed send as a delivered one and take
          // the branch below that deliberately withholds the token.
          const result = await this.emailService.sendPasswordResetEmail(
            normalizedEmail,
            { name: user.name, email: user.email },
            rawToken,
            // Names the staff user on the delivery records.
            { path: options?.redirectPath, staffUserId: String(user.id) }
          );
          delivered = result.success;
          if (!delivered) {
            this.logger.error("Password reset email was not delivered", {
              event: "auth.password_reset.email_failed",
              reason: "not-delivered-to-recipient",
            });
          }
        } catch (emailError) {
          this.logger.error("Failed to send password reset email", {
            event: "auth.password_reset.email_failed",
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          });
        }

        // Delivered: the token travelled by its side channel and must not also
        // appear here.
        if (delivered) return {};

        return this.undeliveredTokenFallback(rawToken);
      }

      this.logger.warn(
        "No email provider is configured, so the password reset token could not be delivered",
        { event: "auth.password_reset.email_unconfigured" }
      );
      return this.undeliveredTokenFallback(rawToken);
    } catch (error) {
      // DB errors are mapped to NextlyError. Generic public messages keep us
      // from leaking schema or driver text. Normalise raw driver errors via
      // toDbError(dialect) so the kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Consume password reset token and reset password.
   *
   * @returns Object containing the email that owned the token.
   * @throws NextlyError(TOKEN_EXPIRED) if the token was found but is past
   *   its expiry — surfaces the canonical session-expired message so the
   *   client can prompt the user to request a new reset email.
   * @throws NextlyError(VALIDATION_ERROR) if the token is unknown or the
   *   new password is too weak.
   */
  async resetPasswordWithToken(
    token: string,
    newPassword: string
  ): Promise<ConsumeResetTokenResult> {
    const resetToken = await this.findUnusedResetToken(token);

    if (!resetToken) {
      // Unknown / already-consumed token. Don't reveal which: a generic
      // validation error keeps the wire response uniform.
      throw NextlyError.validation({
        errors: [
          {
            path: "token",
            code: "INVALID",
            message: "The reset link is invalid or has already been used.",
          },
        ],
        logContext: { reason: "reset-token-not-found-or-used" },
      });
    }

    if (tokenExpired(resetToken)) {
      // §13.8 mandates the canonical session-expired message for
      // TOKEN_EXPIRED. We use the literal spec message; the per-token
      // identifier moves into logContext.
      throw new NextlyError({
        code: "TOKEN_EXPIRED",
        publicMessage: "Your session has expired. Please sign in again.",
        logContext: {
          reason: "reset-token-expired",
          tokenId: resetToken.id,
          expiredAt: resetToken.expires,
        },
      });
    }

    const email = resetToken.identifier;
    // The account the token was issued for. A token from before tokens
    // recorded one names none, and is refused in the transaction below.
    const boundTo = resetToken.userId ?? undefined;

    const targetUser = await this.db.query.users.findFirst({
      where: {
        email: requireFilterValue(email, "email"),
        ...(boundTo === undefined
          ? {}
          : { id: requireFilterValue(boundTo, "userId") }),
      },
      columns: { id: true, deactivatedAt: true },
    });

    if (!targetUser) {
      // The account the token was issued for is gone, or no longer holds the
      // address the link was sent to. Treat as invalid token rather than 500
      // — public message stays generic; the orphan token is logged for
      // operators.
      throw this.invalidResetLinkError({
        reason: "reset-token-orphan",
        tokenId: resetToken.id,
      });
    }

    if (targetUser.deactivatedAt) {
      // A deactivated account's credentials are frozen: a link minted
      // before the deactivation may still arrive, but it can no longer set
      // a password or clear an admin-set must-change requirement. The wire
      // stays the generic invalid-link answer, so the account's state is
      // not confirmed to whoever holds the link.
      throw this.invalidResetLinkError({
        reason: "reset-token-deactivated",
        tokenId: resetToken.id,
      });
    }

    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "newPassword",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    try {
      const passwordHash = await hashPasswordBcrypt(newPassword);
      const { passwordResetTokens, users } = this.tables;

      // Checked, applied and spent in one transaction, holding the account's
      // row: an address change or a deletion running at the same time either
      // commits first, and the link is refused, or waits for the reset.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TokenTransaction;
        const account = await this.redeemingAccount(tx, resetToken);
        if (!account) {
          throw this.invalidResetLinkError({
            reason: "reset-token-account-changed",
            tokenId: resetToken.id,
          });
        }

        // Spent before the password is written, and only by one caller: two
        // redemptions of one link can both pass the read above, and the
        // conditional update lets exactly one flip used_at. Zero rows also
        // means the link was revoked, or expired, since it was read.
        const spent = await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.id, resetToken.id),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expires, new Date()),
              eq(passwordResetTokens.userId, account.id)
            )
          );
        if (affectedRowCount(spent, this.dialect) !== 1) {
          throw this.invalidResetLinkError({
            reason: "reset-token-spent-or-revoked",
            tokenId: resetToken.id,
          });
        }

        // The own-password write `changePassword` makes: conditional on the
        // account not being deactivated, in the same statement that sets the
        // password, and ending every session the account holds. An
        // administrator may have switched the account off while the new
        // password was being hashed, and the read above would not have seen
        // it; the credentials stay frozen in that window too. Whoever asked
        // for the reset may not be the only one holding a session, so the
        // reset ends them all on every path that resets. Throwing rolls the
        // spend back with it.
        const reset = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId: account.id,
            set: passwordColumns(passwordHash),
            unlessDeactivated: true,
            when: eq(users.email, email),
          }
        );
        if (reset !== 1) {
          throw this.invalidResetLinkError({
            reason: "reset-token-deactivated",
            tokenId: resetToken.id,
          });
        }
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors before mapping.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    emitAuthEvent("passwordReset", { email });

    return { email };
  }

  /**
   * Send email verification token.
   *
   * @returns `{}` on success when the email service handled delivery, or
   *   `{ token }` for dev-fallback paths (no email provider, or send
   *   failure). Mirrors the silent-success contract of
   *   {@link generatePasswordResetToken}.
   * @throws NextlyError on DB errors.
   */
  async generateEmailVerificationToken(
    email: string,
    options?: { redirectPath?: string; disableEmail?: boolean }
  ): Promise<{ token?: string }> {
    // The account selection is the canonical resolver's — exact spelling
    // first, then the normalized form — so a resend verifies the same
    // account a lookup names, and any future change to how legacy rows are
    // resolved lands in one place.
    const queryService = new UserQueryService(this.adapter, this.logger);

    try {
      const user = await queryService.findByEmail(email);

      // Silent success either way, so neither case reveals the account.
      if (!user || !(await this.awaitsVerificationLink(user))) {
        return {};
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      // The token is keyed to the matched account's STORED spelling:
      // verifyEmail redeems it only while the account holds exactly that
      // address, so a legacy mixed-case row keyed by its canonical form could
      // never be verified.
      const identifier = user.email;
      const expiresAt = new Date(Date.now() + AUTH_TOKEN_LIFETIME_MS);

      // Issued for the matched account, holding its row, as a reset link is.
      // An account that moved or was deleted since the lookup gets nothing.
      const issued = await this.issueToken("email-verification", {
        email: identifier,
        userId: String(user.id),
        tokenHash,
        expiresAt,
      });
      if (!issued) return {};

      if (options?.disableEmail) {
        return { token: rawToken };
      }

      return await this.deliverVerificationEmail(
        email,
        { id: String(user.id), name: user.name, email: user.email },
        rawToken,
        options?.redirectPath
      );
    } catch (error) {
      // A malformed address surfaces as the resolver's VALIDATION_ERROR, not
      // as a database failure dressed up as a 500.
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Whether a verification link would do anything for this account.
   *
   * Not for an address already verified: the link would mail someone who only
   * forgot their password. Not for an account an administrator deactivated:
   * following the link no longer switches it on, so it would only invite the
   * owner to try.
   */
  private async awaitsVerificationLink(user: {
    id: string | number;
    emailVerified?: Date | string | null;
  }): Promise<boolean> {
    if (user.emailVerified) return false;
    const row = await this.db.query.users.findFirst({
      where: { id: requireFilterValue(String(user.id), "userId") },
      columns: { deactivatedAt: true },
    });
    return !row?.deactivatedAt;
  }

  /**
   * Send the verification link, or hand back the token when nothing could.
   *
   * Separate from issuing the token so that method reads as the decision —
   * which account, and whether it needs a link at all — and this one as the
   * delivery and its fallback.
   */
  private async deliverVerificationEmail(
    email: string,
    recipient: { id: string; name: string | null; email: string },
    rawToken: string,
    redirectPath: string | undefined
  ): Promise<{ token?: string }> {
    if (!this.emailService) {
      this.logger.warn(
        "No email provider is configured, so the verification token could not be delivered",
        { event: "auth.email_verification.email_unconfigured" }
      );
      return this.undeliveredTokenFallback(rawToken);
    }

    let delivered = false;
    try {
      // Same reasoning as the password-reset path: a provider failure
      // arrives as `{ success: false }`, not as a throw, so the result is
      // the only evidence that nothing reached the user.
      const result = await this.emailService.sendEmailVerificationEmail(
        email,
        { name: recipient.name, email: recipient.email },
        rawToken,
        // Names the staff user on the delivery records.
        { path: redirectPath, staffUserId: recipient.id }
      );
      delivered = result.success;
      if (!delivered) {
        this.logger.error("Email verification message was not delivered", {
          event: "auth.email_verification.email_failed",
          reason: "not-delivered-to-recipient",
        });
      }
    } catch (emailError) {
      this.logger.error("Failed to send email verification email", {
        event: "auth.email_verification.email_failed",
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
      });
    }

    return delivered ? {} : this.undeliveredTokenFallback(rawToken);
  }

  /**
   * Verify email with token.
   *
   * @returns The verified email address.
   * @throws NextlyError(VALIDATION_ERROR) when the token is unknown.
   * @throws NextlyError(TOKEN_EXPIRED) when the token is past expiry.
   * @throws NextlyError on DB errors during the verification transaction.
   */
  async verifyEmail(token: string): Promise<{ email: string }> {
    const verificationToken = await this.findVerificationToken(token);

    if (!verificationToken) {
      throw NextlyError.validation({
        errors: [
          {
            path: "token",
            code: "INVALID",
            message:
              "The verification link is invalid or has already been used.",
          },
        ],
        logContext: { reason: "verification-token-not-found" },
      });
    }

    if (tokenExpired(verificationToken)) {
      throw new NextlyError({
        code: "TOKEN_EXPIRED",
        publicMessage: "Your session has expired. Please sign in again.",
        logContext: {
          reason: "verification-token-expired",
          tokenId: verificationToken.id,
          expiredAt: verificationToken.expires,
        },
      });
    }

    const email = verificationToken.identifier;
    const { emailVerificationTokens, users } = this.tables;

    try {
      // Checked, applied and spent in one transaction, holding the account's
      // row, so an address change or a deletion running at the same time is
      // ordered against it.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TokenTransaction;
        const account = await this.redeemingAccount(tx, verificationToken);
        if (!account) {
          throw this.invalidVerificationLinkError({
            reason: "verification-token-account-changed",
            tokenId: verificationToken.id,
          });
        }

        // Spent first, by exactly one caller; zero rows means another
        // redemption spent it, or an address change revoked it, since the
        // read above.
        const spent = await tx
          .delete(emailVerificationTokens)
          .where(
            and(
              eq(emailVerificationTokens.id, verificationToken.id),
              eq(emailVerificationTokens.userId, account.id)
            )
          );
        if (affectedRowCount(spent, this.dialect) !== 1) {
          throw this.invalidVerificationLinkError({
            reason: "verification-token-spent-or-revoked",
            tokenId: verificationToken.id,
          });
        }

        // Mark the email verified, and activate the account. Self-verification
        // (whether initiated by /auth/register or by an admin invite with
        // sendWelcomeEmail=true) is what activates the account — both
        // paths funnel through here. An admin can still manually activate
        // a user without email verification via the user-mutation path.
        await tx
          .update(users)
          .set(emailVerificationColumns(new Date(), "link"))
          .where(eq(users.id, account.id));
        // Activation is conditional in the statement itself: an account an
        // administrator deactivated stays inactive, including when its link
        // was sent before the deactivation. The address is still verified —
        // following the link proved it — so reactivating needs no new link.
        await tx
          .update(users)
          .set({ isActive: true })
          .where(and(eq(users.id, account.id), isNull(users.deactivatedAt)));
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors before mapping.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    emitAuthEvent("emailVerified", { email });

    return { email };
  }

  /**
   * Mint a single-use set-password link for an existing account.
   *
   * The link is the artifact an admin hands to a new user; email is only ever
   * one way to deliver it. Follows the same shape as a password-reset token —
   * a 256-bit random value of which only the SHA-256 hash is stored, one active
   * token per account — but keyed on the user id and given a longer life.
   *
   * The raw token is returned to the caller and never persisted. There is no
   * way to recover it afterwards; mint a new one instead.
   */
  async generateInviteToken(userId: string): Promise<InviteTokenResult> {
    const user = await this.db.query.users.findFirst({
      // rqb v2 object filter (drizzle v1)
      where: { id: requireFilterValue(userId, "userId") },
      columns: { id: true, deactivatedAt: true },
    });
    if (!user) {
      throw NextlyError.notFound({ logContext: { userId } });
    }
    // Accepting an invite is refused while the account is deactivated, so a
    // link minted now could only ever fail for the person it was sent to.
    // The administrator is told instead, while they can still act on it.
    if (user.deactivatedAt) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This account is deactivated. Activate it before sending an invite.",
        logContext: { userId },
      });
    }

    const {
      token: rawToken,
      tokenHash,
      expiresAt,
    } = generateInviteTokenValue();

    try {
      // One active invite per account, in one transaction: a freshly minted
      // link supersedes any earlier one, and if the insert fails the delete
      // rolls back so the previous link stays valid rather than the account
      // being left with none. The unique index on user_id serialises two
      // concurrent re-invites so they cannot both leave a live link.
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;
        await tx
          .delete(this.tables.userInviteTokens)
          .where(eq(this.tables.userInviteTokens.userId, userId));

        await tx.insert(this.tables.userInviteTokens).values({
          userId,
          tokenHash,
          expires: expiresAt,
        });
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return { token: rawToken, expiresAt };
  }

  /** The one public error every unusable-invite path returns. */
  private invalidInviteError(
    logContext?: Record<string, unknown>
  ): NextlyError {
    return NextlyError.validation({
      errors: [
        {
          path: "token",
          code: "INVALID_INVITE",
          message: "This invite link is invalid or has expired.",
        },
      ],
      logContext,
    });
  }

  /**
   * Accept an invite: set the account's password and let it sign in.
   *
   * Clicking a link that was delivered to an address is itself proof of the
   * address, so acceptance sets `emailVerified` and `isActive` alongside the
   * password in one transaction — there is no separate verification round trip,
   * and no window where the account has a password but still cannot sign in.
   *
   * An account an administrator deactivated is refused instead, without
   * setting the password: an invite must not set credentials on, or switch
   * back on, an account someone turned off.
   *
   * The failure messages do not distinguish "never existed" from "already
   * used" from "expired-by-a-second" from "deactivated", to avoid confirming
   * which invites are live to whoever holds a guessed token.
   */
  async acceptInvite(
    token: string,
    newPassword: string
  ): Promise<AcceptInviteResult> {
    const invite = await this.findUnusedInviteToken(token);

    // Unknown, already used, and expired all return the same error, so a
    // guessed token cannot tell a live invite from a dead one. The expiry
    // detail is kept for the log only.
    if (!invite || tokenExpired(invite)) {
      throw this.invalidInviteError(
        invite ? { inviteId: invite.id, expiredAt: invite.expires } : undefined
      );
    }

    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "newPassword",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    const passwordHash = await hashPasswordBcrypt(newPassword);

    // Claim the token before touching the account. Two acceptances can both
    // pass the read above; the conditional update lets exactly one flip
    // usedAt from null, and only that one goes on to set the password — so a
    // race cannot end with two different passwords, last-writer-wins.
    let claimed = false;
    try {
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;

        const claim = await tx
          .update(this.tables.userInviteTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(this.tables.userInviteTokens.id, invite.id),
              isNull(this.tables.userInviteTokens.usedAt),
              gt(this.tables.userInviteTokens.expires, new Date())
            )
          );

        // Zero rows: another acceptance already claimed it, or it expired
        // between the read and here. Leave the account untouched.
        if (affectedRowCount(claim, this.dialect) !== 1) return;
        claimed = true;

        // Conditional on the account not being deactivated by an
        // administrator, in the same statement that sets the password: an
        // invite must not set credentials on, or re-activate, an account an
        // administrator switched off. Throwing here rolls the claim back too,
        // and the refusal reads like any other dead invite. Through the
        // shared password write, so any session the account already holds
        // ends with the password it was issued under.
        const accepted = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId: invite.userId,
            adapter: this.adapter,
            set: {
              ...passwordColumns(passwordHash),
              // Receiving the invite at this address is what proves it.
              ...emailVerificationColumns(new Date(), "invite"),
              isActive: true,
            },
            unlessDeactivated: true,
          }
        );
        if (accepted !== 1) {
          throw this.invalidInviteError({
            inviteId: invite.id,
            reason: "account-deactivated",
          });
        }
      });
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    if (!claimed) {
      throw this.invalidInviteError({
        inviteId: invite.id,
        reason: "already-claimed",
      });
    }

    // No auth event is emitted: the closest existing one, passwordChanged,
    // carries "an established password was rotated" semantics and its listeners
    // (e.g. a security-notification email) would be wrong for a first set.

    return { userId: invite.userId };
  }

  /**
   * Replace an admin-set password on forced first sign-in and clear the
   * must-change flag (ASVS 6.4.1). The update is conditional on the flag still
   * being set, so a replayed or concurrent call cannot re-set the password
   * after it has already been changed — exactly one call flips the flag, and
   * only that one writes the new password.
   *
   * Returns the password version it wrote, as stored, so the session the
   * change goes on to issue is judged against this password and not against
   * whatever a later read finds.
   *
   * @throws NextlyError(VALIDATION_ERROR) on a weak password.
   * @throws NextlyError(INVALID_INPUT) when the account is not (or is no longer)
   *   in the must-change state.
   */
  async setInitialPassword(
    userId: string,
    newPassword: string
  ): Promise<{
    userId: string;
    passwordUpdatedAt: Date | null;
    sessionEpoch: number;
  }> {
    const passwordStrength = validatePasswordStrength(newPassword);
    if (!passwordStrength.ok) {
      throw NextlyError.validation({
        errors: passwordStrength.errors.map(message => ({
          path: "newPassword",
          code: "WEAK_PASSWORD",
          message,
        })),
      });
    }

    // The admin-set password must actually be replaced. A fresh bcrypt salt
    // makes the same plaintext hash differently, so without this check a person
    // could "set" the temporary password again — clearing the flag while
    // leaving the password the admin knows (ASVS 6.4.1). Reject a match, and
    // reject an account that is not (or no longer) in the must-change state.
    const current = await this.db.query.users.findFirst({
      // rqb v2 object filter (drizzle v1)
      where: { id: requireFilterValue(userId, "userId") },
      columns: { passwordHash: true, mustChangePassword: true },
    });
    if (!current || current.mustChangePassword !== true) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This request is no longer valid. Please sign in again.",
        logContext: { userId, reason: auditReason("not-in-must-change-state") },
      });
    }
    if (
      current.passwordHash &&
      (await verifyPasswordBcrypt(newPassword, current.passwordHash))
    ) {
      throw NextlyError.validation({
        errors: [
          {
            path: "newPassword",
            code: "PASSWORD_REUSED",
            message:
              "Choose a password different from the temporary one you were given.",
          },
        ],
      });
    }

    const passwordHash = await hashPasswordBcrypt(newPassword);

    // The version as stored, read back in the transaction that wrote it:
    // MySQL and SQLite keep whole seconds, so the value written here is not
    // the one a later read compares against. The session epoch the write
    // raised comes back with it, for the same reason: it is what tells a
    // reset in the same second apart.
    let written:
      | { passwordUpdatedAt: Date | null; sessionEpoch: number | null }
      | undefined;
    try {
      await this.withTransaction(async txRaw => {
        const tx = txRaw as TransactionLike;
        // Through the shared password write, so the account's sessions end
        // with the admin-set password. Conditional on the flag still being
        // set and, in the same statement, on the account not being
        // deactivated: an administrator may have switched it off after the
        // pending token was issued, and a zero-row write falls to the
        // not-in-must-change-state refusal below — no password planted for a
        // later reactivation to switch on.
        const claimed = await updateUserEndingSessions(
          tx,
          this.tables,
          this.dialect,
          {
            userId,
            set: passwordColumns(passwordHash),
            unlessDeactivated: true,
            when: eq(this.tables.users.mustChangePassword, true),
            adapter: this.adapter,
          }
        );
        if (claimed !== 1) return;
        const [row] = await tx
          .select({
            passwordUpdatedAt: this.tables.users.passwordUpdatedAt,
            sessionEpoch: this.tables.users.sessionEpoch,
          })
          .from(this.tables.users)
          .where(eq(this.tables.users.id, userId))
          .limit(1);
        written = row;
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    if (!written) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "This request is no longer valid. Please sign in again.",
        logContext: { userId, reason: auditReason("not-in-must-change-state") },
      });
    }

    return {
      userId,
      passwordUpdatedAt: written.passwordUpdatedAt,
      sessionEpoch: Number(written.sessionEpoch ?? 0),
    };
  }

  /**
   * The address a live password-reset token was issued to, or `null` when
   * the token is unknown, used or expired. Reads only: the token stays
   * usable. The auth limiter asks it to count a reset whose client address
   * cannot be resolved against the account it would reset.
   */
  async resetTokenOwner(token: string): Promise<string | null> {
    const row = await this.findUnusedResetToken(token);
    return row && !tokenExpired(row) ? row.identifier : null;
  }

  /**
   * The address a live email-verification token was issued to, or `null`
   * when it is unknown or expired. Reads only, as {@link resetTokenOwner}.
   */
  async verificationTokenOwner(token: string): Promise<string | null> {
    const row = await this.findVerificationToken(token);
    return row && !tokenExpired(row) ? row.identifier : null;
  }

  /**
   * The address of the account a live invite token sets up, or `null` when
   * the invite is unknown, used or expired, or its account is gone. Reads
   * only, as {@link resetTokenOwner}.
   */
  async inviteTokenOwner(token: string): Promise<string | null> {
    const invite = await this.findUnusedInviteToken(token);
    if (!invite || tokenExpired(invite)) return null;
    let user: { email: string } | undefined;
    try {
      user = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(invite.userId, "id") },
        columns: { email: true },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
    return user?.email ?? null;
  }

  /*
   * The stored-token reads. Each is the ONE read of its kind: the method that
   * consumes a token and the lookup that names its owner both make it, and
   * both judge the row with `tokenExpired`, so the two cannot come to
   * disagree about which tokens are live.
   */

  /** The unused password-reset token stored for `token`, if any. */
  private async findUnusedResetToken(
    token: string
  ): Promise<StoredTokenRow | undefined> {
    const tokenHash = storedTokenHash(token);
    try {
      return await this.db.query.passwordResetTokens.findFirst({
        where: {
          tokenHash: requireFilterValue(tokenHash, "tokenHash"),
          usedAt: { isNull: true },
        },
        columns: { id: true, identifier: true, userId: true, expires: true },
      });
    } catch (error) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /** The email-verification token stored for `token`, if any. */
  private async findVerificationToken(
    token: string
  ): Promise<StoredTokenRow | undefined> {
    const tokenHash = storedTokenHash(token);
    try {
      return await this.db.query.emailVerificationTokens.findFirst({
        where: { tokenHash: requireFilterValue(tokenHash, "tokenHash") },
        columns: { id: true, identifier: true, userId: true, expires: true },
      });
    } catch (error) {
      // Normalise raw driver errors so the DB kind is preserved.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /** The unused invite stored for `token`, if any. */
  private async findUnusedInviteToken(
    token: string
  ): Promise<{ id: number; userId: string; expires: Date } | undefined> {
    const tokenHash = hashInviteToken(token);
    try {
      return await this.db.query.userInviteTokens.findFirst({
        // rqb v2 object filter (drizzle v1): unused invite for this hash.
        where: { tokenHash, usedAt: { isNull: true } },
        columns: { id: true, userId: true, expires: true },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();

    try {
      await this.db
        .delete(this.tables.passwordResetTokens)
        .where(lt(this.tables.passwordResetTokens.expires, now));

      await this.db
        .delete(this.tables.emailVerificationTokens)
        .where(lt(this.tables.emailVerificationTokens.expires, now));

      await this.db
        .delete(this.tables.userInviteTokens)
        .where(lt(this.tables.userInviteTokens.expires, now));
    } catch (error) {
      this.logger.error("Failed to cleanup expired tokens", { error: error });
    }
  }
}
