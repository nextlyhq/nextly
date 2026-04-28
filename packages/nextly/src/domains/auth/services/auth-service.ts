import { randomBytes, createHash } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, and, lt, isNull } from "drizzle-orm";

import {
  verifyPassword as verifyPasswordBcrypt,
  hashPassword as hashPasswordBcrypt,
  validatePasswordStrength,
} from "@nextly/auth/password";
import { EmailSchema } from "@nextly/schemas/validation";
import type { MinimalUser } from "@nextly/types/auth";

// PR 4 migration: switched from ServiceError + mapDbErrorToServiceError result
// shapes to throw-based NextlyError. Successful methods now return their data
// directly (or void); failures throw a NextlyError instance the consumer
// catches via try/catch or lets the unified error handler convert to JSON.
import { NextlyError } from "../../../errors/nextly-error";
import { BaseService } from "../../../services/base-service";
import type { EmailService } from "../../../services/email/email-service";
import type { Logger } from "../../../services/shared";

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
 * - Recommended: Run as a scheduled job (cron/scheduled task) every 24 hours
 * - Safe to run frequently as it only deletes expired tokens
 * - Prevents token table bloat and maintains database performance
 *
 * @example
 * ```typescript
 * // Periodic cleanup (run in scheduled job)
 * await authService.cleanupExpiredTokens();
 * ```
 */
export class AuthService extends BaseService {
  private readonly TOKEN_EXPIRY_HOURS = 24;

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
  // Drizzle native on PG/MySQL and manual BEGIN/COMMIT on SQLite.
  // Do NOT override it here — the base class's dialect-aware routing
  // is what makes async transaction callbacks work on all three dialects.

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
      const userService = new (
        await import("../../../services/users")
      ).UsersService(this.adapter, this.logger);
      newUser = await userService.createLocalUser({
        email: userData.email,
        name: userData.name ?? "User",
        password: userData.password,
      });
    } catch (error) {
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(error);
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
   * NOTE: Per the migration spec, account-state checks (locked / disabled
   * accounts, etc.) move to PR 5 — this method preserves today's behavior.
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
      where: eq(this.tables.users.email, normalizedEmail),
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
          reason: !user ? "user-not-found" : "no-password-hash",
        },
      });
    }

    const isValidPassword = await verifyPasswordBcrypt(
      password,
      user.passwordHash
    );

    if (!isValidPassword) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: "password-mismatch", userId: user.id },
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
        where: eq(this.tables.users.id, userId),
        columns: {
          passwordHash: true,
        },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

    if (!user || !user.passwordHash) {
      // Same generic message as a wrong-password leg. Operator-only context
      // captures whether the user existed for debug purposes.
      throw NextlyError.invalidCredentials({
        logContext: {
          reason: !user ? "user-not-found" : "no-password-hash",
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
        logContext: { reason: "current-password-mismatch", userId },
      });
    }

    const newPasswordHash = await hashPasswordBcrypt(newPassword);

    try {
      await this.db
        .update(this.tables.users)
        .set({
          passwordHash: newPasswordHash,
          passwordUpdatedAt: new Date(),
        })
        .where(eq(this.tables.users.id, userId));
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }
  }

  /**
   * Generate password reset token
   *
   * @param email - User email address
   * @param options.disableEmail - Skip sending the reset email and always return the token
   * @param options.expiration - Token lifetime in seconds (defaults to TOKEN_EXPIRY_HOURS)
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
        : this.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;

    // Normalize email to ensure consistent matching with verifyCredentials
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const user = await this.db.query.users.findFirst({
        where: eq(this.tables.users.email, normalizedEmail),
        columns: {
          id: true,
          email: true,
          name: true,
        },
      });

      if (!user) {
        // Silent success: don't reveal whether the email exists. Same shape
        // as a successful run with no token (since email "would have been
        // sent" in the normal flow).
        return {};
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      await this.db
        .delete(this.tables.passwordResetTokens)
        .where(eq(this.tables.passwordResetTokens.identifier, normalizedEmail));

      const expiresAt = new Date(Date.now() + expirationMs);

      await this.db.insert(this.tables.passwordResetTokens).values({
        identifier: normalizedEmail,
        tokenHash,
        expires: expiresAt,
      });

      if (disableEmail) {
        return { token: rawToken };
      }

      if (this.emailService) {
        try {
          await this.emailService.sendPasswordResetEmail(
            normalizedEmail,
            { name: user.name, email: user.email },
            rawToken,
            { path: options?.redirectPath }
          );
        } catch (emailError) {
          // Email failure should not prevent token generation
          console.warn(
            "[AuthService] Failed to send password reset email:",
            emailError instanceof Error
              ? emailError.message
              : String(emailError)
          );
          // Return token in response as dev fallback when email fails
          return { token: rawToken };
        }

        // IMPORTANT: Email sent successfully — do NOT return token (security)
        return {};
      }

      // No email service configured — dev fallback: return token in response
      console.warn(
        "[AuthService] No email service configured. Returning password reset token in response. Configure an email provider for production use."
      );
      return { token: rawToken };
    } catch (error) {
      // DB errors are mapped to NextlyError. Generic public messages keep us
      // from leaking schema or driver text.
      throw NextlyError.fromDatabaseError(error);
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
    let resetToken;
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");

      resetToken = await this.db.query.passwordResetTokens.findFirst({
        where: and(
          eq(this.tables.passwordResetTokens.tokenHash, tokenHash),
          isNull(this.tables.passwordResetTokens.usedAt)
        ),
        columns: {
          id: true,
          identifier: true,
          expires: true,
        },
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

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

    if (resetToken.expires < new Date()) {
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

    const targetUser = await this.db.query.users.findFirst({
      where: eq(this.tables.users.email, email),
      columns: { id: true },
    });

    if (!targetUser) {
      // Token claims to belong to an email that no longer maps to a user.
      // Treat as invalid token rather than 500 — public message stays
      // generic; the orphan token is logged for operators.
      throw NextlyError.validation({
        errors: [
          {
            path: "token",
            code: "INVALID",
            message: "The reset link is invalid.",
          },
        ],
        logContext: { reason: "reset-token-orphan", tokenId: resetToken.id },
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

      // Update password by user ID (same pattern as changePassword — avoids
      // transaction/email-matching issues that caused the update to silently
      // affect 0 rows)
      await this.db
        .update(this.tables.users)
        .set({
          passwordHash,
          passwordUpdatedAt: new Date(),
        })
        .where(eq(this.tables.users.id, targetUser.id));

      await this.db
        .update(this.tables.passwordResetTokens)
        .set({
          usedAt: new Date(),
        })
        .where(eq(this.tables.passwordResetTokens.id, resetToken.id));
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

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
    try {
      const user = await this.db.query.users.findFirst({
        where: eq(this.tables.users.email, email),
        columns: {
          id: true,
          email: true,
          name: true,
        },
      });

      if (!user) {
        // Silent success — never reveal whether the email is registered.
        return {};
      }

      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      await this.db
        .delete(this.tables.emailVerificationTokens)
        .where(eq(this.tables.emailVerificationTokens.identifier, email));

      const expiresAt = new Date(
        Date.now() + this.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000
      );

      await this.db.insert(this.tables.emailVerificationTokens).values({
        identifier: email,
        tokenHash,
        expires: expiresAt,
      });

      if (options?.disableEmail) {
        return { token: rawToken };
      }

      if (this.emailService) {
        try {
          await this.emailService.sendEmailVerificationEmail(
            email,
            { name: user.name, email: user.email },
            rawToken,
            { path: options?.redirectPath }
          );
        } catch (emailError) {
          // Email failure should not prevent token generation
          console.warn(
            "[AuthService] Failed to send email verification email:",
            emailError instanceof Error
              ? emailError.message
              : String(emailError)
          );
          // Return token in response as dev fallback when email fails
          return { token: rawToken };
        }

        // IMPORTANT: Email sent successfully — do NOT return token (security)
        return {};
      }

      // No email service configured — dev fallback: return token in response
      console.warn(
        "[AuthService] No email service configured. Returning email verification token in response. Configure an email provider for production use."
      );
      return { token: rawToken };
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }
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
    let verificationToken;
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");

      verificationToken = await this.db.query.emailVerificationTokens.findFirst(
        {
          where: eq(this.tables.emailVerificationTokens.tokenHash, tokenHash),
          columns: {
            id: true,
            identifier: true,
            expires: true,
          },
        }
      );
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

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

    if (verificationToken.expires < new Date()) {
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

    try {
      // tx is a Drizzle transaction (NodePgTransaction / MySql2Transaction /
      // BetterSQLite3Transaction depending on dialect) that exposes the same
      // fluent query API as this.db.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.withTransaction(async (tx: any) => {
        // IMPORTANT: Mark email as verified AND activate the user. Self-verification
        // (whether initiated by /auth/register or by an admin invite with
        // sendWelcomeEmail=true) is what activates the account — both
        // paths funnel through here. An admin can still manually activate
        // a user without email verification via the user-mutation path.
        await tx
          .update(this.tables.users)
          .set({
            emailVerified: new Date(),
            isActive: true,
          })
          .where(eq(this.tables.users.email, email));

        await tx
          .delete(this.tables.emailVerificationTokens)
          .where(
            eq(this.tables.emailVerificationTokens.id, verificationToken.id)
          );
      });
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

    return { email };
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

      // Auth.js verification tokens
      await this.db
        .delete(this.tables.verificationTokens)
        .where(lt(this.tables.verificationTokens.expires, now));
    } catch (error) {
      console.error("Failed to cleanup expired tokens:", error);
    }
  }
}
