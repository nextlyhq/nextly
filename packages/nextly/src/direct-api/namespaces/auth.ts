/**
 * Direct API Auth Namespace
 *
 * Top-level authentication methods: login, logout, me/updateMe, register,
 * password reset, email verification. These hang directly off the `Nextly`
 * class root (e.g. `nextly.login(...)`).
 *
 * @packageDocumentation
 */

import { verifyCredentials } from "../../auth/credentials/verify-credentials";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessTokenWithExpiry } from "../../auth/jwt/sign";
import { auditFailureMetadata } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import { emitAuthEvent } from "../../events/domain-events";
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

import type { DirectLoginDeps, NextlyContext } from "./context";

/**
 * How long a Direct API token is valid: a day.
 *
 * The caller is the app's own server code holding the credentials, and it can
 * sign in again whenever it likes, so a day bounds a leaked token without
 * having a scheduled job re-prove its password many times a day. Ending the
 * account's sessions ends the token sooner, and the first of its roles to
 * lapse ends it no later than that.
 */
const DIRECT_LOGIN_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * The strategy a Direct API login is recorded under: it proves a password.
 * `via` says it came from server code rather than the login page, so the
 * trail can tell the two apart.
 */
const DIRECT_LOGIN_AUDIT_METADATA = {
  strategy: "password",
  via: "direct-api",
} as const;

/**
 * Verify user credentials and return a signed JWT session token.
 *
 * The token is a session, so the credentials are checked by the login
 * endpoint's own `verifyCredentials`, over the same dependencies: a wrong
 * password counts toward the lockout, and a locked, deactivated or unverified
 * account is refused as the endpoint refuses it. That is the
 * `AUTH_INVALID_CREDENTIALS` error a wrong password gets, except an unverified
 * address on an account no administrator deactivated, which is named
 * `EMAIL_NOT_VERIFIED` once the password is proven.
 *
 * An account that must replace an admin-set password is refused with
 * `AUTH_INVALID_CREDENTIALS` too. The endpoint answers it with the forced-change step, which a
 * server-side call cannot complete, and a token issued here would skip it.
 *
 * Like every other sign-in, it is recorded on the audit trail, a success
 * naming the account and a failure naming none, and its token carries the
 * account's roles in force and ends no later than the first of them lapses.
 *
 * Unlike the endpoint, this runs no plugin login hooks and no second-factor
 * challenge: it is for trusted server code, not for signing a person in.
 */
export async function login(
  ctx: NextlyContext,
  args: LoginArgs
): Promise<LoginResult> {
  const deps = ctx.directLoginDeps;
  let result: LoginResult;
  try {
    result = await signIn(ctx, deps, args);
  } catch (err) {
    // Every way this sign-in ends in failure is recorded once, the same way
    // the login endpoint records its own: no actor, so the row cannot say
    // which account was reached, and only core-controlled values kept.
    await deps.auditLog.write({
      kind: "login-failed",
      metadata: {
        ...auditFailureMetadata(err),
        ...DIRECT_LOGIN_AUDIT_METADATA,
      },
    });
    throw err;
  }
  // Recorded once the token exists, so the trail never claims a sign-in that
  // delivered nothing.
  await deps.auditLog.write({
    kind: "login-succeeded",
    actorUserId: String(result.user.id),
    metadata: { ...DIRECT_LOGIN_AUDIT_METADATA },
  });
  emitAuthEvent("loggedIn", {
    userId: result.user.id,
    email: result.user.email,
  });
  return result;
}

/** The sign-in itself, without its record: proves the password, signs the token. */
async function signIn(
  ctx: NextlyContext,
  deps: DirectLoginDeps,
  args: LoginArgs
): Promise<LoginResult> {
  const verified = await verifyCredentials(
    { email: args.email, password: args.password },
    ctx.passwordCredentialDeps
  );
  if (verified.mustChangePassword) {
    throw NextlyError.invalidCredentials({
      // A plain reason for the operator's log. It is not in the audit
      // vocabulary, so the failure row keeps the code and drops it.
      logContext: { userId: verified.id, reason: "must-change-password" },
    });
  }
  // The shape `login` has always returned, whatever else the sign-in read.
  const user = {
    id: verified.id,
    email: verified.email,
    name: verified.name,
    image: verified.image,
    emailVerified: verified.emailVerified,
    passwordHash: null,
  };
  const userId = String(user.id);

  const secret = env.NEXTLY_SECRET;
  if (!secret) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "NEXTLY_SECRET is not configured. Set NEXTLY_SECRET in your environment variables.",
      statusCode: 500,
    });
  }

  // The roles in force now, as every session's token takes them. Read after
  // the password is proven, so an unknown address or a wrong password never
  // reaches the role table.
  const sessionRoles = await deps.fetchSessionRoles(userId);

  const claims = buildClaims({
    userId,
    email: user.email,
    name: user.name || "",
    image: user.image ?? null,
    roleIds: sessionRoles.roleIds,
    // The epoch read WITH the proven hash, never a fresh reading: a
    // deactivation or a password set that commits after the password was
    // checked and before this token is signed raises the epoch past this
    // one, so every place a session is read refuses the token. A later
    // reading would carry the raised epoch and outlive the change.
    sessionEpoch: verified.sessionEpoch,
  });
  const { token, expiresAt } = await signAccessTokenWithExpiry(
    claims,
    secret,
    DIRECT_LOGIN_TOKEN_TTL_SECONDS,
    "session",
    // Ending no later than the first of its roles lapses: the claims are a
    // copy of the roles, read by the stateless session checks until expiry.
    sessionRoles.validUntil
  );

  return {
    user: user,
    token,
    // The token's own expiry, so the caller is never told a later one.
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
}

/**
 * Logout operation (no-op for Direct API — session management lives in the app).
 */
// eslint-disable-next-line @typescript-eslint/require-await
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
 * Update the current user's own profile: name, image and interface language.
 *
 * Throws `NextlyError` on failure (NOT_FOUND when the user doesn't exist).
 */
export async function updateMe(
  ctx: NextlyContext,
  args: {
    user: UserContext;
    data: {
      name?: string;
      image?: string;
      /** A language tag (`fr`, `pt-BR`), or null to follow the browser. */
      interfaceLanguage?: string | null;
    };
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
