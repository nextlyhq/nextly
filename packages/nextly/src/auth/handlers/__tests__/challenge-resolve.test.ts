import { describe, it, expect, vi } from "vitest";

import { ChallengeRegistry } from "../../pipeline/challenge";
import { AuthHookRegistry } from "../../pipeline/hooks";
import { mintPendingToken } from "../../pipeline/pending-token";
import { handleChallengeResolve } from "../challenge-resolve";

const SECRET = "test-secret-that-is-at-least-32-characters-long!!";

function makeDeps() {
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
  };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/admin/api/auth/challenge/resolve", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "nextly_csrf=tok",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ csrfToken: "tok", ...body }),
  });
}

describe("handleChallengeResolve (D71)", () => {
  it("issues a session when the challenge resolves", async () => {
    const deps = makeDeps();
    const pendingToken = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe("Logged in.");
    expect(body.user).toMatchObject({ id: "u1", email: "a@b.c" });
    expect(typeof body.accessToken).toBe("string");
  });

  it("re-challenges with a fresh pending token on a wrong code", async () => {
    const deps = makeDeps();
    const pendingToken = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      deps
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("challenge");
    expect(typeof body.pendingToken).toBe("string");
    expect(body.pendingToken).not.toBe(pendingToken);
  });

  it("rejects an invalid pending token", async () => {
    const deps = makeDeps();
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken: "garbage", response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(401);
  });

  it("fails for good once attempts are exhausted", async () => {
    const deps = makeDeps();
    const pendingToken = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 5 },
      SECRET,
      300
    );
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).not.toBe("challenge");
  });
});
