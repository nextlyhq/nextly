/**
 * Which rate-limit store the challenge-attempt cap counts against.
 *
 * Its own file because it mocks the limiter module, and the rest of the
 * challenge suite exercises the real one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ChallengeRegistry } from "../../pipeline/challenge";
import { AuthHookRegistry } from "../../pipeline/hooks";
import { mintPendingToken } from "../../pipeline/pending-token";
import { handleChallengeResolve } from "../challenge-resolve";

// Typed with its PARAMETER, so the store argument is part of the recorded
// call rather than dropped by an inferred zero-argument signature — which is
// the only thing these tests assert on.
const authRateLimiter = vi.fn((_store?: unknown) => ({
  check: async () => ({ allowed: true }),
}));

vi.mock("../../middleware/rate-limiter", () => ({
  authRateLimiter: (store?: unknown) => authRateLimiter(store),
}));

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

/** A store object with nothing on it: identity is the whole assertion. */
const CONFIGURED_STORE = { marker: "configured" } as never;

function makeDeps(authRateLimit?: { store?: unknown }) {
  const challengeRegistry = new ChallengeRegistry();
  challengeRegistry.add({
    id: "totp",
    resolve: async ({ response }) =>
      response.code === "123456" ? { ok: true } : { ok: false },
  });
  return {
    secret: SECRET,
    isProduction: false,
    accessTokenTTL: 900,
    refreshTokenTTL: 604800,
    trustProxy: false,
    trustedProxyIps: [],
    fetchRoleIds: vi.fn().mockResolvedValue(["editor"]),
    fetchCustomFields: vi.fn().mockResolvedValue({}),
    storeRefreshToken: vi.fn().mockResolvedValue(undefined),
    authHooks: new AuthHookRegistry(),
    pluginCtx: {} as never,
    challengeRegistry,
    challengeTokenTTL: 300,
    maxChallengeAttempts: 5,
    allowedOrigins: ["http://localhost:3000"],
    loginStallTimeMs: 0,
    auditLog: { write: vi.fn().mockResolvedValue(undefined) },
    findUserById: vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "A",
      image: null,
      isActive: true,
    }),
    requireEmailVerification: true,
    fetchAccountState: vi.fn().mockResolvedValue({
      userId: "u1",
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date("2026-01-01T00:00:00Z"),
    }),
    ...(authRateLimit ? { authRateLimit } : {}),
  };
}

async function resolveOnce(deps: ReturnType<typeof makeDeps>) {
  const pendingToken = await mintPendingToken(
    { userId: "u1", challengeId: "totp", attempts: 0 },
    SECRET,
    300
  );
  const request = new Request(
    "http://localhost:3000/admin/api/auth/challenge/resolve",
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
        response: { code: "000000" },
      }),
    }
  );
  await handleChallengeResolve(request, deps as never);
}

describe("the challenge-attempt cap counts against the CONFIGURED store", () => {
  beforeEach(() => {
    authRateLimiter.mockClear();
  });

  it("passes the configured store to the limiter", async () => {
    // Without this the counter called `authRateLimiter()` with no argument,
    // which is the process-memory limiter whatever the install configured — so
    // every worker enforced its own copy of the five-attempt budget and the
    // real cap was `maxChallengeAttempts` times the instance count, in exactly
    // the deployments that have a shared store because they run more than one
    // process.
    await resolveOnce(makeDeps({ store: CONFIGURED_STORE }));

    expect(authRateLimiter).toHaveBeenCalled();
    expect(authRateLimiter.mock.calls[0][0]).toBe(CONFIGURED_STORE);
  });

  it("passes undefined when no store is configured", async () => {
    // The control. Passing some fixed object regardless would satisfy the
    // assertion above while ignoring the configuration entirely; a single
    // instance with no shared store must still reach the in-memory limiter.
    await resolveOnce(makeDeps());

    expect(authRateLimiter).toHaveBeenCalled();
    expect(authRateLimiter.mock.calls[0][0]).toBeUndefined();
  });
});
