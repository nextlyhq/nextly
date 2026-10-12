import { describe, expect, it, vi } from "vitest";

import { handleRefresh, type RefreshHandlerDeps } from "../refresh";

import { fakeSessionRows } from "./session-row-fake";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

interface State {
  isActive: boolean;
  lockedUntil: Date | null;
  emailVerified: Date | null;
  passwordUpdatedAt?: Date | null;
}

/**
 * Deps over an account whose state is `state` at the first read and, when
 * given, `lockedState` under the session-row lock — the state a revocation
 * committed in between leaves behind.
 */
function makeDeps(
  state: State,
  opts: { lockedState?: State; consumes?: boolean } = {}
) {
  const deleteRefreshToken = vi.fn().mockResolvedValue(undefined);
  const rows = fakeSessionRows(
    async userId => ({
      userId,
      passwordUpdatedAt: null,
      ...(opts.lockedState ?? state),
    }),
    () => opts.consumes ?? true
  );
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
    withSessionRowTransaction: rows.withSessionRowTransaction,
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
  return { deps, deleteRefreshToken, rows };
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
    const { deps, deleteRefreshToken, rows } = makeDeps({
      isActive: false,
      lockedUntil: null,
      emailVerified: new Date(),
    });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(401);
    expect(deleteRefreshToken).toHaveBeenCalledWith("rt1");
    expect(rows.insertRefreshToken).not.toHaveBeenCalled();

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
    const { deps, rows } = makeDeps({
      isActive: true,
      lockedUntil: new Date(Date.now() + 15 * 60_000),
      emailVerified: new Date(),
    });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(200);
    expect(rows.committed).toHaveLength(1);
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

describe("refresh rotation spends the presented token once", () => {
  const usable = {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date(),
  };

  it("answers a lost rotation without clearing the winner's cookies", async () => {
    // Two tabs refreshing at once present the same token. The other request
    // spent it and has just set fresh cookies on this browser; clearing them
    // here would sign that tab out as well.
    const { deps, rows } = makeDeps(usable, { consumes: false });

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REFRESH_SUPERSEDED");
    expect(body).not.toHaveProperty("accessToken");
    expect(setCookies(res)).toEqual([]);
    // The row this request inserted is rolled back with the transaction, so
    // the lost attempt leaves the account no extra session to renew from.
    expect(rows.consumeRefreshToken).toHaveBeenCalledWith("rt1");
    expect(rows.calls).toEqual(["lock", "insert", "consume", "rollback"]);
    expect(rows.committed).toHaveLength(0);
  });

  it("locks and re-reads the account, then inserts, then spends the presented row", async () => {
    // Spending first left a gap before the insert, and inserting before the
    // re-read left a revocation that committed in between unseen.
    const { deps, rows } = makeDeps(usable);

    const res = await handleRefresh(makeRequest(), deps);

    expect(res.status).toBe(200);
    expect(rows.calls).toEqual(["lock", "insert", "consume", "commit"]);
    expect(rows.lockAccountState).toHaveBeenCalledWith("u1");
  });

  it.each([
    ["deactivated", { ...usable, isActive: false }],
    [
      "given a new password",
      { ...usable, passwordUpdatedAt: new Date("2026-02-01T00:00:00Z") },
    ],
  ])(
    "refuses an account %s while the rotation was being prepared",
    async (_, lockedState) => {
      const { deps, rows, deleteRefreshToken } = makeDeps(
        { ...usable, passwordUpdatedAt: new Date("2026-01-01T00:00:00Z") },
        { lockedState }
      );

      const res = await handleRefresh(makeRequest(), deps);

      expect(res.status).toBe(401);
      expect(rows.insertRefreshToken).not.toHaveBeenCalled();
      expect(rows.committed).toHaveLength(0);
      expect(deleteRefreshToken).toHaveBeenCalledWith("rt1");
      expect(setCookies(res).every(c => c.includes("Max-Age=0"))).toBe(true);
    }
  );
});
