/**
 * CSRF coverage regression guard.
 *
 * If any state-changing auth route silently stops validating CSRF (for
 * example via a bad merge revert, as happened in c80d2982), this test
 * fails. Do not remove a row without also removing the corresponding
 * CSRF check from the handler and updating docs/auth/csrf.md.
 */
import { describe, it, expect } from "vitest";

import { NULL_AUDIT_LOG_WRITER } from "../../../domains/audit/audit-log-writer";
import { routeAuthRequest, type AuthRouterDeps } from "../router";

// Audit M10 / T-022: spying writer used by the audit-on-CSRF-failure
// test below. Counts events received and exposes them for assertions.
function makeRecordingAuditWriter() {
  const events: Array<Parameters<typeof NULL_AUDIT_LOG_WRITER.write>[0]> = [];
  return {
    events,
    writer: {
      async write(event: Parameters<typeof NULL_AUDIT_LOG_WRITER.write>[0]) {
        events.push(event);
      },
    },
  };
}

// Minimal deps stub. CSRF is checked before any of these fire for the
// protected routes, so a throwing function proves the guard ran first.
function makeStubDeps(
  auditLog: AuthRouterDeps["auditLog"] = NULL_AUDIT_LOG_WRITER
): AuthRouterDeps {
  const unreachable = () => {
    throw new Error("CSRF check should have rejected before this ran");
  };
  return {
    secret: "test-secret-that-is-at-least-32-characters-long!",
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    maxLoginAttempts: 5,
    lockoutDurationSeconds: 900,
    loginStallTimeMs: 0,
    requireEmailVerification: true,
    revealRegistrationConflict: false,
    allowedOrigins: [],
    trustProxy: false,
    trustedProxyIps: [],
    // T-016: 0 disables the per-IP envelope so CSRF (which is the
    // contract under test) still runs first.
    authRateLimit: { requestsPerHour: 0, windowMs: 3_600_000 },
    auditLog,
    findUserByEmail: unreachable as never,
    findUserById: unreachable as never,
    incrementFailedAttempts: unreachable as never,
    lockAccount: unreachable as never,
    resetFailedAttempts: unreachable as never,
    fetchRoleIds: unreachable as never,
    fetchCustomFields: unreachable as never,
    storeRefreshToken: unreachable as never,
    findRefreshTokenByHash: unreachable as never,
    deleteRefreshToken: unreachable as never,
    deleteRefreshTokenByHash: unreachable as never,
    deleteAllRefreshTokensForUser: unreachable as never,
    // getUserCount has to return 0 so setup does not short-circuit with
    // SETUP_COMPLETE before reaching the CSRF check.
    getUserCount: async () => 0,
    createSuperAdmin: unreachable as never,
    seedPermissions: unreachable as never,
    registerUser: unreachable as never,
    generatePasswordResetToken: unreachable as never,
    resetPasswordWithToken: unreachable as never,
    changePassword: unreachable as never,
    verifyEmail: unreachable as never,
    resendVerificationEmail: unreachable as never,
  };
}

function makeRequest(
  method: string,
  path: string,
  body: Record<string, unknown>
): Request {
  return new Request(`http://localhost:3000/admin/api/auth/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

const CSRF_PROTECTED_ROUTES: Array<{
  method: string;
  path: string;
  body: Record<string, unknown>;
}> = [
  { method: "POST", path: "login", body: { email: "a@b.c", password: "pw" } },
  { method: "POST", path: "logout", body: {} },
  {
    method: "POST",
    path: "setup",
    body: { email: "a@b.c", password: "pw", name: "n" },
  },
  {
    method: "POST",
    path: "register",
    body: { email: "a@b.c", password: "pw", name: "n" },
  },
  { method: "POST", path: "forgot-password", body: { email: "a@b.c" } },
  {
    method: "POST",
    path: "reset-password",
    body: { token: "t", newPassword: "pw" },
  },
  {
    method: "PATCH",
    path: "change-password",
    body: { currentPassword: "a", newPassword: "b" },
  },
  {
    method: "POST",
    path: "verify-email/resend",
    body: { email: "a@b.c" },
  },
];

describe("CSRF coverage", () => {
  // change-password sits behind an auth check; a request with no session
  // will be rejected with 401 before CSRF runs. That still blocks the
  // state change, so for that row we accept either 401 or 403. All other
  // protected rows must be exactly 403 CSRF_FAILED.
  it.each(CSRF_PROTECTED_ROUTES)(
    "$method /auth/$path rejects requests with no CSRF token",
    async ({ method, path, body }) => {
      const deps = makeStubDeps();
      const req = makeRequest(method, path, body);
      const res = await routeAuthRequest(req, path, deps);
      expect(res).not.toBeNull();
      if (path === "change-password") {
        expect([401, 403]).toContain(res!.status);
      } else {
        expect(res!.status).toBe(403);
        const payload = await res!.json();
        expect(payload.error.code).toBe("CSRF_FAILED");
      }
    }
  );

  // Audit M10 / T-022: every CSRF rejection records a single
  // `csrf-failed` event with the request path/method as metadata.
  // change-password is excluded because its 401 short-circuit (no
  // session) fires before CSRF, so there's nothing to audit on that
  // row.
  it("audits one csrf-failed event per CSRF-rejected request", async () => {
    const recording = makeRecordingAuditWriter();
    const deps = makeStubDeps(recording.writer);
    const eligible = CSRF_PROTECTED_ROUTES.filter(
      r => r.path !== "change-password"
    );
    for (const { method, path, body } of eligible) {
      await routeAuthRequest(makeRequest(method, path, body), path, deps);
    }
    expect(recording.events).toHaveLength(eligible.length);
    expect(recording.events.every(e => e.kind === "csrf-failed")).toBe(true);
    expect(recording.events.map(e => e.metadata?.path).sort()).toEqual(
      eligible.map(r => r.path).sort()
    );
  });

  // Intentionally unprotected routes. Each one has an explicit rationale
  // so a future dev who questions the exclusion finds the answer here
  // and in docs/auth/csrf.md.
  describe("intentionally unprotected routes", () => {
    it("POST /auth/verify-email: URL token is the unguessable secret", async () => {
      const deps = makeStubDeps();
      deps.verifyEmail = async () => ({ success: false, error: "bad token" });
      const req = makeRequest("POST", "verify-email", { token: "fake" });
      const res = await routeAuthRequest(req, "verify-email", deps);
      expect(res!.status).not.toBe(403);
    });

    it("POST /auth/refresh: HttpOnly refresh cookie + rotation is the protection", async () => {
      // Refresh relies on the opaque HttpOnly refresh-token cookie. A
      // cross-origin attacker cannot read it, cannot forge a match for
      // the body, and cannot replay after rotation. CSRF adds no
      // defensive value and would break silent token refresh on page
      // load, which is called without a CSRF fetch.
      const deps = makeStubDeps();
      // No refresh cookie set, so we expect a non-CSRF auth failure.
      const req = makeRequest("POST", "refresh", {});
      const res = await routeAuthRequest(req, "refresh", deps);
      expect(res!.status).not.toBe(403);
    });
  });
});
