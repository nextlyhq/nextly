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
    requireEmailVerification: true,
    fetchAccountState: vi.fn().mockResolvedValue({
      userId: "u1",
      isActive: true,
      lockedUntil: null,
      emailVerified: new Date("2026-01-01T00:00:00Z"),
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
    // A user who always completes a second factor logs in through THIS handler,
    // never through the one that first asked for the password. Recording the
    // success only there would leave that population absent from the trail —
    // which is the population an operator most wants to see in it.
    expect(deps.auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "login-succeeded", actorUserId: "u1" })
    );
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

  it("caps guesses even when the SAME token is replayed every time", async () => {
    // The cap lived entirely in the submitted token, and minting a
    // replacement did not invalidate the one presented — so resubmitting the
    // original `attempts: 0` token after each wrong answer bought unlimited
    // guesses until its TTL. Counting per CHALLENGE is what makes the cap
    // enforceable; the old test only proved a new token comes back.
    const counted = new Map<string, number>();
    const deps = makeDeps();
    deps.countChallengeAttempt = (challengeId, limit) => {
      const next = (counted.get(challengeId) ?? 0) + 1;
      counted.set(challengeId, next);
      return Promise.resolve({ allowed: next < limit });
    };

    const replayed = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );

    // "Stopped" is either a refusal response or a thrown refusal, depending
    // on which guard trips first; both end the challenge, and the property
    // under test is that SOMETHING does.
    let stoppedAfter: number | undefined;
    for (
      let attempt = 1;
      attempt <= 8 && stoppedAfter === undefined;
      attempt += 1
    ) {
      try {
        const res = await handleChallengeResolve(
          makeRequest({ pendingToken: replayed, response: { code: "000000" } }),
          deps
        );
        const body = (await res.json()) as Record<string, unknown>;
        if (body.status !== "challenge") stoppedAfter = attempt;
      } catch {
        stoppedAfter = attempt;
      }
    }

    expect(stoppedAfter).toBeDefined();
    expect(stoppedAfter).toBeLessThanOrEqual(deps.maxChallengeAttempts);
  });

  it("still lets a caller inside the cap try again", async () => {
    // The control. A counter that refused everything would satisfy the test
    // above while breaking the second factor for everyone.
    const deps = makeDeps();
    deps.countChallengeAttempt = () => Promise.resolve({ allowed: true });
    const pendingToken = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      deps
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("challenge");
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

/**
 * Whose budget a wrong answer spends.
 *
 * `challengeId` names the challenge DEFINITION — "totp" — which every account
 * using that factor shares. Keying the attempt counter on it alone pooled all
 * of their wrong answers into one budget, so a handful of failures by any one
 * account locked every other account out of that factor until the window
 * expired. The key is the separating property: a count of calls looks
 * identical either way.
 */
describe("the challenge attempt budget", () => {
  /** Answer wrongly as `userId`, returning the key the counter was given. */
  async function keyFor(userId: string): Promise<string> {
    const deps = makeDeps();
    const seen: string[] = [];
    const withCounter = {
      ...deps,
      countChallengeAttempt: async (key: string) => {
        seen.push(key);
        return { allowed: true };
      },
    };
    const pendingToken = await mintPendingToken(
      { userId, challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      withCounter as never
    );
    // The population before the verdict: one wrong answer must have reached
    // the counter exactly once, or the key below is not evidence of anything.
    expect(seen).toHaveLength(1);
    return seen[0];
  }

  it("gives two accounts on the same challenge separate budgets", async () => {
    const first = await keyFor("u1");
    const second = await keyFor("u2");

    expect(first).not.toBe(second);
    expect(first).toContain("u1");
    expect(second).toContain("u2");
    // Both still name the challenge, so a user answering TOTP wrongly does
    // not spend the budget for a different factor they also hold.
    expect(first).toContain("totp");
    expect(second).toContain("totp");
  });

  it("gives one account the SAME budget across attempts", async () => {
    // The control. A key carrying anything per-request — a nonce, a
    // timestamp, the token itself — would separate the two users above while
    // giving every attempt a fresh budget, so the cap would never bind.
    expect(await keyFor("u1")).toBe(await keyFor("u1"));
  });
});
