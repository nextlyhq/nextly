import { describe, it, expect, vi } from "vitest";

import { ChallengeRegistry } from "../../pipeline/challenge";
import { AuthHookRegistry } from "../../pipeline/hooks";
import {
  mintPendingToken,
  verifyPendingToken,
} from "../../pipeline/pending-token";
import {
  handleChallengeResolve,
  type ChallengeResolveDeps,
} from "../challenge-resolve";

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
    // DECLARED here, though it starts undefined, so the cases that install a
    // counter are assigning to a known property rather than widening the
    // inferred literal — which is what left their callback parameters
    // implicitly `any` and the assignment itself an error.
    countChallengeAttempt: undefined as
      | ChallengeResolveDeps["countChallengeAttempt"]
      | undefined,
  };
}

/**
 * The retry payload, read from wherever the response carries it.
 *
 * A wrong answer answers 401 with the CANONICAL error envelope, so the retry
 * data sits under `error.data` — the only place a client that throws on a
 * non-2xx status can still reach it.
 */
function retryPayload(body: Record<string, unknown>): {
  status?: string;
  challengeType?: string;
  pendingToken?: string;
} {
  const error = body.error as { data?: Record<string, unknown> } | undefined;
  return (error?.data ?? {}) as {
    status?: string;
    challengeType?: string;
    pendingToken?: string;
  };
}

/**
 * Mint a pending token the current build would mint: flow id and flow
 * lifetime signed in. Every case uses it, so a fixture that forgets the
 * lifetime fails as the refusable token it is rather than passing as the
 * backward-compat shape no production mint ever produced.
 */
async function mint(
  claims: { userId: string; challengeId: string; attempts?: number } & Record<
    string,
    unknown
  >
): Promise<string> {
  return mintPendingToken(
    {
      attempts: 0,
      flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    } as never,
    SECRET,
    300
  );
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
    const pendingToken = await mint({ userId: "u1", challengeId: "totp" });
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
    const pendingToken = await mint({ userId: "u1", challengeId: "totp" });
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      deps
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    const retry = retryPayload(body);
    expect(retry.status).toBe("challenge");
    expect(typeof retry.pendingToken).toBe("string");
    expect(retry.pendingToken).not.toBe(pendingToken);
  });

  it("carries `next` and `strategy` across a wrong answer", async () => {
    // The re-minted token REPLACES the HttpOnly cookie, so anything dropped
    // here is gone for good: an external login that asked to land somewhere
    // specific lost that destination on the first wrong answer, and the
    // eventual correct one issued a session to the dashboard instead.
    const deps = makeDeps();
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      strategy: "oauth-google",
      next: "/admin/posts",
    });

    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      deps
    );
    const body = (await res.json()) as { pendingToken: string };

    // Read back from the TOKEN, not from the response envelope: the claims
    // are what the next attempt is decided from, and the envelope never
    // carried them.
    const reissued = await verifyPendingToken(
      retryPayload(body).pendingToken as string,
      SECRET
    );
    expect(reissued?.next).toBe("/admin/posts");
    expect(reissued?.strategy).toBe("oauth-google");
    // The one thing that MUST change between rounds, so this is not simply
    // asserting the original token came back.
    expect(reissued?.attempts).toBe(1);
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

    const replayed = await mint({ userId: "u1", challengeId: "totp" });

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
        if (retryPayload(body).status !== "challenge") stoppedAfter = attempt;
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
    const pendingToken = await mint({ userId: "u1", challengeId: "totp" });
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      deps
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(retryPayload(body).status).toBe("challenge");
  });

  it("fails for good once attempts are exhausted", async () => {
    const deps = makeDeps();
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 5,
    });
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(retryPayload(body).status).not.toBe("challenge");
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
    const pendingToken = await mint({
      userId,
      challengeId: "totp",
      attempts: 0,
    });
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

/**
 * The budget is a PRECONDITION, not a consolation for guessing wrong.
 *
 * Minting a replacement pending token does not revoke the one presented, so a
 * caller can replay the original `attempts: 0` token indefinitely. Counting
 * only wrong answers left the correct one free: every guess was rejected until
 * the right one arrived, and that one was accepted however many had preceded
 * it. Spending the budget before the answer is examined is what turns
 * `maxChallengeAttempts` into a cap.
 */
describe("the challenge budget as a precondition", () => {
  /** Run one resolve, reporting whether the counter was consulted. */
  async function attempt(code: string, allowed: boolean) {
    const deps = makeDeps();
    const seen: string[] = [];
    const withCounter = {
      ...deps,
      countChallengeAttempt: (key: string) => {
        seen.push(key);
        return Promise.resolve({ allowed });
      },
    };
    const pendingToken = await mint({ userId: "u1", challengeId: "totp" });
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code } }),
      withCounter as never
    );
    return { status: res.status, spent: seen.length };
  }

  it("spends the budget on a CORRECT answer too", async () => {
    // The separating property. Counting inside the wrong-answer branch leaves
    // this at zero, and a replayed token can then guess without limit.
    const { status, spent } = await attempt("123456", true);
    expect(status).toBe(200);
    expect(spent).toBe(1);
  });

  it("refuses a correct answer once the budget is exhausted", async () => {
    // The decisive half: exhaustion must bind regardless of the answer, or
    // the cap only ever delays the successful guess.
    const { status, spent } = await attempt("123456", false);
    expect(spent).toBe(1);
    expect(status).toBe(401);
  });

  it("still lets an ordinary correct answer through", async () => {
    // The control. A precondition that refused everything would satisfy the
    // test above while breaking every real second-factor sign-in.
    const { status } = await attempt("123456", true);
    expect(status).toBe(200);
  });
});

describe("the challenge attempt budget, per login flow", () => {
  /** The counter key one wrong answer was charged against. */
  async function keyFor(claims: { flow?: string }): Promise<string> {
    const deps = makeDeps();
    const seen: string[] = [];
    const withCounter = {
      ...deps,
      countChallengeAttempt: async (key: string) => {
        seen.push(key);
        return { allowed: true };
      },
    };
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      ...claims,
    });
    await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      withCounter as never
    );
    expect(seen).toHaveLength(1);
    return seen[0];
  }

  it("gives two interrupted logins for ONE account separate budgets", async () => {
    // Keyed on the challenge alone, five SUCCESSFUL logins inside the window
    // refused the sixth before it was attempted: the counter answered "how
    // many logins has this account started", which is not what a
    // per-challenge cap exists to bound.
    const first = await keyFor({ flow: "flow-one" });
    const second = await keyFor({ flow: "flow-two" });

    expect(first).not.toBe(second);
    expect(first).toContain("flow-one");
    expect(second).toContain("flow-two");
  });

  it("keeps one budget across the retries of a single login", async () => {
    // The control. A key carrying anything per-ATTEMPT would satisfy the test
    // above while giving every guess a fresh budget, and the cap would never
    // bind. The retry token re-issued by a wrong answer carries the SAME flow
    // id, so its next answer draws on the budget the first one opened.
    const deps = makeDeps();
    const seen: string[] = [];
    const withCounter = {
      ...deps,
      countChallengeAttempt: async (key: string) => {
        seen.push(key);
        return { allowed: true };
      },
    };
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      flow: "flow-one",
    });
    const first = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "000000" } }),
      withCounter as never
    );
    const retryToken = retryPayload(await first.json()).pendingToken;
    expect(retryToken).toBeTypeOf("string");

    await handleChallengeResolve(
      makeRequest({ pendingToken: retryToken, response: { code: "000000" } }),
      withCounter as never
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toContain("flow-one");
  });

  it("REFUSES a token carrying no flow lifetime", async () => {
    // Every mint this build makes signs a lifetime, so absence means a token
    // nothing here could have produced — treated as unlimited, the absence
    // would be a bypass; refused, it is an anomaly with no expiry to renew.
    const deps = makeDeps();
    const noLifetime = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0, flow: "f1" },
      SECRET,
      300
    );

    const res = await handleChallengeResolve(
      makeRequest({ pendingToken: noLifetime, response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(401);
  });
});

describe("a cookie-mode challenge that ends in a forced password change", () => {
  /** A wrong-then-right cookie-mode resolve for a must-change account. */
  async function resolvedOverCookie(): Promise<Response> {
    const deps = makeDeps();
    deps.findUserById = vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "A",
      image: null,
      isActive: true,
      mustChangePassword: true,
    });
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      flow: "f",
    });
    const request = new Request(
      "http://localhost:3000/admin/api/auth/challenge/resolve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `nextly_csrf=tok; nextly_pending=${pendingToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          csrfToken: "tok",
          response: { code: "123456" },
        }),
      }
    );
    return handleChallengeResolve(request, deps);
  }

  it("answers with the replacement token in the COOKIE, not the body", async () => {
    // The token belongs in the cookie for the same reason the retry token
    // does: the body is somewhere script can reach. Leaving the old token in
    // the cookie resumed the settled challenge after a reload, spending the
    // budget on every revisit instead of reaching the set-password step.
    const res = await resolvedOverCookie();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("password_change_required");
    expect(body).not.toHaveProperty("pendingToken");

    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("nextly_pending=");
    const token = /nextly_pending=([^;]+)/.exec(setCookie)?.[1];
    expect(token).toBeTypeOf("string");
    // And the cookie holds the step it advertises: a must-change token, not
    // another round of the challenge just answered.
    const claims = await verifyPendingToken(token as string, SECRET);
    expect(claims.challengeId).toBe("must-change-password");
  });

  it("keeps returning the token in the body to a caller that sent one", async () => {
    // The control. A password login handed its challenge token in the body;
    // the same login's password-change step has to reach it the same way,
    // because it has no cookie to carry a replacement.
    const deps = makeDeps();
    deps.findUserById = vi.fn().mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "A",
      image: null,
      isActive: true,
      mustChangePassword: true,
    });
    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      flow: "f",
    });
    const res = await handleChallengeResolve(
      makeRequest({ pendingToken, response: { code: "123456" } }),
      deps
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("password_change_required");
    expect(typeof body.pendingToken).toBe("string");
  });
});

describe("the flow's fixed lifetime", () => {
  it("refuses a token whose flow has expired, whatever its attempt count", async () => {
    // Each wrong answer re-issues a token with a FRESH TTL, and the
    // server-side budget is a window entries age out of — so without a
    // non-resetting end signed at the pause, replaying an old low-attempt
    // token near each window's edge kept one flow guessing far past the cap.
    const deps = makeDeps();
    const expiredFlow = await mintPendingToken(
      {
        userId: "u1",
        challengeId: "totp",
        attempts: 0,
        flow: "f1",
        flowExpiresAt: Math.floor(Date.now() / 1000) - 10,
      },
      SECRET,
      300
    );

    const res = await handleChallengeResolve(
      makeRequest({
        pendingToken: expiredFlow,
        response: { code: "123456" },
      }),
      deps
    );

    expect(res.status).toBe(401);
  });

  it("still accepts a correct answer inside the flow's lifetime", async () => {
    // The control: the fixed end bounds the flow, it does not shorten it —
    // the token is as fresh as its own TTL says right up to that instant.
    const deps = makeDeps();
    const liveFlow = await mintPendingToken(
      {
        userId: "u1",
        challengeId: "totp",
        attempts: 0,
        flow: "f1",
        flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
      },
      SECRET,
      300
    );

    const res = await handleChallengeResolve(
      makeRequest({ pendingToken: liveFlow, response: { code: "123456" } }),
      deps
    );
    expect(res.status).toBe(200);
  });
});

describe("a cookie-mode flow that fails for good", () => {
  it("clears the pending cookie on the terminal refusal", async () => {
    // The terminal token still verifies until its TTL expires, so leaving
    // the cookie in place kept `/auth/pending` reporting the exhausted
    // challenge after every reload — the login page hiding its password and
    // provider options behind a continuation nothing can finish.
    const deps = makeDeps();
    deps.countChallengeAttempt = async () => ({ allowed: false });

    const pendingToken = await mint({
      userId: "u1",
      challengeId: "totp",
      attempts: 0,
      flow: "f1",
    });
    const request = new Request(
      "http://localhost:3000/admin/api/auth/challenge/resolve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `nextly_csrf=tok; nextly_pending=${pendingToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          csrfToken: "tok",
          response: { code: "123456" },
        }),
      }
    );

    const res = await handleChallengeResolve(request, deps);
    expect(res.status).toBe(401);
    // The clear-serialization the cookie helper emits: empty value, gone at
    // once. What matters is that a Set-Cookie for the pending cookie is on
    // the refusal at all.
    expect(res.headers.getSetCookie().join("\n")).toMatch(
      /nextly_pending=;.*Max-Age=0/
    );
  });
});

describe("a legacy cookie with no signed flow lifetime", () => {
  it("reports NOTHING resumable, hiding the unfinishable challenge", async () => {
    // Minted before the claim existed: the resolve path refuses it, but
    // /auth/pending was still answering 200 — the login UI stayed stuck
    // on a challenge nothing could finish until the JWT expired. The
    // must-change sentinel is exempt: its token never carries the claim.
    const { handlePending } = await import("../pending");
    const legacy = await mintPendingToken(
      { userId: "u1", challengeId: "totp", attempts: 0 },
      SECRET,
      300
    );
    const request = new Request(
      "http://localhost:3000/admin/api/auth/pending",
      {
        headers: { cookie: `nextly_pending=${legacy}` },
      }
    );

    const res = await handlePending(request, makeDeps() as never);
    expect(res.status).toBe(204);
  });

  it("still reports a legacy MUST-CHANGE cookie", async () => {
    // The control: the sentinel never carries the lifetime, and the
    // set-password step reads the cookie directly — hiding it would break
    // a legitimate forced change for an upgraded install.
    const { handlePending } = await import("../pending");
    const legacy = await mintPendingToken(
      { userId: "u1", challengeId: "must-change-password", attempts: 0 },
      SECRET,
      300
    );
    const request = new Request(
      "http://localhost:3000/admin/api/auth/pending",
      {
        headers: { cookie: `nextly_pending=${legacy}` },
      }
    );

    const res = await handlePending(request, makeDeps() as never);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { challengeId: string }).challengeId).toBe(
      "must-change-password"
    );
  });
});

describe("the flow lifetime on the pending-status path", () => {
  it("is enforced by /auth/pending too", async () => {
    // A wrong answer near the flow's end re-issues a token whose JWT is
    // fresh for another TTL while the flow is over; reporting it resumable
    // kept the login page hiding its ordinary options behind a continuation
    // nothing can finish.
    const { handlePending } = await import("../pending");
    const deps = makeDeps() as never;
    const expired = await mintPendingToken(
      {
        userId: "u1",
        challengeId: "totp",
        attempts: 0,
        flow: "f1",
        flowExpiresAt: Math.floor(Date.now() / 1000) - 10,
      },
      SECRET,
      300
    );
    const request = new Request(
      "http://localhost:3000/admin/api/auth/pending",
      {
        headers: { cookie: `nextly_pending=${expired}` },
      }
    );

    const res = await handlePending(request, deps);
    expect(res.status).toBe(204);
  });

  it("still reports a live flow", async () => {
    const { handlePending } = await import("../pending");
    const deps = makeDeps() as never;
    const live = await mintPendingToken(
      {
        userId: "u1",
        challengeId: "totp",
        attempts: 0,
        flow: "f1",
        flowExpiresAt: Math.floor(Date.now() / 1000) + 300,
      },
      SECRET,
      300
    );
    const request = new Request(
      "http://localhost:3000/admin/api/auth/pending",
      {
        headers: { cookie: `nextly_pending=${live}` },
      }
    );

    const res = await handlePending(request, deps);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { challengeId: string }).challengeId).toBe(
      "totp"
    );
  });
});
