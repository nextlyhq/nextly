/**
 * A request naming one entry its caller may not read is answered exactly as a
 * missing entry is: 404 `NOT_FOUND`, in the generic words. A caller who may
 * read it is told what it may not do (403), since the entry's existence is no
 * secret to it.
 *
 * The REST route gate runs for real, as in `refusal-reasons.test.ts`; only
 * what sits outside it is replaced. The caller is a key holding `grants`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../../authenticated-scope";

const state = vi.hoisted(() => ({ grants: [] as GrantedPermission[] }));

vi.mock("../../../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "apiKeyService" || key === "rbacAccessControlService",
    get: (key: string) =>
      key === "apiKeyService"
        ? {
            authenticateApiKey: async () => ({
              id: "key-1",
              userId: "owner-1",
              tokenType: "read-only",
              roleId: null,
            }),
            resolveApiKeyGrants: async () => state.grants,
            resolveApiKeyRoles: async () => [],
          }
        : {
            getRegisteredAccess: () => undefined,
            getRegisteredTarget: () => undefined,
          },
  },
}));

vi.mock("../../session", () => ({
  getSession: async () => ({ authenticated: false }),
}));

vi.mock("../../../lib/env", () => ({ env: { NEXTLY_SECRET: "test-secret" } }));

vi.mock("../../../services/lib/permissions", () => ({
  hasPermission: async () => false,
  hasAnyPermission: async () => false,
}));

vi.mock("../api-key-budget", () => ({
  apiKeyRateLimitRefusal: async () => null,
}));

const { requireCollectionAccess } = await import("../index");

/** The grants `read-posts` and the like, for the key. */
function holds(...actions: string[]): GrantedPermission[] {
  return actions.map(action => ({
    slug: `${action}-posts`,
    action,
    resource: "posts",
  }));
}

/** The gate's answer to `action` on post 7, or on the collection. */
function ask(action: string, entryId?: string) {
  return requireCollectionAccess(
    new Request("https://example.com/api/collections/posts/entries/7", {
      headers: { authorization: "Bearer nx_test_key" },
    }),
    action,
    "posts",
    { method: "updateEntry", params: entryId ? { entryId } : {} }
  );
}

const MISSING = {
  statusCode: 404,
  code: "NOT_FOUND",
  error: "Not found.",
};

beforeEach(() => {
  state.grants = [];
});

describe("a request naming one entry", () => {
  it("is answered as missing to a caller who may not read it, whatever it asks", async () => {
    for (const action of ["read", "update", "delete", "publish"]) {
      await expect(ask(action, "7")).resolves.toMatchObject(MISSING);
    }
  });

  it("is refused in words to a caller who may read it", async () => {
    state.grants = holds("read");
    const answer = await ask("update", "7");
    // Told what it may not do; this site registers no label for "posts",
    // so the sentence names nothing. What matters is that it is not missing.
    expect(answer).toMatchObject({
      statusCode: 403,
      error: "You can't do that.",
    });
    expect(answer).not.toMatchObject(MISSING);
  });

  it("is admitted to a caller who may do what it asks", async () => {
    state.grants = holds("update");
    const answer = await ask("update", "7");
    expect("statusCode" in answer).toBe(false);
  });
});

describe("a request naming no one entry", () => {
  it("is refused in words, not answered as missing", async () => {
    await expect(ask("update")).resolves.toMatchObject({ statusCode: 403 });
  });
});
