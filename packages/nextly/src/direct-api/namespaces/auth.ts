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
import { NextlyError } from "../../errors/nextly-error";
import { env } from "../../lib/env";
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
 *
 * PR 4 (unified-error-system): verifyCredentials returns the MinimalUser
 * directly and throws NextlyError on bad credentials. Thrown errors
 * propagate naturally (NextlyError instances re-throw as-is via the
 * branded class hierarchy; the caller sees the auth failure).
 */
export async function login(
  ctx: NextlyContext,
  args: LoginArgs
): Promise<LoginResult> {
  const user = await ctx.authService.verifyCredentials(
    args.email,
    args.password
  );

  const secret = env.NEXTLY_SECRET_RESOLVED;
  if (!secret) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "NEXTLY_SECRET is not configured. Set NEXTLY_SECRET in your environment variables.",
      statusCode: 500,
    });
  }

  const maxAge = 30 * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + maxAge;

  const claims = buildClaims({
    userId: String(user.id),
    email: user.email,
    name: user.name || "",
    image: user.image ?? null,
    roleIds: [],
  });
  const token = await signAccessToken(claims, secret, maxAge);

  return {
    user: user,
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
 *
 * PR 4 (unified-error-system): getCurrentUser returns the user directly
 * and throws NextlyError(NOT_FOUND) for missing users. We surface that as
 * a direct-api NotFoundError to preserve SDK error-class compatibility.
 */
export async function me(
  ctx: NextlyContext,
  args: { user: UserContext }
): Promise<AuthResult> {
  if (!args.user?.id) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "user.id is required for me() - Direct API requires explicit user context",
      statusCode: 400,
    });
  }

  try {
    const user = await ctx.userAccountService.getCurrentUser(args.user.id);
    return {
      user: user,
    };
  } catch (err) {
    if (NextlyError.isNotFound(err)) {
      throw NextlyError.notFound({ logContext: { userId: args.user.id } });
    }
    throw err;
  }
}

/**
 * Update the current user's profile (name/image only).
 *
 * Throws `NextlyError` on failure (NOT_FOUND when the user doesn't exist).
 */
export async function updateMe(
  ctx: NextlyContext,
  args: {
    user: UserContext;
    data: { name?: string; image?: string };
  }
): Promise<AuthResult> {
  if (!args.user?.id) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "user.id is required for updateMe() - Direct API requires explicit user context",
      statusCode: 400,
    });
  }

  try {
    const user = await ctx.userAccountService.updateCurrentUser(
      args.user.id,
      args.data
    );
    return {
      user: user,
    };
  } catch (err) {
    if (NextlyError.isNotFound(err)) {
      throw NextlyError.notFound({ logContext: { userId: args.user.id } });
    }
    throw err;
  }
}

/**
 * Register a new user with email + password.
 *
 * Throws `NextlyError` on failure (e.g. VALIDATION_ERROR with
 * `errors[]` already populated by the service).
 */
export async function register(
  ctx: NextlyContext,
  args: RegisterArgs
): Promise<{ user: Record<string, unknown> }> {
  const { email, password, collection: _collection, ...rest } = args;

  const user = await ctx.authService.registerUser({
    email,
    password,
    name: (rest as { name?: string }).name,
  });
  return {
    user: user,
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
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "user.id is required for changePassword() - Direct API requires explicit user context",
      statusCode: 400,
    });
  }

  // PR 4 (unified-error-system): changePassword returns void and throws
  // NextlyError(AUTH_INVALID_CREDENTIALS) when the current password is
  // wrong. We let the NextlyError propagate; SDK consumers detect it via
  // NextlyError.is() / instanceof checks on the brand chain.
  await ctx.authService.changePassword(
    args.user.id,
    args.currentPassword,
    args.newPassword
  );

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
 *
 * PR 4 (unified-error-system): resetPasswordWithToken returns
 * `{ email }` and throws NextlyError on invalid/expired tokens.
 */
export async function resetPassword(
  ctx: NextlyContext,
  args: ResetPasswordArgs
): Promise<{ success: true; email?: string }> {
  const result = await ctx.authService.resetPasswordWithToken(
    args.token,
    args.password
  );

  return {
    success: true,
    email: result.email,
  };
}

/**
 * Verify a user's email using a verification token.
 *
 * PR 4 (unified-error-system): verifyEmail returns `{ email }` and
 * throws NextlyError on invalid/expired tokens.
 */
export async function verifyEmail(
  ctx: NextlyContext,
  args: VerifyEmailArgs
): Promise<{ success: true; email?: string }> {
  const result = await ctx.authService.verifyEmail(args.token);

  return {
    success: true,
    email: result.email,
  };
}
