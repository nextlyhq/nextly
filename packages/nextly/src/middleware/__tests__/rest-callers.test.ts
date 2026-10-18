/**
 * The REST limit with the readers authentication supplies: a session is
 * verified as every session reader verifies it, and a key is looked up and
 * debited once, with authentication reusing both answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Whether an account may still use its token is the session check's own
// question (`auth/session/__tests__/session-standing.test.ts`); here the
// account `revoked` has had its sessions ended and every other may.
vi.mock("../../auth/session/session-standing", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../auth/session/session-standing")
  >()),
  sessionTokenIsCurrent: async (claims: Record<string, unknown>) =>
    claims.sub !== "revoked",
}));

import { signAccessToken } from "../../auth/jwt/sign";
import { requireApiKeyAuth } from "../../auth/middleware";
import { container } from "../../di/container";
import { _resetEnvCache } from "../../shared/lib/env";
import { InMemoryRateLimitStore } from "../rate-limit";
import { defaultRestCallerReaders } from "../rest-callers";
import {
  openRestLimitGate,
  runWithRestLimitGate,
  type RestLimitDecider,
} from "../rest-limit-gate";
import { createRestLimits } from "../rest-limits";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";
const ADDRESS = "203.0.113.7";

let keySeq = 0;

/** A key id no other test has spent, as the per-key window outlives a test. */
function freshKeyId(): string {
  keySeq += 1;
  return `key-${Date.now()}-${keySeq}`;
}

const authenticateApiKey = vi.fn();

function registerServices(keyId: string, requestsPerHour: number): void {
  authenticateApiKey.mockImplementation(async (rawKey: string) =>
    rawKey === "nx_live_valid"
      ? { id: keyId, userId: "owner", tokenType: "full-access", roleId: null }
      : null
  );
  container.register("apiKeyService", () => ({
    authenticateApiKey,
    resolveApiKeyGrants: async () => [],
    resolveApiKeyRoles: async () => [],
  }));
  container.register("config", () => ({
    apiKeys: { rateLimit: { requestsPerHour, windowMs: 3_600_000 } },
  }));
}

function limits(enabled = true): RestLimitDecider {
  return createRestLimits(
    {
      enabled,
      readLimit: 1,
      writeLimit: 1,
      windowMs: 60_000,
      trustProxy: true,
      store: new InMemoryRateLimitStore(),
    },
    defaultRestCallerReaders()
  );
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/admin/api/collections/posts", {
    headers: { "x-forwarded-for": ADDRESS, ...headers },
  });
}

async function sessionCookie(
  sub: string,
  options: { secret?: string; ttlSeconds?: number } = {}
): Promise<Record<string, string>> {
  const token = await signAccessToken(
    { sub, email: `${sub}@example.com` },
    options.secret ?? SECRET,
    options.ttlSeconds ?? 900
  );
  return { cookie: `nextly_session=${token}` };
}

beforeEach(() => {
  vi.stubEnv("NEXTLY_SECRET", SECRET);
  _resetEnvCache();
  authenticateApiKey.mockReset();
});

afterEach(() => {
  container.clear();
  vi.unstubAllEnvs();
  _resetEnvCache();
});

describe("sessions, verified as every session reader verifies them", () => {
  it("counts a verified session against its own budget", async () => {
    const decider = limits();
    const headers = await sessionCookie("u1");
    // The address's single read is spent first, by a request carrying none.
    expect(
      await openRestLimitGate(decider, request()).settle("core")
    ).toBeNull();
    for (let i = 0; i < 5; i++) {
      expect(
        await openRestLimitGate(decider, request(headers)).settle("core")
      ).toBeNull();
    }
  });

  it.each([
    ["forged", () => sessionCookie("u1", { secret: "x".repeat(40) })],
    ["expired", () => sessionCookie("u1", { ttlSeconds: -60 })],
    ["revoked", () => sessionCookie("revoked")],
  ])("counts a %s session as carrying none", async (_name, cookie) => {
    const decider = limits();
    const headers = await cookie();
    expect(
      await openRestLimitGate(decider, request(headers)).settle("core")
    ).toBeNull();
    // The second spends the address's budget of one, as an anonymous
    // request would, and is refused.
    expect(
      (await openRestLimitGate(decider, request(headers)).settle("core"))
        ?.status
    ).toBe(429);
  });
});

describe("API keys, looked up and debited once", () => {
  const bearer = { authorization: "Bearer nx_live_valid" };

  it("admits a key for exactly its configured requests a window, then refuses it", async () => {
    registerServices(freshKeyId(), 3);
    const decider = limits();
    const verdicts: Array<number | null> = [];
    for (let i = 0; i < 5; i++) {
      const refused = await openRestLimitGate(decider, request(bearer)).settle(
        "core"
      );
      verdicts.push(refused?.status ?? null);
    }
    expect(verdicts).toEqual([null, null, null, 429, 429]);
  });

  it("lets authentication reuse the limit's lookup and debit, so the key is counted once", async () => {
    registerServices(freshKeyId(), 2);
    const decider = limits();
    for (let i = 0; i < 2; i++) {
      const req = request(bearer);
      const gate = openRestLimitGate(decider, req);
      expect(await gate.settle("core")).toBeNull();
      const authed = await runWithRestLimitGate(gate, () =>
        requireApiKeyAuth(req)
      );
      // Counted twice, the second request's authentication would be refused.
      expect(authed && "statusCode" in authed ? authed.statusCode : 200).toBe(
        200
      );
    }
    expect(authenticateApiKey).toHaveBeenCalledTimes(2);
  });

  it("answers a key that did not resolve without a second lookup", async () => {
    registerServices(freshKeyId(), 2);
    const req = request({ authorization: "Bearer nx_live_bogus" });
    const gate = openRestLimitGate(limits(), req);
    await gate.settle("core");
    const authed = await requireApiKeyAuth(req);
    expect(authed && "statusCode" in authed ? authed.statusCode : 200).toBe(
      401
    );
    expect(authenticateApiKey).toHaveBeenCalledTimes(1);
  });

  it("keeps the key's own budget with the REST limit off", async () => {
    registerServices(freshKeyId(), 2);
    const decider = limits(false);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const req = request(bearer);
      await openRestLimitGate(decider, req).settle("core");
      const authed = await requireApiKeyAuth(req);
      statuses.push(authed && "statusCode" in authed ? authed.statusCode : 200);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
