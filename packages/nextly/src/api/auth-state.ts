/**
 * GET /api/auth/state
 *
 * Per spec §13.6, this endpoint replaces the leakage paths that login,
 * registration, and forgot-password used to expose. After a successful
 * sign-in the client calls this endpoint to discover the authenticated
 * user's account state (locked, unverified, disabled, password-reset
 * required) — none of which are surfaced through pre-auth endpoints.
 *
 * Wire shape on success:
 *   { "data": {
 *       "authenticated": true,
 *       "user": { id, email, name },
 *       "account": { verified, locked, disabled, passwordResetRequired,
 *                    mustChangePasswordReason },
 *       "session": { issuedAt, expiresAt }
 *   } }
 *
 * Wire shape on miss (no session, expired, invalid):
 *   401 AUTH_REQUIRED / "Authentication required." (canonical via
 *   `withErrorHandler`).
 *
 * Security properties:
 * - The endpoint takes no input; it describes only the bearer's own account.
 * - There is no path that returns 200 with `authenticated: false` — anything
 *   short of a valid session is a 401, so an unauthenticated caller cannot
 *   probe whether a specific user/email exists.
 *
 * Mounting in a host-app:
 *   // app/api/auth/state/route.ts
 *   export { GET } from "@revnixhq/nextly/api/auth-state";
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { readAccessTokenCookie } from "../auth/cookies/access-token-cookie.js";
import { verifyAccessToken } from "../auth/jwt/verify.js";
import { getDialectTables } from "../database/index.js";
import { NextlyError } from "../errors/nextly-error.js";
import { getCachedNextly } from "../init";
import { env } from "../lib/env.js";

import { createSuccessResponse } from "./create-success-response.js";
import { withErrorHandler } from "./with-error-handler.js";

type AuthStateAccount = {
  verified: boolean;
  locked: boolean;
  disabled: boolean;
  passwordResetRequired: boolean;
  mustChangePasswordReason: string | null;
};

type AuthStatePayload = {
  authenticated: true;
  user: { id: string; email: string; name: string | null };
  account: AuthStateAccount;
  session: { issuedAt: string; expiresAt: string };
};

export const GET = withErrorHandler(async (request: NextRequest) => {
  const secret = env.NEXTLY_SECRET_RESOLVED ?? "";
  if (!secret) {
    // Misconfigured app — no JWT secret means we can't verify any session.
    // Fail closed with a generic 401 (operators see the cause in logs).
    throw NextlyError.authRequired({
      logContext: { reason: "no-secret-configured" },
    });
  }

  const token = readAccessTokenCookie(request);
  if (!token) {
    throw NextlyError.authRequired({ logContext: { reason: "no_token" } });
  }

  const verifyResult = await verifyAccessToken(token, secret);
  if (!verifyResult.valid) {
    throw NextlyError.authRequired({
      logContext: { reason: verifyResult.reason },
    });
  }

  const claims = verifyResult.payload;
  const userId = claims.sub;
  const issuedAt =
    typeof claims.iat === "number" ? new Date(claims.iat * 1000) : new Date(0);
  const expiresAt =
    typeof claims.exp === "number" ? new Date(claims.exp * 1000) : new Date(0);

  if (!userId) {
    throw NextlyError.authRequired({
      logContext: { reason: "claims-missing-sub" },
    });
  }

  // Read the live user row so the account state reflects the current DB,
  // not the JWT snapshot. A locked / disabled user with a still-valid JWT
  // still gets `locked: true` / `disabled: true` here.
  const nextly = await getCachedNextly();
  // The adapter is typed as `unknown` from the public surface; narrow once
  // here with the minimum shape we need (a Drizzle-style select chain
  // returning rows with the user fields below).
  type DbWithUserSelect = {
    select: (cols: Record<string, unknown>) => {
      from: (t: unknown) => {
        where: (p: unknown) => {
          limit: (n: number) => Promise<
            Array<{
              id: string;
              email: string;
              name: string | null;
              emailVerified: Date | null;
              isActive: boolean;
              lockedUntil: Date | null;
            }>
          >;
        };
      };
    };
  };
  const db = (
    nextly.adapter as { getDrizzle: () => DbWithUserSelect }
  ).getDrizzle();
  const tables = getDialectTables();

  const rows = await db
    .select({
      id: tables.users.id,
      email: tables.users.email,
      name: tables.users.name,
      emailVerified: tables.users.emailVerified,
      isActive: tables.users.isActive,
      lockedUntil: tables.users.lockedUntil,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) {
    // The session points at a user that no longer exists. Treat as a generic
    // auth-required miss; operators see the orphan-session reason.
    throw NextlyError.authRequired({
      logContext: { reason: "session-user-missing", userId },
    });
  }

  const now = new Date();
  const account: AuthStateAccount = {
    verified: Boolean(user.emailVerified),
    locked: Boolean(user.lockedUntil && user.lockedUntil > now),
    disabled: !user.isActive,
    // The schema does not yet track these as first-class fields; expose
    // safe defaults until they land. (Spec §19 follow-up.)
    passwordResetRequired: false,
    mustChangePasswordReason: null,
  };

  const payload: AuthStatePayload = {
    authenticated: true,
    user: { id: user.id, email: user.email, name: user.name },
    account,
    session: {
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };

  return createSuccessResponse(payload);
});
