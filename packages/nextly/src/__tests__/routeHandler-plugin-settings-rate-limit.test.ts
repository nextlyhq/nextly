/**
 * How much of an API key's rate limit a plugin-settings request spends.
 *
 * The settings gate authenticates the caller before it boots services, and
 * then judges the caller's permission. Each authentication of a key takes a
 * slot from the key's limit, so a gate that authenticated again to judge the
 * permission spent two slots per request, and a key with one slot left was
 * refused with a 429 a request it could afford.
 *
 * Judging the caller it already holds, the gate must hold one whose grants are
 * settled: a boot in flight may still be seeding the permission the key is
 * judged by.
 *
 * A real request goes through the real handler, the real auth middleware and
 * the real in-memory limiter. Only what sits outside them is replaced: the
 * key service and the config, registered in the real container; the session
 * lookup (no session, so the bearer key is used); the service boot; and the
 * dispatcher, which records the requests the gate let through.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const LIMIT = 3;
const WINDOW_MS = 3_600_000;
const KEY_ID = "settings-key";

/** The settings permission, as the key holds it once it has been granted. */
const PAY_GRANT = {
  slug: "update-pay-settings",
  action: "update",
  resource: "pay-settings",
};

const services = vi.hoisted(() => ({
  /** What the key's grants resolve to when they are read. */
  grants: [] as Array<{ slug: string; action: string; resource: string }>,
  apiKeyService: {
    authenticateApiKey: async () => ({
      id: "settings-key",
      userId: "owner-1",
      tokenType: "full-access",
      roleId: null,
    }),
    resolveApiKeyGrants: async () => services.grants,
    resolveApiKeyRoles: async () => [],
  },
  config: {} as Record<string, unknown>,
}));

/** The requests the gate let through to the dispatcher. */
const dispatched = vi.hoisted(
  () => [] as Array<{ service: string; method: string }>
);

vi.mock("../auth/session", () => ({
  getSession: async () => ({ authenticated: false }),
}));

vi.mock("../route-handler", async importOriginal => ({
  ...(await importOriginal<typeof import("../route-handler")>()),
  ensureServicesInitialized: async () => undefined,
  getDispatcher: async () => ({
    dispatch: async (request: { service: string; method: string }) => {
      dispatched.push({ service: request.service, method: request.method });
      return { success: true, status: 200, data: { apiKey: "" } };
    },
  }),
}));

import { rateLimiter } from "../auth/middleware/rate-limiter";
import { container } from "../di/container";
import { holdBootSeeding } from "../init/seed-permissions";
import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;
// sqlite is the one dialect whose environment needs no connection string.
process.env.DB_DIALECT = "sqlite";

// Registered as factories, so each read sees the config a case set up.
container.register("apiKeyService", () => services.apiKeyService);
container.register("config", () => services.config);

afterAll(() => {
  container.clear();
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

const plugins = [
  {
    name: "@acme/pay",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      settings: z.object({ apiKey: z.string().default("") }),
      permissions: [{ action: "update", resource: "pay-settings" }],
      settingsPermission: "update-pay-settings",
    },
  },
];

const handlers = createDynamicHandlers({
  config: sanitizeConfig({ collections: [] }),
});

/** Next.js hands route segments in as a promise; mirror that shape. */
const ctx = {
  params: Promise.resolve({ params: ["plugins-settings", "@acme", "pay"] }),
};

function settingsRequest(httpMethod: "GET" | "PATCH"): Request {
  return new Request("http://localhost/api/plugins-settings/@acme/pay", {
    method: httpMethod,
    headers: {
      authorization: "Bearer nx_test_key",
      "content-type": "application/json",
    },
    body: httpMethod === "PATCH" ? JSON.stringify({ apiKey: "x" }) : undefined,
  });
}

function send(httpMethod: "GET" | "PATCH"): Promise<Response> {
  return httpMethod === "GET"
    ? handlers.GET(settingsRequest("GET"), ctx)
    : handlers.PATCH(settingsRequest("PATCH"), ctx);
}

/** Spend `count` of the key's slots before the request under test. */
async function spend(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await rateLimiter.check(KEY_ID, LIMIT, WINDOW_MS);
  }
}

beforeEach(async () => {
  await rateLimiter.clear(KEY_ID);
  dispatched.length = 0;
  services.grants = [PAY_GRANT];
  services.config = {
    plugins,
    apiKeys: { rateLimit: { requestsPerHour: LIMIT, windowMs: WINDOW_MS } },
  };
});

describe.each(["GET", "PATCH"] as const)(
  "an API key's plugin-settings %s",
  httpMethod => {
    const method =
      httpMethod === "GET" ? "getPluginSettings" : "updatePluginSettings";

    it("reaches the settings handler with one request left in its limit", async () => {
      await spend(LIMIT - 1);

      const response = await send(httpMethod);

      expect(response.status).toBe(200);
      expect(dispatched).toEqual([{ service: "pluginSettings", method }]);
    });

    it("spends exactly one slot of the key's limit", async () => {
      // Separates once from twice when neither is refused: a request with
      // the whole limit available passes either way.
      await send(httpMethod);

      expect(await rateLimiter.peek(KEY_ID, WINDOW_MS)).toBe(1);
    });

    it("is refused once the key has spent its limit", async () => {
      // The control: a gate that never reached the limiter would pass the
      // cases above.
      await spend(LIMIT);

      const response = await send(httpMethod);

      expect(response.status).toBe(429);
      expect(dispatched).toEqual([]);
    });

    it("is judged on the grants a boot in flight leaves it", async () => {
      // A boot seeding the plugin's permission grants it to the key's owner
      // as it goes. Read before that seeding finished, the key's grants lack
      // it, and the request was refused a permission the boot had given it.
      services.grants = [];
      const release = holdBootSeeding();
      const response = send(httpMethod);
      // Let the request run as far as it will before the boot completes.
      await new Promise(resolve => setTimeout(resolve, 50));

      services.grants = [PAY_GRANT];
      release();

      expect((await response).status).toBe(200);
      expect(dispatched).toEqual([{ service: "pluginSettings", method }]);
    });
  }
);
