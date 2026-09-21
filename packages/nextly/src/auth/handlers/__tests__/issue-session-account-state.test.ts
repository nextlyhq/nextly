import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import type { AuthUser } from "../../../types/auth";
import { issueSession, type IssueSessionDeps } from "../issue-session";

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
