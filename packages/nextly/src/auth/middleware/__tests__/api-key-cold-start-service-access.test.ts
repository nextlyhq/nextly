/**
 * An API key on a cold process, judged through the real `di/service-access`.
 *
 * `api-key-auth-cold-start.test.ts` decides whether services are registered by
 * mocking `isServicesRegistered`, so it says nothing about the module that
 * answers in production. Here nothing in `di` is mocked. The key path finds no
 * key service in the container, asks the real flag whether the services were
 * started, and boots them when they were not: a flag that answered
 * "registered" on a cold process would skip the boot and refuse the key with a
 * 503, as a serverless instance's first request once was.
 *
 * The boot sets the flag as `registerServices()` does. That registration sets
 * the same flag is pinned on its own, by `di/__tests__/registration-latch.test.ts`,
 * which runs the real registration and reads the flag through `di/service-access`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  type ErrorResponse,
  requireAuthentication,
} from "../index";

const SECRET = "a-test-secret-of-at-least-thirty-two-characters";

/** The flag `registerServices()` sets once registration has finished. */
const registration = globalThis as unknown as {
  __nextly_isRegistered?: boolean;
};

/** A request carrying a key and no session, with the REST limit off. */
async function authenticate(): Promise<AuthContext | ErrorResponse> {
  const req = new Request("http://localhost/admin/api/collections/posts", {
    headers: { authorization: "Bearer nx_live_valid" },
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

beforeEach(() => {
  vi.stubEnv("NEXTLY_SECRET", SECRET);
  _resetEnvCache();
  setNextlyLogger({
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  });
  container.clear();
  registration.__nextly_isRegistered = undefined;
});

afterEach(() => {
  setSessionStandingBoot(undefined);
  setNextlyLogger(undefined);
  container.clear();
  registration.__nextly_isRegistered = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
});

describe("an API key on a cold process, through the real service lookup", () => {
  it("starts the services on the first request and authenticates the key, with no 503", async () => {
    const boot = vi.fn(async () => {
      container.register("apiKeyService", () => ({
        authenticateApiKey: async (rawKey: string) =>
          rawKey === "nx_live_valid"
            ? {
                id: "cold-key-real-flag",
                userId: "owner",
                tokenType: "full-access",
                roleId: null,
              }
            : null,
        resolveApiKeyGrants: async () => [],
        resolveApiKeyRoles: async () => ["editor"],
      }));
      container.register("config", () => ({
        apiKeys: { rateLimit: { requestsPerHour: 100, windowMs: 3_600_000 } },
      }));
      registration.__nextly_isRegistered = true;
    });
    setSessionStandingBoot(boot);

    const auth = await authenticate();

    expect(auth).not.toMatchObject({ statusCode: 503 });
    expect(auth).toMatchObject({
      authMethod: "api-key",
      userId: "owner",
      apiKeyId: "cold-key-real-flag",
    });
    expect(boot).toHaveBeenCalledTimes(1);
  });
});
