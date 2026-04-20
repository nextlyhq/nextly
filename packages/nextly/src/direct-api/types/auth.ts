/**
 * Direct API Authentication Type Definitions
 *
 * Argument and result types for login, registration, password reset,
 * email verification, and related auth operations.
 *
 * @packageDocumentation
 */

/**
 * Arguments for the auth() method - getting current user and permissions.
 */
export interface AuthArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Request headers containing auth token */
  headers?: Record<string, string>;
}

/**
 * Arguments for logging in a user.
 *
 * @example
 * ```typescript
 * const { user, token } = await nextly.login({
 *   collection: 'users',
 *   email: 'user@example.com',
 *   password: 'secure-password',
 * });
 * ```
 */
export interface LoginArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** User email (required) */
  email: string;

  /** User password (required) */
  password: string;
}

/**
 * Arguments for logging out a user.
 */
export interface LogoutArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;
}

/**
 * Arguments for registering a new user.
 *
 * @example
 * ```typescript
 * const { user, token } = await nextly.register({
 *   collection: 'users',
 *   email: 'newuser@example.com',
 *   password: 'secure-password',
 *   name: 'New User',
 * });
 * ```
 */
export interface RegisterArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** User email (required) */
  email: string;

  /** User password (required) */
  password: string;

  /** Additional user data */
  [key: string]: unknown;
}

/**
 * Arguments for changing a user's password.
 */
export interface ChangePasswordArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Current password (required) */
  currentPassword: string;

  /** New password (required) */
  newPassword: string;
}

/**
 * Arguments for initiating password reset.
 */
export interface ForgotPasswordArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** User email (required) */
  email: string;

  /**
   * Disable sending the password reset email.
   *
   * When `true`, returns the reset token without sending email.
   * Useful for custom email handling.
   *
   * @default false
   */
  disableEmail?: boolean;

  /**
   * Token expiration time in seconds.
   *
   * @default 3600 (1 hour)
   */
  expiration?: number;

  /**
   * Custom path for the password reset page link in the email.
   * Must be a relative path starting with `/`.
   * The full URL is constructed as `{baseUrl}{redirectPath}?token=...`.
   *
   * Overrides `emailConfig.resetPasswordPath` for this request.
   *
   * @default '/admin/reset-password' (or value from EmailConfig.resetPasswordPath)
   * @example '/auth/reset-password'
   */
  redirectPath?: string;
}

/**
 * Arguments for resetting password with token.
 */
export interface ResetPasswordArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Password reset token (required) */
  token: string;

  /** New password (required) */
  password: string;
}

/**
 * Arguments for verifying user email.
 */
export interface VerifyEmailArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** Email verification token (required) */
  token: string;
}

/**
 * Arguments for unlocking a locked account.
 */
export interface UnlockArgs {
  /** User collection slug (defaults to 'users') */
  collection?: string;

  /** User email (required) */
  email: string;
}

/**
 * Result of a login operation.
 */
export interface LoginResult {
  /** Authenticated user object */
  user: Record<string, unknown>;

  /** JWT token for subsequent requests */
  token: string;

  /** Token expiration timestamp */
  exp: number;
}

/**
 * Result of a registration operation.
 */
export interface RegisterResult extends LoginResult {}

/**
 * Result of an auth check.
 */
export interface AuthResult {
  /** Current user (null if not authenticated) */
  user: Record<string, unknown> | null;

  /** User's permissions */
  permissions?: Record<string, unknown>;
}
