import { describe, expect, it, vi } from "vitest";

import { handleRefresh, type RefreshHandlerDeps } from "../refresh";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

function makeDeps(state: {
  isActive: boolean;
  lockedUntil: Date | null;
  emailVerified: Date | null;
}) {
  const deleteRefreshToken = vi.fn().mockResolvedValue(undefined);
  const storeRefreshToken = vi.fn().mockResolvedValue(undefined);
  const deps: RefreshHandlerDeps = {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    requireEmailVerification: true,
    findRefreshTokenByHash: vi.fn().mockResolvedValue({
      id: "rt1",
      userId: "u1",
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: null,
      ipAddress: null,
    }),
    deleteRefreshToken,
    deleteAllRefreshTokensForUser: vi.fn().mockResolvedValue(undefined),
    storeRefreshToken,
    findUserById: vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@example.com",
      name: "A",
      image: null,
      isActive: state.isActive,
    }),
    fetchAccountState: vi.fn().mockResolvedValue({ userId: "u1", ...state }),
    fetchRoleIds: vi.fn().mockResolvedValue(["editor"]),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
  };
  return { deps, deleteRefreshToken, storeRefreshToken };
}

function makeRequest(): Request {
  return new Request("http://localhost:3000/admin/api/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "nextly_refresh=raw-refresh-token",
    },
    body: JSON.stringify({}),
  });
}

/** Every `Set-Cookie` value the response carries, one per header entry. */
function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe("refresh account-state gate", () => {
  it("refuses a deactivated user, deletes the refresh row and clears the cookies", async () => {
    const { deps, deleteRefreshToken, storeRefreshToken } = makeDeps({
      isActive: false,
      lockedUntil: null,
      emailVerified: new Date(),
    });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(401);
    expect(deleteRefreshToken).toHaveBeenCalledWith("rt1");
    expect(storeRefreshToken).not.toHaveBeenCalled();

    const cookies = setCookies(res);
    expect(cookies.some(c => c.startsWith("nextly_session="))).toBe(true);
    expect(cookies.some(c => c.startsWith("nextly_refresh="))).toBe(true);
    // Max-Age=0 is how the handler expires a cookie; a rotation would set a TTL.
    expect(cookies.every(c => c.includes("Max-Age=0"))).toBe(true);
  });

  it("refuses an unverified user when verification is required", async () => {
    const { deps, deleteRefreshToken } = makeDeps({
      isActive: true,
      lockedUntil: null,
      emailVerified: null,
    });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(401);
    expect(deleteRefreshToken).toHaveBeenCalledWith("rt1");
  });

  it("still rotates for a locked but otherwise usable account", async () => {
    // The password lockout guards password attempts. Someone else guessing a
    // password must not end a session that is already established.
    const { deps, storeRefreshToken } = makeDeps({
      isActive: true,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
      emailVerified: new Date(),
    });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(200);
    expect(storeRefreshToken).toHaveBeenCalledOnce();
  });

  it("reads the state for the user the refresh row names", async () => {
    const { deps } = makeDeps({
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
    });

    await handleRefresh(makeRequest(), deps);

    expect(deps.fetchAccountState).toHaveBeenCalledWith("u1");
  });
});
