import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { AuthUser } from "../../../types/auth";
import {
  issueSession,
  mintSession,
  type IssueSessionDeps,
} from "../issue-session";

function deps(state: {
  isActive: boolean;
  lockedUntil: Date | null;
  emailVerified: Date | null;
}): IssueSessionDeps {
  return {
    secret: "x".repeat(32),
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    requireEmailVerification: true,
    fetchAccountState: vi.fn(async (userId: string) => ({ userId, ...state })),
    fetchRoleIds: vi.fn(async () => []),
    fetchCustomFields: vi.fn(async () => ({})),
    storeRefreshToken: vi.fn(async () => {}),
    authHooks: {
      runCustomizeClaims: async (c: unknown) => c,
      runAfterLogin: async () => {},
    } as never,
    pluginCtx: {} as never,
    auditLog: { write: vi.fn(async () => {}) } as never,
  };
}

const user = { id: "u1", email: "a@b.c" } as AuthUser;
const req = new Request("http://localhost/admin/api/auth/login", {
  method: "POST",
});

describe("issueSession account-state gate", () => {
  it("refuses a locked account before minting anything", async () => {
    const d = deps({
      isActive: true,
      lockedUntil: new Date(Date.now() + 60_000),
      emailVerified: new Date(),
    });
    await expect(issueSession(user, d, req, "r1")).rejects.toSatisfy(
      NextlyError.is
    );
    expect(d.storeRefreshToken).not.toHaveBeenCalled();
  });

  it("refuses a deactivated account", async () => {
    const d = deps({
      isActive: false,
      lockedUntil: null,
      emailVerified: new Date(),
    });
    await expect(issueSession(user, d, req, "r1")).rejects.toSatisfy(
      NextlyError.is
    );
  });

  it("issues a session for a usable account", async () => {
    const d = deps({
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
    });
    const res = await issueSession(user, d, req, "r1");
    expect(res.status).toBe(200);
    expect(d.storeRefreshToken).toHaveBeenCalledOnce();
  });
});

/** The cookie's name and attributes, with the value dropped. */
function cookieShape(setCookie: string): string {
  const [pair, ...attributes] = setCookie.split(";");
  return [pair.split("=")[0], ...attributes.map(a => a.trim())].join("; ");
}

describe("mintSession", () => {
  const usable = {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date(),
  };

  it("returns the cookies and body a login response is built from", async () => {
    const d = deps(usable);
    const minted = await mintSession(user, d, req, { strategy: "test" });

    expect(minted.cookies).toHaveLength(2);
    expect(minted.body.user).toMatchObject({ id: "u1", email: "a@b.c" });
    expect(typeof minted.body.accessToken).toBe("string");
    expect(typeof minted.body.refreshToken).toBe("string");
    expect(typeof minted.body.expiresAt).toBe("string");
    expect(d.storeRefreshToken).toHaveBeenCalledOnce();
  });

  it("runs the account-state gate before storing anything", async () => {
    const d = deps({ ...usable, isActive: false });
    await expect(
      mintSession(user, d, req, { strategy: "test" })
    ).rejects.toSatisfy(NextlyError.is);
    expect(d.storeRefreshToken).not.toHaveBeenCalled();
  });

  it("produces the same cookies the JSON response carries", async () => {
    // The point of the split: one implementation mints, and the JSON response
    // and the redirect are thin wrappers. Compare the two OUTPUTS rather than
    // spying, since a same-module call cannot be intercepted — and compare
    // names and attributes, because the token values differ per call.
    const minted = await mintSession(user, deps(usable), req, {
      strategy: "test",
    });
    const res = await issueSession(user, deps(usable), req, "r1", {
      strategy: "test",
    });

    expect(res.headers.getSetCookie().map(cookieShape)).toEqual(
      minted.cookies.map(cookieShape)
    );
  });
});
