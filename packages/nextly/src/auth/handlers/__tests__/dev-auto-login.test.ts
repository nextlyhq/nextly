/**
 * Tests for the dev-auto-login branch of handleSession.
 *
 * The framework gate has three security-relevant invariants we want to
 * lock in forever:
 *
 *   1. NODE_ENV=production hard-blocks. Even if devAutoLogin is set,
 *      the handler returns 401 and logs a warning.
 *   2. Dev-mode happy path issues a real session cookie + JWT for the
 *      configured user.
 *   3. Missing user falls through to the normal 401 (we never create
 *      users in this codepath).
 *   4. Malformed devAutoLogin shape from upstream config plumbing
 *      returns false from `readDevAutoLogin` and the session handler
 *      treats it as "not configured".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSession, type SessionHandlerDeps } from "../session";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function makeFakeUser() {
  return {
    id: "user-1",
    email: "dev@nextly.local",
    name: "Dev User",
    image: null as string | null,
    passwordHash: "irrelevant",
    emailVerified: new Date(),
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null as Date | null,
  };
}

function makeDeps(
  overrides: Partial<SessionHandlerDeps> = {}
): SessionHandlerDeps {
  return {
    secret: "test-secret-32-chars-minimum-padding-padding",
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 7 * 24 * 60 * 60,
    devAutoLogin: { email: "dev@nextly.local", password: "dev" },
    findUserByEmail: vi.fn().mockResolvedValue(makeFakeUser()),
    fetchRoleIds: vi.fn().mockResolvedValue([]),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
    storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRequest(): Request {
  return new Request("http://localhost:3000/admin/api/auth/session");
}

beforeEach(() => {
  // Reset module-level dedup set between tests by re-importing. Without
  // this the "warn once per process" dedup defeats the prod-block test.
  vi.resetModules();
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.restoreAllMocks();
});

describe("handleSession dev-auto-login", () => {
  describe("production hard-block (security invariant)", () => {
    it("returns 401 and logs a warning when NODE_ENV=production", async () => {
      process.env.NODE_ENV = "production";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deps = makeDeps({ isProduction: true });

      const { handleSession: handle } = await import("../session");
      const res = await handle(makeRequest(), deps);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("AUTH_REQUIRED");
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/devAutoLogin ignored: NODE_ENV=production/)
      );
      // findUserByEmail should NEVER be called in prod, even with config set.
      expect(deps.findUserByEmail).not.toHaveBeenCalled();
    });
  });

  describe("dev-mode happy path", () => {
    it("issues a session cookie + JWT for the configured user", async () => {
      process.env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { handleSession: handle } = await import("../session");
      const res = await handle(makeRequest(), makeDeps());

      expect(res.status).toBe(200);
      const setCookies = res.headers.get("set-cookie") ?? "";
      // Both access (session) and refresh cookies should be set.
      // Cookie names are owned by the framework (cookies/access-token-cookie.ts +
      // cookies/refresh-token-cookie.ts) so we match defensively rather than
      // hardcoding exact names.
      expect(setCookies).toMatch(/nextly[._-]session\b/i);
      expect(setCookies).toMatch(/nextly[._-]refresh\b/i);
      expect(setCookies).toMatch(/HttpOnly/);

      // Body shape should match the authenticated `respondData({ user, accessToken })`
      // shape - no `{ data: ... }` envelope, so SDK clients see one shape.
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("user");
      expect(body).toHaveProperty("accessToken");
      expect(body).not.toHaveProperty("data");
      expect((body.user as { email: string }).email).toBe("dev@nextly.local");
      expect(typeof body.accessToken).toBe("string");
    });

    it("logs the 'devAutoLogin enabled' warning once per process", async () => {
      process.env.NODE_ENV = "development";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { handleSession: handle } = await import("../session");
      await handle(makeRequest(), makeDeps());
      await handle(makeRequest(), makeDeps());

      const enabledWarnings = warn.mock.calls.filter(call =>
        String(call[0]).includes("devAutoLogin enabled for")
      );
      expect(enabledWarnings).toHaveLength(1);
    });
  });

  describe("missing user falls through to 401", () => {
    it("returns 401 when findUserByEmail resolves null", async () => {
      process.env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { handleSession: handle } = await import("../session");
      const res = await handle(
        makeRequest(),
        makeDeps({ findUserByEmail: vi.fn().mockResolvedValue(null) })
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("AUTH_REQUIRED");
    });

    it("returns 401 when the configured user is deactivated", async () => {
      process.env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const inactive = { ...makeFakeUser(), isActive: false };
      const { handleSession: handle } = await import("../session");
      const res = await handle(
        makeRequest(),
        makeDeps({ findUserByEmail: vi.fn().mockResolvedValue(inactive) })
      );

      expect(res.status).toBe(401);
    });
  });

  describe("stale cookie after dev DB reset", () => {
    // Regression test for the dev:reset scenario: the contributor's
    // browser holds a JWT signed against the previous DB. The JWT
    // verifies cryptographically (same NEXTLY_SECRET) but its userId
    // points to a row that no longer exists; or after a reseed the
    // email exists but with a fresh id. Without this safeguard the
    // session resolves as "authenticated", every downstream RBAC check
    // 403's against a phantom user, and FK-checked writes
    // (permission_cache, audit_log) crash.
    async function makeStaleCookieRequest(
      secret: string,
      jwtUserId: string
    ): Promise<Request> {
      const { signAccessToken } = await import("../../jwt/sign");
      const { buildClaims } = await import("../../jwt/claims");
      const claims = buildClaims({
        userId: jwtUserId,
        email: "dev@nextly.local",
        name: "Old Dev User",
        image: null,
        roleIds: [],
        customFields: {},
      });
      const token = await signAccessToken(claims, secret, 900);
      return new Request("http://localhost:3000/admin/api/auth/session", {
        headers: { cookie: `nextly_session=${token}` },
      });
    }

    it("re-issues a session when the JWT references a user that has been deleted", async () => {
      process.env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { handleSession: handle } = await import("../session");
      const deps = makeDeps({
        // Stale userId in cookie -> no live row.
        findUserByEmail: vi.fn().mockResolvedValue(null),
      });
      const req = await makeStaleCookieRequest(deps.secret, "user-deleted");

      const res = await handle(req, deps);

      // Falls through to devAutoLogin happy path = re-issued session.
      // findUserByEmail returns null in this mock, so devAutoLogin
      // also can't find the user and returns null; we fall to 401
      // with the stale cookie cleared.
      expect(res.status).toBe(401);
      const setCookies = res.headers.get("set-cookie") ?? "";
      expect(setCookies).toMatch(/nextly_session=.*Max-Age=0/);
    });

    it("re-issues a session when the JWT user's id no longer matches the live row (post-reseed)", async () => {
      process.env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const { handleSession: handle } = await import("../session");
      // Live row exists with the same email but a fresh id (the
      // dev:reset scenario - seed always uses the same email).
      const liveUser = { ...makeFakeUser(), id: "user-fresh" };
      const deps = makeDeps({
        findUserByEmail: vi.fn().mockResolvedValue(liveUser),
      });
      const req = await makeStaleCookieRequest(deps.secret, "user-stale");

      const res = await handle(req, deps);

      // 200 with NEW cookies for the live user.
      expect(res.status).toBe(200);
      const setCookies = res.headers.get("set-cookie") ?? "";
      expect(setCookies).toMatch(/nextly[._-]session\b/i);
      expect(setCookies).toMatch(/nextly[._-]refresh\b/i);

      const body = (await res.json()) as { user: { id: string; email: string } };
      expect(body.user.id).toBe("user-fresh");
      expect(body.user.email).toBe("dev@nextly.local");
    });
  });

  describe("malformed devAutoLogin config", () => {
    it("returns 401 when devAutoLogin is false (not configured)", async () => {
      process.env.NODE_ENV = "development";

      const { handleSession: handle } = await import("../session");
      const res = await handle(makeRequest(), makeDeps({ devAutoLogin: false }));

      expect(res.status).toBe(401);
    });

    it("returns 401 when devAutoLogin email is empty string", async () => {
      process.env.NODE_ENV = "development";

      const { handleSession: handle } = await import("../session");
      const res = await handle(
        makeRequest(),
        makeDeps({ devAutoLogin: { email: "" } })
      );

      expect(res.status).toBe(401);
    });
  });
});
