/**
 * A list's gate is checked the way it says: `one` through the single-grant
 * check, `any` through the any-of check with its refusal target, on the route
 * side and the caller side alike.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as Array<[string, unknown[]]>);

vi.mock("./middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("./middleware")>();
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
      return { statusCode: 403, error: "Forbidden" };
    };
  return {
    ...actual,
    requirePermission: vi.fn(record("requirePermission")),
    requireAnyPermission: vi.fn(record("requireAnyPermission")),
    authorizeCaller: vi.fn(record("authorizeCaller")),
    authorizeCallerForAny: vi.fn(record("authorizeCallerForAny")),
  };
});

import {
  authorizeListRead,
  LIST_READ_GATES,
  requireListRead,
} from "./list-read-gates";
import type { AuthContext } from "./middleware";

const req = new Request("http://localhost/api/anything");
const auth: AuthContext = {
  userId: "u1",
  permissions: [],
  roles: [],
  authMethod: "api-key",
};

beforeEach(() => {
  calls.length = 0;
});

describe("a gate is checked the way it says, on both sides", () => {
  it("one grant: the single-grant check", async () => {
    await requireListRead(req, LIST_READ_GATES.users);
    await authorizeListRead(auth, LIST_READ_GATES.users);
    expect(calls).toEqual([
      ["requirePermission", [req, "read", "users"]],
      ["authorizeCaller", [auth, "read", "users"]],
    ]);
  });

  it("any of: the any-of check, naming the target it carries", async () => {
    // 🔴 The permissions list is the one a count took the other way: its one
    // grant went through the single check, which judges an API key on more.
    await requireListRead(req, LIST_READ_GATES.permissions);
    await authorizeListRead(auth, LIST_READ_GATES.permissions);
    const grants = [{ action: "read", resource: "roles" }];
    const target = { action: "read", resource: "permissions" };
    expect(calls).toEqual([
      ["requireAnyPermission", [req, grants, target]],
      ["authorizeCallerForAny", [auth, grants, target]],
    ]);
  });
});
