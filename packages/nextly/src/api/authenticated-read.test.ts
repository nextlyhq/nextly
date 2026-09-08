/**
 * Coverage for `readCaller`'s API-KEY branch, which had none.
 *
 * `readCaller` is the seam that decides whether an access rule judges a request
 * on the KEY's own stamped grant or on the roles of whoever minted it. The
 * conditional spread that builds `authenticatedScope` is the whole mechanism,
 * and it is the kind that fails silently in both directions: dropped, a
 * narrowly scoped key inherits its owner's reach; emitted for a session, a
 * session caller is judged against an empty permission list and reads nothing.
 * Neither raises an error -- the request succeeds and answers as somebody else.
 *
 * `resolveRoleSlugs` is mocked because it is a database lookup with nothing to
 * connect to here; the assertions are about what `readCaller` ASSEMBLES from
 * the auth context, which is the part that has no other coverage.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/lib/permissions", () => ({
  resolveRoleSlugs: vi.fn(),
}));

import type { AuthContext } from "../auth/middleware";
import { resolveRoleSlugs } from "../services/lib/permissions";

import { readCaller } from "./authenticated-read";

/** An API-key context: the user id is the key's OWNER, not the key. */
function apiKeyAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "owner-1",
    userName: "Owner",
    userEmail: "owner@example.com",
    permissions: ["read-posts"],
    roles: ["viewer-of-posts"],
    authMethod: "api-key",
    apiKeyId: "key-1",
    ...overrides,
  };
}

function sessionAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    userName: "User",
    userEmail: "user@example.com",
    permissions: [],
    roles: ["role-id-abc"],
    authMethod: "session",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveRoleSlugs as ReturnType<typeof vi.fn>).mockResolvedValue(["editor"]);
});

describe("readCaller for an API-KEY caller", () => {
  it("carries the KEY's own stamped grant as `authenticatedScope`", async () => {
    const caller = await readCaller(apiKeyAuth());

    // `actorType: "apiKey"` is what makes `apiKeyScopeAllows` treat the scope
    // as authoritative; any other value makes it return null and fall back to
    // the OWNER's RBAC, which is the inheritance this branch exists to stop.
    expect(caller.authenticatedScope).toEqual({
      actorType: "apiKey",
      permissions: ["read-posts"],
    });
  });

  it("forwards the grant verbatim, in the `action-resource` spelling", async () => {
    // API-key permissions are `permissions.slug` -- `${action}-${resource}` --
    // not the `${resource}:${action}` form session RBAC builds. `readCaller`
    // must not translate: `apiKeyScopeAllows` compares against
    // `permissionSlug(operation, resource)`, which is the hyphen form.
    const permissions = ["read-posts", "update-posts", "read-site-settings"];

    const caller = await readCaller(apiKeyAuth({ permissions }));

    expect(caller.authenticatedScope?.permissions).toEqual(permissions);
  });

  it("carries an EMPTY grant rather than omitting the scope", async () => {
    // A role-based key whose role was deleted resolves to `[]`. Omitting the
    // scope here would send the decision back to the owner's roles, so the
    // least-privileged key would be judged as the most privileged owner.
    const caller = await readCaller(apiKeyAuth({ permissions: [] }));

    expect(caller.authenticatedScope).toEqual({
      actorType: "apiKey",
      permissions: [],
    });
  });

  it("resolves role SLUGS onto the user rather than forwarding raw ids", async () => {
    const caller = await readCaller(apiKeyAuth());

    expect(resolveRoleSlugs).toHaveBeenCalledWith(apiKeyAuth());
    expect(caller.user.roles).toEqual(["editor"]);
    expect(caller.user.id).toBe("owner-1");
  });
});

describe("readCaller for a SESSION caller", () => {
  it("omits `authenticatedScope` entirely", async () => {
    const caller = await readCaller(sessionAuth());

    // Present-but-empty would be judged as an api-key with no grants and read
    // nothing; absent is what sends the decision to the session's own RBAC.
    expect(caller.authenticatedScope).toBeUndefined();
    expect("authenticatedScope" in caller).toBe(false);
  });

  it("still builds the user context, so the caller is not anonymous", async () => {
    // The control for the assertion above: `authenticatedScope` being absent
    // must mean the branch declined it, not that `readCaller` returned an
    // empty object. Without this, a `readCaller` that built nothing at all
    // would satisfy the undefined check.
    const caller = await readCaller(sessionAuth());

    expect(caller.user).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      roles: ["editor"],
      role: "editor",
    });
  });
});
