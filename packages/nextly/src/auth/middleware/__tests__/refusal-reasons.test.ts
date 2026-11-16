/**
 * What the route gate's refusals say, and the reason each logs.
 *
 * The caller is told what was refused; the log is told why, truthfully: which
 * way a key failed, and never a missing grant where the gate cannot tell one
 * from an access rule's refusal. An any-of refusal names what was asked for,
 * not whichever grant it happened to list first.
 *
 * The middleware runs for real; only what sits outside it is replaced, as in
 * `require-collection-access-language.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeyRefusalCause } from "../../../domains/auth/services/api-key-service";
import type { KnownApiKey } from "../../../middleware/rest-limit-gate";

const state = vi.hoisted(() => ({
  cause: undefined as ApiKeyRefusalCause | undefined,
  known: undefined as KnownApiKey | undefined,
}));

vi.mock("../../../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "apiKeyService" || key === "rbacAccessControlService",
    get: (key: string) =>
      key === "apiKeyService"
        ? {
            authenticateApiKey: async (
              _rawKey: string,
              onRefused?: (cause: ApiKeyRefusalCause) => void
            ) => {
              if (state.cause) {
                onRefused?.(state.cause);
                return null;
              }
              return {
                id: "key-1",
                userId: "owner-1",
                tokenType: "read-only",
                roleId: null,
              };
            },
            // A key holding nothing, so every check refuses it.
            resolveApiKeyGrants: async () => [],
            resolveApiKeyRoles: async () => [],
          }
        : {
            getRegisteredAccess: () => undefined,
            getRegisteredTarget: () => undefined,
          },
  },
}));

vi.mock("../../../middleware/rest-limit-gate", async importOriginal => ({
  ...(await importOriginal<object>()),
  currentRestLimitGate: () =>
    state.known ? { knownKey: () => state.known } : undefined,
}));

vi.mock("../../session", () => ({
  getSession: async () => ({ authenticated: false }),
}));

vi.mock("../rate-limiter", () => ({
  authRateLimiter: () => ({
    check: async () => ({ allowed: true, resetAt: new Date() }),
  }),
}));

vi.mock("../../../lib/env", () => ({ env: { NEXTLY_SECRET: "test-secret" } }));

vi.mock("../../../services/lib/permissions", () => ({
  hasPermission: async () => false,
  hasAnyPermission: async () => false,
}));

vi.mock("../api-key-budget", () => ({
  apiKeyRateLimitRefusal: async () => null,
}));

const { requireAnyPermission, requireAuthentication, requirePermission } =
  await import("../index");

/** A request authenticated by its bearer key alone. */
function request(): Request {
  return new Request("https://example.com/admin/api/rbac/permissions/p1", {
    headers: { authorization: "Bearer nx_test_key" },
  });
}

beforeEach(() => {
  state.cause = undefined;
  state.known = undefined;
});

describe("a refused key's reason", () => {
  it.each([
    ["unknown", "the API key is not one this site issued"],
    ["revoked", "the API key is revoked"],
    ["expired", "the API key has expired"],
    ["creator-inactive", "the API key's creator is not active"],
  ] as const)("says the key was %s", async (cause, reason) => {
    state.cause = cause;
    const answer = await requireAuthentication(request());
    expect(answer).toMatchObject({
      statusCode: 401,
      error: "Authentication required.",
      reason,
    });
  });

  it("says why the key the REST limit already looked up was refused", async () => {
    state.known = { resolved: null, debited: false, cause: "expired" };
    const answer = await requireAuthentication(request());
    expect(answer).toMatchObject({
      statusCode: 401,
      reason: "the API key has expired",
    });
  });
});

describe("a refused permission's reason", () => {
  it("does not claim a missing grant where an access rule may have refused", async () => {
    const answer = await requirePermission(request(), "update", "users");
    expect(answer).toMatchObject({ statusCode: 403 });
    const { reason } = answer as { reason?: string };
    expect(reason).toContain("access rule");
    expect(reason).not.toMatch(/does not hold/);
  });
});

describe("what an any-of refusal names", () => {
  it("names the target it is given, not the first grant it accepts", async () => {
    const answer = await requireAnyPermission(
      request(),
      [
        { action: "read", resource: "roles" },
        { action: "read", resource: "permissions" },
      ],
      { action: "read", resource: "permissions" }
    );
    expect(answer).toMatchObject({
      statusCode: 403,
      error: "You can't see permissions.",
    });
  });

  it("names the one thing every alternative is about", async () => {
    const answer = await requireAnyPermission(request(), [
      { action: "update", resource: "email-providers" },
      { action: "manage", resource: "email-providers" },
    ]);
    expect(answer).toMatchObject({ error: "You can't edit email providers." });
  });

  it("names nothing where the alternatives are about different things", async () => {
    const answer = await requireAnyPermission(request(), [
      { action: "read", resource: "roles" },
      { action: "read", resource: "permissions" },
    ]);
    expect(answer).toMatchObject({ error: "You can't do that." });
  });
});
