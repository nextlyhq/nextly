import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { AuthHookRegistry } from "../pipeline/hooks";
import {
  createPluginAuthApi,
  type CompleteLoginDeps,
} from "../plugin-auth-api";

const SECRET = "s".repeat(32);
const request = new Request("http://localhost/admin/api/plugins/x/callback");

interface Overrides {
  user?: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
    mustChangePassword?: boolean | null;
  } | null;
  state?: {
    isActive: boolean;
    lockedUntil: Date | null;
    emailVerified: Date | null;
  };
  hooks?: AuthHookRegistry;
}

function makeDeps(o: Overrides = {}): CompleteLoginDeps {
  const user =
    o.user === undefined
      ? {
          id: "u1",
          email: "a@b.c",
          name: "A",
          image: null,
          isActive: true,
          mustChangePassword: false,
        }
      : o.user;
  const state = o.state ?? {
    isActive: true,
    lockedUntil: null,
    emailVerified: new Date("2026-01-01T00:00:00Z"),
  };
  return {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    challengeTokenTTL: 300,
    trustProxy: false,
    trustedProxyIps: [],
    requireEmailVerification: true,
    findUserById: vi.fn(async () => user),
    fetchAccountState: vi.fn(async (userId: string) => ({ userId, ...state })),
    fetchRoleIds: vi.fn(async () => []),
    fetchCustomFields: vi.fn(async () => ({})),
    storeRefreshToken: vi.fn(async () => {}),
    authHooks: o.hooks ?? new AuthHookRegistry(),
    pluginCtx: {} as never,
    auditLog: { write: vi.fn(async () => {}) } as never,
  };
}

function api(deps: CompleteLoginDeps) {
  return createPluginAuthApi(() => deps);
}

function cookieNames(res: Response): string[] {
  return res.headers.getSetCookie().map(c => c.split("=")[0]);
}

describe("ctx.auth.completeLogin", () => {
  it("redirects a usable account to next, with session cookies", async () => {
    const deps = makeDeps();
    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
      next: "/admin/dashboard",
      appendCookies: ["plugin_tx=; Path=/; Max-Age=0"],
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/dashboard");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieNames(res)).toEqual(
      expect.arrayContaining(["nextly_session", "nextly_refresh", "plugin_tx"])
    );
  });

  it.each([["//evil.com"], ["/adminx"], ["https://x"], ["/public"]])(
    "refuses %s as a destination and lands on /admin",
    async next => {
      const res = await api(makeDeps()).completeLogin("u1", {
        request,
        strategy: "oauth-test",
        next,
      });
      expect(res.headers.get("Location")).toBe("/admin");
    }
  );

  it("refuses an inactive account without ever running afterAuthenticate", async () => {
    // Preconditions run before any hook that could act, so a deactivated
    // account never triggers a second-factor code being sent to it.
    const afterAuthenticate = vi.fn(async (u: unknown) => u as never);
    const hooks = new AuthHookRegistry();
    hooks.add({ afterAuthenticate });
    const deps = makeDeps({
      state: {
        isActive: false,
        lockedUntil: null,
        emailVerified: new Date(),
      },
      hooks,
    });

    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/admin/login?error=signin-failed"
    );
    expect(cookieNames(res)).not.toContain("nextly_session");
    expect(afterAuthenticate).not.toHaveBeenCalled();

    const write = deps.auditLog.write as unknown as ReturnType<typeof vi.fn>;
    expect(write).toHaveBeenCalledOnce();
    const row = write.mock.calls[0][0] as Record<string, unknown>;
    expect(row.kind).toBe("login-failed");
    expect(row.actorUserId).toBeUndefined();
    expect(row.targetUserId).toBeUndefined();
    expect(row.metadata).toMatchObject({
      reason: "inactive",
      strategy: "oauth-test",
    });
  });

  it("signs in an account whose password lockout is active", async () => {
    // The lockout guards password attempts. Someone typing wrong passwords at
    // an address must not be able to lock its owner out of their provider.
    const deps = makeDeps({
      state: {
        isActive: true,
        lockedUntil: new Date(Date.now() + 15 * 60_000),
        emailVerified: new Date(),
      },
    });
    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
    });

    expect(res.status).toBe(302);
    expect(cookieNames(res)).toContain("nextly_session");
  });

  it("sends a challenge to the resume page with no token in the URL", async () => {
    const hooks = new AuthHookRegistry();
    hooks.add({
      afterAuthenticate: () => ({
        challenge: { id: "test-totp", userId: "u1" as never },
      }),
    });
    const deps = makeDeps({ hooks });

    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
      next: "/admin/collections",
    });

    const location = res.headers.get("Location") ?? "";
    expect(location).toBe("/admin/login?resume=1");
    expect(cookieNames(res)).toContain("nextly_pending");
    expect(cookieNames(res)).not.toContain("nextly_session");
    // The token is the thing that must not travel in a URL.
    const pending = res.headers
      .getSetCookie()
      .find(c => c.startsWith("nextly_pending="));
    expect(pending).toContain("HttpOnly");
    expect(location).not.toContain(
      decodeURIComponent(pending?.split("=")[1]?.split(";")[0] ?? "no-token")
    );
  });

  it("sends a forced password change to the resume page", async () => {
    const deps = makeDeps({
      user: {
        id: "u1",
        email: "a@b.c",
        name: "A",
        image: null,
        isActive: true,
        mustChangePassword: true,
      },
    });
    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
    });

    expect(res.headers.get("Location")).toBe("/admin/login?resume=1");
    expect(cookieNames(res)).toContain("nextly_pending");
    expect(cookieNames(res)).not.toContain("nextly_session");
  });

  it("gives an unknown user the same generic failure", async () => {
    const deps = makeDeps({ user: null });
    const res = await api(deps).completeLogin("nobody", {
      request,
      strategy: "oauth-test",
    });

    expect(res.headers.get("Location")).toBe(
      "/admin/login?error=signin-failed"
    );
    expect(cookieNames(res)).not.toContain("nextly_session");
  });

  it("fails generically when a beforeLogin hook refuses, before the gate", async () => {
    const fetchAccountState = vi.fn();
    const hooks = new AuthHookRegistry();
    hooks.add({
      beforeLogin: () => {
        throw NextlyError.invalidCredentials({
          logContext: { reason: "inactive" },
        });
      },
    });
    const deps = { ...makeDeps({ hooks }), fetchAccountState };

    const res = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
    });

    expect(res.headers.get("Location")).toBe(
      "/admin/login?error=signin-failed"
    );
    expect(fetchAccountState).not.toHaveBeenCalled();
  });

  it("throws on a malformed strategy name, because that is a plugin bug", async () => {
    await expect(
      api(makeDeps()).completeLogin("u1", {
        request,
        strategy: "Not A Strategy Name",
      })
    ).rejects.toSatisfy(
      (e: unknown) => NextlyError.is(e) && e.code === "VALIDATION_ERROR"
    );
  });

  it("lets an unexpected error escape rather than swallowing it", async () => {
    // Only a login OUTCOME becomes a redirect. A database failure is not an
    // outcome, and reporting it as "sign-in failed" would hide an outage.
    const deps = makeDeps();
    deps.findUserById = vi.fn(async () => {
      throw new Error("connection lost");
    });

    await expect(
      api(deps).completeLogin("u1", { request, strategy: "oauth-test" })
    ).rejects.toThrow("connection lost");
  });
});

describe("ctx.auth.currentUser", () => {
  it("returns null when the request carries no session", async () => {
    const res = await api(makeDeps()).currentUser(request);
    expect(res).toBeNull();
  });

  it("returns the signed-in user", async () => {
    const deps = makeDeps();
    const login = await api(deps).completeLogin("u1", {
      request,
      strategy: "oauth-test",
    });
    const sessionCookie = login.headers
      .getSetCookie()
      .find(c => c.startsWith("nextly_session="));
    const withSession = new Request("http://localhost/admin/api/x", {
      headers: { cookie: sessionCookie?.split(";")[0] ?? "" },
    });

    expect(await api(deps).currentUser(withSession)).toEqual({
      id: "u1",
      email: "a@b.c",
    });
  });

  it("returns null for a pending token presented as a session", async () => {
    const { mintPendingToken } = await import("../pipeline/pending-token");
    const pending = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    const withPending = new Request("http://localhost/admin/api/x", {
      headers: { cookie: `nextly_session=${pending}` },
    });

    expect(await api(makeDeps()).currentUser(withPending)).toBeNull();
  });
});
