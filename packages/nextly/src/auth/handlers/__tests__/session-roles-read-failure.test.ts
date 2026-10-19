/**
 * A session is not issued when its roles could not be read.
 *
 * The read used to answer a failure with no roles, so a login or refresh
 * issued a session whose claims said the person held nothing, every refresh
 * repeated it, and nothing said a read had failed. The real bridge read now
 * lets the failure through, and issuing a session refuses on it.
 */
import { describe, expect, it, vi } from "vitest";

import type { AuthUser } from "../../../types/auth";
import { buildAuthRouterDeps } from "../deps-bridge";
import { issueSession, type IssueSessionDeps } from "../issue-session";

import { fakeSessionRows, fixtureIdentity } from "./session-row-fake";

/** The failure the database raises for the role read. */
const ROLE_READ_FAILED = new Error("user_roles could not be read");

describe("reading a session's roles", () => {
  it("lets the database's failure through rather than answering no roles", async () => {
    // The bridge's own read, over an adapter whose query fails. Every other
    // service is an empty stand-in: nothing else is called here.
    const failingDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.reject(ROLE_READ_FAILED),
        }),
      }),
    };
    const services: Record<string, unknown> = {
      adapter: { getDrizzle: () => failingDb },
    };
    const deps = buildAuthRouterDeps(name => services[name] ?? {});

    await expect(deps.fetchSessionRoles("u1")).rejects.toBe(ROLE_READ_FAILED);
  });

  it("issues no session when the read fails", async () => {
    const rows = fakeSessionRows(async userId => ({
      userId,
      passwordUpdatedAt: null,
      ...fixtureIdentity,
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date(),
    }));
    const auditWrite = vi.fn(async () => {});
    const deps: IssueSessionDeps = {
      withSessionRowTransaction: rows.withSessionRowTransaction,
      secret: "x".repeat(32),
      isProduction: false,
      accessTokenTTL: 900,
      refreshTokenTTL: 604800,
      trustProxy: false,
      trustedProxyIps: [],
      requireEmailVerification: true,
      fetchAccountState: vi.fn(async (userId: string) => ({
        userId,
        passwordUpdatedAt: null,
        ...fixtureIdentity,
        isActive: true,
        lockedUntil: null,
        emailVerified: new Date(),
      })),
      fetchSessionRoles: vi.fn(async () => {
        throw ROLE_READ_FAILED;
      }),
      fetchCustomFields: vi.fn(async () => ({})),
      authHooks: {
        runCustomizeClaims: async (c: unknown) => c,
        runAfterLogin: async () => {},
      } as never,
      pluginCtx: {} as never,
      auditLog: { write: auditWrite } as never,
    };

    await expect(
      issueSession(
        { id: "u1", email: "a@b.c" } as AuthUser,
        deps,
        new Request("http://localhost/admin/api/auth/login", {
          method: "POST",
        }),
        "r1"
      )
    ).rejects.toBe(ROLE_READ_FAILED);
    // Nothing a session is made of was written, and no success recorded.
    expect(rows.insertRefreshToken).not.toHaveBeenCalled();
    expect(auditWrite).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "login-succeeded" })
    );
  });
});
