/**
 * Direct API Auth Namespace
 *
 * Top-level authentication methods: login, logout, me/updateMe, register,
 * password reset, email verification. These hang directly off the `Nextly`
 * class root (e.g. `nextly.login(...)`).
 *
 * @packageDocumentation
 */

import { buildClaims } from "../../auth/jwt/claims.js";
import { signAccessToken } from "../../auth/jwt/sign.js";
import { env } from "../../lib/env";
import {
  NextlyError,
  NextlyErrorCode,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../errors";
import type {
  AuthResult,
  ChangePasswordArgs,
  ForgotPasswordArgs,
  LoginArgs,
  LoginResult,
  RegisterArgs,
  ResetPasswordArgs,
  UserContext,
  VerifyEmailArgs,
} from "../types/index";

import type { NextlyContext } from "./context";

/**
 * Verify user credentials and return a signed JWT session token.
 */
export async function login(
  ctx: NextlyContext,
  args: LoginArgs
): Promise<LoginResult> {
  const result = await ctx.authService.verifyCredentials(
    args.email,
    args.password
  );

  if (!result.success || !result.user) {
    throw new UnauthorizedError(result.error || "Invalid email or password");
  }

  const secret = env.NEXTLY_SECRET_RESOLVED;
  if (!secret) {
    throw new NextlyError(
      "NEXTLY_SECRET is not configured. Set NEXTLY_SECRET in your environment variables.",
      NextlyErrorCode.INTERNAL_ERROR,
      500
    );
  }

  const maxAge = 30 * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + maxAge;

  const claims = buildClaims({
    userId: String(result.user.id),
    email: result.user.email,
    name: result.user.name || "",
    image: result.user.image ?? null,
    roleIds: [],
  });
  const token = await signAccessToken(claims, secret, maxAge);

  return {
    user: result.user as Record<string, unknown>,
    token,
    exp,
  };
}

/**
 * Logout operation (no-op for Direct API — session management lives in the app).
 */
export async function logout(): Promise<void> {
  return;
}

/**
 * Fetch the current user's profile.
 *
 * Requires an explicit `user.id` (Direct API has no implicit session state).
 */
export async function me(
  ctx: NextlyContext,
  args: { user: UserContext }
): Promise<AuthResult> {
  if (!args.user?.id) {
    throw new NextlyError(
      "user.id is required for me() - Direct API requires explicit user context",
      NextlyErrorCode.INVALID_INPUT,
      400
    );
  }

  const result = await ctx.userAccountService.getCurrentUser(args.user.id);

  if (!result.success || !result.data) {
    if (result.statusCode === 404) {
      throw new NotFoundError("User not found", { userId: args.user.id });
    }
    throw new NextlyError(
      result.message || "Failed to get user profile",
      NextlyErrorCode.INTERNAL_ERROR,
      result.statusCode
    );
  }

  return {
    user: result.data as Record<string, unknown>,
  };
}

/**
 * Update the current user's profile (name/image only).
 */
export async function updateMe(
  ctx: NextlyContext,
  args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }
): Promise<AuthResult> {
  if (!args.user?.id) {
    throw new NextlyError(
      "user.id is required for updateMe() - Direct API requires explicit user context",
      NextlyErrorCode.INVALID_INPUT,
      400
    );
  }

  const result = await ctx.userAccountService.updateCurrentUser(
    args.user.id,
    args.data
  );

  if (!result.success || !result.data) {
    if (result.statusCode === 404) {
      throw new NotFoundError("User not found", { userId: args.user.id });
    }
    throw new NextlyError(
      result.message || "Failed to update user profile",
      NextlyErrorCode.INTERNAL_ERROR,
      result.statusCode
    );
  }

  return {
    user: result.data as Record<string, unknown>,
  };
}

/**
 * Register a new user with email + password.
 */
export async function register(
  ctx: NextlyContext,
  args: RegisterArgs
): Promise<{ user: Record<string, unknown> }> {
  const { email, password, collection: _collection, ...rest } = args;

  const result = await ctx.authService.registerUser({
    email,
    password,
    name: (rest as { name?: string }).name,
  });

  if (!result.success || !result.data) {
    if (result.statusCode === 400) {
      throw new ValidationError(result.message, { _root: [result.message] });
    }
    throw new NextlyError(
      result.message || "Failed to register user",
      NextlyErrorCode.INTERNAL_ERROR,
      result.statusCode
    );
  }

  return {
    user: result.data as Record<string, unknown>,
  };
}

/**
 * Change the current user's password (requires the current password).
 */
export async function changePassword(
  ctx: NextlyContext,
  args: ChangePasswordArgs & { user: UserContext }
): Promise<{ success: true }> {
  if (!args.user?.id) {
    throw new NextlyError(
      "user.id is required for changePassword() - Direct API requires explicit user context",
      NextlyErrorCode.INVALID_INPUT,
      400
    );
  }

  const result = await ctx.authService.changePassword(
    args.user.id,
    args.currentPassword,
    args.newPassword
  );

  if (!result.success) {
    throw new UnauthorizedError(result.error || "Failed to change password");
  }

  return { success: true };
}

/**
 * Initiate password reset by generating a reset token.
 *
 * Always returns `success: true` (even if the email is unknown) to avoid
 * leaking which addresses exist.
 */
export async function forgotPassword(
  ctx: NextlyContext,
  args: ForgotPasswordArgs
): Promise<{ success: true; token?: string }> {
  const result = await ctx.authService.generatePasswordResetToken(args.email, {
    disableEmail: args.disableEmail,
    expiration: args.expiration,
    redirectPath: args.redirectPath,
  });

  return {
    success: true,
    token: result.token,
  };
}

/**
 * Reset a user's password using a reset token issued via `forgotPassword`.
 */
export async function resetPassword(
  ctx: NextlyContext,
  args: ResetPasswordArgs
): Promise<{ success: true; email?: string }> {
  const result = await ctx.authService.resetPasswordWithToken(
    args.token,
    args.password
  );

  if (!result.success) {
    throw new UnauthorizedError(result.error || "Invalid or expired token");
  }

  return {
    success: true,
    email: result.email,
  };
}

/**
 * Verify a user's email using a verification token.
 */
export async function verifyEmail(
  ctx: NextlyContext,
  args: VerifyEmailArgs
): Promise<{ success: true; email?: string }> {
  const result = await ctx.authService.verifyEmail(args.token);

  if (!result.success) {
    throw new UnauthorizedError(result.error || "Invalid or expired token");
  }

  return {
    success: true,
    email: result.email,
  };
}
