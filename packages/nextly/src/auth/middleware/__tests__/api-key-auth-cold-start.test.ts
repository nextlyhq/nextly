/**
 * An API key presented to a process that has not started its services yet.
 *
 * A serverless instance answers its first request cold: nothing is registered
 * in the container until a route starts the services. A request signed in with
 * a session starts them through the boot the route handler installs, because
 * its standing must be read from the database. A key must be looked up in the
 * database too, so it starts them the same way, rather than being refused
 * because the key service is not registered yet.
 *
 * Every request here runs inside a REST limit gate with the limit turned off,
 * as an app with `rateLimit: { enabled: false }` runs it: the limit's own key
 * lookup can start the services when it is on, and must not be what lets the
 * key through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Whether services are registered, as this file sets it: a cold process says
// no until its boot has run.
const ready = vi.hoisted(() => ({ registered: false }));
vi.mock("../../../di/service-access", () => ({
  isServicesRegistered: () => ready.registered,
}));

import { container } from "../../../di/container";
import { InMemoryRateLimitStore } from "../../../middleware/rate-limit";
import { defaultRestCallerReaders } from "../../../middleware/rest-callers";
import {
  openRestLimitGate,
  runWithRestLimitGate,
} from "../../../middleware/rest-limit-gate";
import { createRestLimits } from "../../../middleware/rest-limits";
import { setNextlyLogger } from "../../../observability/logger";
import { _resetEnvCache } from "../../../shared/lib/env";
import { setSessionStandingBoot } from "../../session/session-standing";
import {
  type AuthContext,
  createJsonErrorResponse,
  type ErrorResponse,
  requireAuthentication,
} from "../index";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";

let keySeq = 0;

/** A key id no other test has spent, as the per-key window outlives a test. */
function freshKeyId(): string {
  keySeq += 1;
  return `cold-key-${Date.now()}-${keySeq}`;
}

/** What the real registration puts in the container for a key lookup. */
function registerKeyService(keyId: string): void {
  container.register("apiKeyService", () => ({
    authenticateApiKey: async (rawKey: string) =>
      rawKey === "nx_live_valid"
        ? { id: keyId, userId: "owner", tokenType: "full-access", roleId: null }
        : null,
    resolveApiKeyGrants: async () => [],
    resolveApiKeyRoles: async () => ["editor"],
  }));
  container.register("config", () => ({
    apiKeys: { rateLimit: { requestsPerHour: 100, windowMs: 3_600_000 } },
  }));
}

/** A request carrying the key and no session, judged with the limit off. */
async function authenticateWithLimitOff(
  key = "nx_live_valid"
): Promise<AuthContext | ErrorResponse> {
  const req = new Request("http://localhost/admin/api/collections/posts", {
    headers: { authorization: `Bearer ${key}` },
  });
  const decider = createRestLimits(
    {
      enabled: false,
      readLimit: 1,
      writeLimit: 1,
      windowMs: 60_000,
      trustProxy: false,
      store: new InMemoryRateLimitStore(),
    },
    defaultRestCallerReaders(async () => {
      throw new Error("the disabled limit must not start the services");
    })
  );
  const gate = openRestLimitGate(decider, req);
  expect(await gate.settle("core")).toBeNull();
  return runWithRestLimitGate(gate, () => requireAuthentication(req));
}

const logged: object[] = [];

beforeEach(() => {
  vi.stubEnv("NEXTLY_SECRET", SECRET);
  _resetEnvCache();
  logged.length = 0;
  setNextlyLogger({
    error: entry => logged.push(entry),
    warn: () => {},
    info: () => {},
    debug: () => {},
  });
});

afterEach(() => {
  setSessionStandingBoot(undefined);
  setNextlyLogger(undefined);
  container.clear();
  ready.registered = false;
  vi.unstubAllEnvs();
  _resetEnvCache();
});

describe("an API key on a process that has not started its services", () => {
  it("starts them through the boot a session uses, then authenticates the key", async () => {
    const keyId = freshKeyId();
    const boot = vi.fn(async () => {
      registerKeyService(keyId);
      ready.registered = true;
    });
    setSessionStandingBoot(boot);

    const auth = await authenticateWithLimitOff();

    expect(auth).toMatchObject({
      authMethod: "api-key",
      userId: "owner",
      apiKeyId: keyId,
      roles: ["editor"],
    });
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("still refuses a key that does not resolve once they are started", async () => {
    const boot = vi.fn(async () => {
      registerKeyService(freshKeyId());
      ready.registered = true;
    });
    setSessionStandingBoot(boot);

    const auth = await authenticateWithLimitOff("nx_live_bogus");

    expect(auth).toMatchObject({ statusCode: 401 });
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("does not start them again on a process that already has", async () => {
    registerKeyService(freshKeyId());
    ready.registered = true;
    const boot = vi.fn(async () => {});
    setSessionStandingBoot(boot);

    expect(await authenticateWithLimitOff()).toMatchObject({
      authMethod: "api-key",
    });
    expect(boot).not.toHaveBeenCalled();
  });

  it("answers 503 without the cause when the services fail to start, and logs why", async () => {
    setSessionStandingBoot(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    });

    const auth = await authenticateWithLimitOff();

    expect(auth).toMatchObject({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    const body = JSON.stringify(
      await createJsonErrorResponse(auth as ErrorResponse).json()
    );
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("10.0.0.5");
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0])).toContain("ECONNREFUSED");
    expect(logged[0]).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      logContext: { reason: "api-key-services-failed-to-start" },
    });
  });

  it("answers 503 and names the remedy when nothing in the process can start them", async () => {
    const auth = await authenticateWithLimitOff();

    expect(auth).toMatchObject({
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      logContext: { reason: "api-key-read-before-nextly-initialised" },
    });
  });
});
