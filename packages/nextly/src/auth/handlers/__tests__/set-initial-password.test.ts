import { describe, it, expect, vi } from "vitest";

import { AuthHookRegistry } from "../../pipeline/hooks";
import {
  MUST_CHANGE_PASSWORD_CHALLENGE,
  mintPendingToken,
} from "../../pipeline/pending-token";
import { handleSetInitialPassword } from "../set-initial-password";

import { fakeSessionRows } from "./session-row-fake";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

function makeDeps(state: { isActive: boolean; emailVerified: Date | null }) {
  const sessionRows = fakeSessionRows(async userId => ({
    userId,
    lockedUntil: null,
    passwordUpdatedAt: null,
    ...state,
  }));
  return {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    fetchRoleIds: vi.fn().mockResolvedValue([]),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
    withSessionRowTransaction: sessionRows.withSessionRowTransaction,
    sessionRows,
    authHooks: new AuthHookRegistry(),
    pluginCtx: {} as never,
    allowedOrigins: ["http://localhost:3000"],
    loginStallTimeMs: 0,
    auditLog: { write: vi.fn().mockResolvedValue(undefined) },
    requireEmailVerification: true,
    fetchAccountState: vi.fn().mockResolvedValue({
      userId: "u1",
      lockedUntil: null,
      passwordUpdatedAt: null,
      ...state,
    }),
    setInitialPassword: vi
      .fn()
      .mockResolvedValue({ userId: "u1", passwordUpdatedAt: null }),
    findUserById: vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "A",
      image: null,
      isActive: state.isActive,
    }),
  };
}

async function request(): Promise<Request> {
  const pendingToken = await mintPendingToken(
    {
      userId: "u1",
      challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
      attempts: 0,
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
    },
    SECRET,
    300
  );
  return new Request(
    "http://localhost:3000/admin/api/auth/set-initial-password",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "nextly_csrf=tok",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        csrfToken: "tok",
        pendingToken,
        newPassword: "An0ther-Str0ng-P@ss!",
      }),
    }
  );
}

describe("the forced first-sign-in password change", () => {
  it.each([
    ["deactivated", { isActive: false, emailVerified: new Date() }],
    ["unverified", { isActive: true, emailVerified: null }],
  ])("leaves the password of a %s account unchanged", async (_label, state) => {
    // The account became unusable after its pending token was issued. The
    // session afterwards would be refused anyway; the password change must
    // be refused too, or a suspended account still sets its credentials.
    const deps = makeDeps(state);
    const res = await handleSetInitialPassword(await request(), deps);

    expect(res.status).toBe(401);
    expect(deps.setInitialPassword).not.toHaveBeenCalled();
    expect(deps.sessionRows.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("changes the password and signs in a usable account", async () => {
    // The control: the gate must not refuse the account it exists to let through.
    const deps = makeDeps({ isActive: true, emailVerified: new Date() });
    const res = await handleSetInitialPassword(await request(), deps);

    expect(res.status).toBe(200);
    expect(deps.setInitialPassword).toHaveBeenCalledWith(
      "u1",
      "An0ther-Str0ng-P@ss!"
    );
  });
});
