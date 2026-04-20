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

import { BaseService } from "../../../services/base-service";
import type { EmailService } from "../../../services/email/email-service";
import { mapDbErrorToServiceError } from "../../../services/lib/db-error";
import type { Logger } from "../../../services/shared";

interface RegisterUserData {
  email: string;
  password: string;
  name?: string;
}

interface VerifyCredentialsResult {
  success: boolean;
  user?: MinimalUser;
  error?: string;
}

interface ResetPasswordTokenResult {
  success: boolean;
  token?: string;
  error?: string;
}

interface ConsumeResetTokenResult {
  success: boolean;
  email?: string;
  error?: string;
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
   * Register a new user with email and password
   */
  async registerUser(userData: RegisterUserData): Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: MinimalUser | null;
  }> {
    try {
      const passwordStrength = validatePasswordStrength(userData.password);
      if (!passwordStrength.ok) {
        return {
          success: false,
          statusCode: 400,
          message: passwordStrength.errors.join(", "),
          data: null,
        };
      }

      const userService = new (
        await import("../../../services/users")
      ).UsersService(this.adapter, this.logger);
      const newUser = await userService.createLocalUser({
        email: userData.email,
        name: userData.name ?? "User",
        password: userData.password,
      });

      if (!newUser.success) {
        return {
          success: false,
          statusCode: newUser.statusCode,
          message: newUser.message,
          data: null,
        };
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

      return {
        success: true,
        statusCode: 201,
        message: "User registered successfully",
        data: newUser.data,
      };
    } catch (error) {
      return mapDbErrorToServiceError(error, {
        defaultMessage: "Failed to register user",
        "unique-violation": "User with this email already exists",
        constraint: "User with this email already exists",
      });
    }
  }

  /**
   * Verify user credentials for login
   */
  async verifyCredentials(
    email: string,
    password: string
  ): Promise<VerifyCredentialsResult> {
    try {
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
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      const isValidPassword = await verifyPasswordBcrypt(
        password,
        user.passwordHash
      );

      if (!isValidPassword) {
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
          passwordHash: null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.db.query.users.findFirst({
        where: eq(this.tables.users.id, userId),
        columns: {
          passwordHash: true,
        },
      });

      if (!user || !user.passwordHash) {
        return {
          success: false,
          error: "User not found or no password set",
        };
      }

      const isValidPassword = await verifyPasswordBcrypt(
        currentPassword,
        user.passwordHash
      );

      if (!isValidPassword) {
        return {
          success: false,
          error: "Current password is incorrect",
        };
      }

      const newPasswordHash = await hashPasswordBcrypt(newPassword);

      await this.db
        .update(this.tables.users)
        .set({
          passwordHash: newPasswordHash,
          passwordUpdatedAt: new Date(),
        })
        .where(eq(this.tables.users.id, userId));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to change password",
      };
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
        // Don't reveal if email exists for security
        return {
          success: true,
        };
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
        return {
          success: true,
          token: rawToken,
        };
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
          return {
            success: true,
            token: rawToken,
          };
        }

        // IMPORTANT: Email sent successfully — do NOT return token (security)
        return {
          success: true,
        };
      }

      // No email service configured — dev fallback: return token in response
      console.warn(
        "[AuthService] No email service configured. Returning password reset token in response. Configure an email provider for production use."
      );
      return {
        success: true,
        token: rawToken,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate reset token",
      };
    }
  }

  /**
   * Consume password reset token and reset password
   */
  async resetPasswordWithToken(
    token: string,
    newPassword: string
  ): Promise<ConsumeResetTokenResult> {
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const resetToken = await this.db.query.passwordResetTokens.findFirst({
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

      if (!resetToken) {
        return {
          success: false,
          error: "Invalid or expired reset token",
        };
      }

      if (resetToken.expires < new Date()) {
        return {
          success: false,
          error: "Reset token has expired",
        };
      }

      const email = resetToken.identifier;

      const targetUser = await this.db.query.users.findFirst({
        where: eq(this.tables.users.email, email),
        columns: { id: true },
      });

      if (!targetUser) {
        return {
          success: false,
          error: "User not found for this reset token",
        };
      }

      const passwordStrength = validatePasswordStrength(newPassword);
      if (!passwordStrength.ok) {
        return {
          success: false,
          error: passwordStrength.errors.join(", "),
        };
      }

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

      return {
        success: true,
        email,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to reset password",
      };
    }
  }

  /**
   * Send email verification token
   */
  async generateEmailVerificationToken(
    email: string,
    options?: { redirectPath?: string; disableEmail?: boolean }
  ): Promise<{
    success: boolean;
    token?: string;
    error?: string;
  }> {
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
        // Don't reveal if email exists for security
        return {
          success: true,
        };
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
        return {
          success: true,
          token: rawToken,
        };
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
          return {
            success: true,
            token: rawToken,
          };
        }

        // IMPORTANT: Email sent successfully — do NOT return token (security)
        return {
          success: true,
        };
      }

      // No email service configured — dev fallback: return token in response
      console.warn(
        "[AuthService] No email service configured. Returning email verification token in response. Configure an email provider for production use."
      );
      return {
        success: true,
        token: rawToken,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate verification token",
      };
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<{
    success: boolean;
    email?: string;
    error?: string;
  }> {
    try {
      const tokenHash = createHash("sha256").update(token).digest("hex");

      const verificationToken =
        await this.db.query.emailVerificationTokens.findFirst({
          where: eq(this.tables.emailVerificationTokens.tokenHash, tokenHash),
          columns: {
            id: true,
            identifier: true,
            expires: true,
          },
        });

      if (!verificationToken) {
        return {
          success: false,
          error: "Invalid or expired verification token",
        };
      }

      if (verificationToken.expires < new Date()) {
        return {
          success: false,
          error: "Verification token has expired",
        };
      }

      const email = verificationToken.identifier;

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

      return {
        success: true,
        email,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to verify email",
      };
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

      // Auth.js verification tokens
      await this.db
        .delete(this.tables.verificationTokens)
        .where(lt(this.tables.verificationTokens.expires, now));
    } catch (error) {
      console.error("Failed to cleanup expired tokens:", error);
    }
  }
}
