/**
 * The dashboard's API-key count covers exactly the keys the API-key list shows
 * the same caller.
 *
 * Two places answer "whose keys may this caller see": the list endpoint, and
 * `apiKeyCountScope` for the count. This drives the REAL list handler beside
 * the count's decision, for one caller at a time, and asks that they agree, so
 * a change to either that the other does not follow fails here rather than
 * reopening the count's disclosure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const superAdmins = vi.hoisted(() => new Set<string>());
const listed = vi.hoisted(() => ({
  calls: [] as Array<{ userId: string; allUsers: boolean | undefined }>,
}));
const caller = vi.hoisted(() => ({ userId: "u1" }));

vi.mock("../../lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../lib/permissions")>()),
  isSuperAdmin: vi.fn(async (userId: string) => superAdmins.has(userId)),
}));

vi.mock("../../../auth/middleware", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../auth/middleware")>()),
  // The list admits this caller: what is under test is whose keys it lists.
  requireAnyPermission: vi.fn(async () => ({
    userId: caller.userId,
    permissions: ["read-api-keys"],
    roles: [],
    authMethod: "session",
  })),
}));

vi.mock("../../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../di", () => ({
  container: {
    get: () => ({
      listApiKeys: async (userId: string, opts?: { allUsers?: boolean }) => {
        listed.calls.push({ userId, allUsers: opts?.allUsers });
        return [];
      },
    }),
  },
}));

import { listApiKeys } from "../../../api/api-keys";
import type { AuthContext } from "../../../auth/middleware";
import { apiKeyCountScope, type ApiKeyCountScope } from "../admin-counts";

/** The scope the list applied for the current caller, read off its own call. */
async function listScope(): Promise<ApiKeyCountScope> {
  listed.calls.length = 0;
  const res = await listApiKeys(new Request("http://localhost/api/api-keys"));
  expect(res.status).toBe(200);
  const [call] = listed.calls;
  expect(call, "the list must have read keys").toBeDefined();
  return call!.allUsers === true
    ? { kind: "all" }
    : { kind: "owner", userId: call!.userId };
}

function auth(userId: string): AuthContext {
  return {
    userId,
    permissions: ["read-api-keys"],
    roles: [],
    authMethod: "session",
  };
}

beforeEach(() => {
  superAdmins.clear();
  listed.calls.length = 0;
});

describe("the key count covers the keys the key list shows", () => {
  it.each([
    ["a super-admin", "admin-1", true],
    ["an ordinary key administrator", "owner-1", false],
  ])("for %s", async (_, userId, isSuper) => {
    caller.userId = userId;
    if (isSuper) superAdmins.add(userId);
    const listsAs = await listScope();
    // The control: the two callers really are listed differently.
    expect(listsAs.kind).toBe(isSuper ? "all" : "owner");
    expect(await apiKeyCountScope(auth(userId))).toEqual(listsAs);
  });
});
