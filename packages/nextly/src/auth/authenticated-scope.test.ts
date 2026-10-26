/**
 * `apiKeyScopeAllows` judges a scoped API key on its own grants and defers for
 * everyone else; `readAuthenticatedScope` reads the scope the request caller
 * was authenticated with.
 */
import { describe, it, expect } from "vitest";

import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../dispatcher/__tests__/request-caller";
import { readAuthenticatedScope } from "../dispatcher/helpers/authenticated-actor";

import {
  apiKeyScope,
  apiKeyScopeAllows,
  apiKeyScopeFrom,
  narrowScope,
  scopeGrants,
  scopeHoldsSuperAdmin,
} from "./authenticated-scope";

describe("apiKeyScopeAllows", () => {
  it("allows when the API key holds the `{operation}-{resource}` grant", () => {
    const scope = {
      actorType: "apiKey" as const,
      permissions: ["update-posts", "publish-posts"],
    };
    expect(apiKeyScopeAllows(scope, "publish", "posts")).toBe(true);
  });

  it("denies when the API key lacks the grant", () => {
    const scope = {
      actorType: "apiKey" as const,
      permissions: ["update-posts"],
    };
    expect(apiKeyScopeAllows(scope, "publish", "posts")).toBe(false);
  });

  it("returns null (defer to RBAC) for a session caller", () => {
    const scope = { actorType: "user" as const, permissions: [] };
    expect(apiKeyScopeAllows(scope, "publish", "posts")).toBeNull();
  });

  it("returns null (defer to RBAC) when no scope is present", () => {
    expect(apiKeyScopeAllows(undefined, "publish", "posts")).toBeNull();
  });

  it("does not confuse resources whose names share a prefix", () => {
    const scope = {
      actorType: "apiKey" as const,
      permissions: ["publish-posts-archive"],
    };
    // `publish-posts` must not be satisfied by `publish-posts-archive`.
    expect(apiKeyScopeAllows(scope, "publish", "posts")).toBe(false);
  });
});

describe("readAuthenticatedScope", () => {
  it("answers an API key with the scope the route pinned, whole", () => {
    // The same object every other gate sees, rows included, so a service
    // re-check judges the key on its own grants rather than a copy of them.
    const pinned = apiKeyScope([
      { slug: "update-posts", action: "update", resource: "posts" },
      { slug: "publish-posts", action: "publish", resource: "posts" },
    ]);
    const scope = asCaller(
      keyCaller("key-1"),
      () => readAuthenticatedScope(),
      pinned
    );
    expect(scope).toBe(pinned);
    expect(scope?.permissions).toEqual(["update-posts", "publish-posts"]);
  });

  it("yields an empty permission list for a session caller", () => {
    const scope = asCaller(sessionCaller(), () => readAuthenticatedScope());
    expect(scope).toEqual({ actorType: "user", permissions: [] });
  });

  it("returns undefined when the request has no caller", () => {
    expect(asCaller(undefined, () => readAuthenticatedScope())).toBeUndefined();
  });

  it("denies safely (empty list) for an API key with no pinned scope", () => {
    // Still judged as a key, on no grants at all, rather than falling back to
    // the account that owns it.
    const scope = asCaller(keyCaller("key-1"), () => readAuthenticatedScope());
    expect(scope).toEqual({ actorType: "apiKey", permissions: [] });
    expect(apiKeyScopeAllows(scope, "publish", "posts")).toBe(false);
  });
});

describe("narrowScope on a caller with no scope", () => {
  it("answers undefined rather than throwing", () => {
    // A SESSION caller reaches the same routes an API key does and carries no
    // scope. Throwing here would make a route that narrows crash for every
    // signed-in person — and the guard each call site would need is exactly the
    // `!` that shipped in the documentation.
    expect(narrowScope(undefined, () => true)).toBeUndefined();
  });
});

describe("scopeGrants", () => {
  const grants = [
    { slug: "read-posts", action: "read", resource: "posts" },
    { slug: "create-posts", action: "create", resource: "posts" },
  ];

  it("answers with the rows behind the slugs", () => {
    expect(scopeGrants(apiKeyScope(grants))).toEqual(grants);
  });

  it("refuses a scope whose rows and slugs disagree", () => {
    // The shape no selector can refuse: spreading a scope and replacing only the
    // slugs keeps every original row, so this function would go on naming a
    // grant the caller has given up. `narrowScope` filters both halves; a
    // hand-written spread filters one.
    const narrowedBySpread = {
      ...apiKeyScope(grants),
      permissions: ["read-posts"],
    };
    expect(() => scopeGrants(narrowedBySpread)).toThrow();
    // And the answer it would have given is the one that makes this worth
    // refusing rather than tolerating: the surrendered grant, still named.
    // Narrowed rather than asserted — rows the spread failed to carry would
    // reach `map` as undefined and fail on a property access, which reads as a
    // broken test rather than as the premise no longer holding.
    const carried = narrowedBySpread.grants;
    if (carried === undefined) {
      throw new TypeError("a spread scope must carry the rows it copied");
    }
    expect(carried.map(g => g.slug)).toContain("create-posts");
  });

  it("accepts every scope the constructors build", () => {
    // The negative control. A check that threw on anything would satisfy the
    // assertion above while making each real caller unusable, and both
    // constructors are the callers that matter.
    const full = apiKeyScope(grants);
    expect(() => scopeGrants(full)).not.toThrow();
    const narrowed = narrowScope(full, grant => grant.action === "read");
    expect(scopeGrants(narrowed)).toEqual([grants[0]]);
  });

  it("answers no rows when the scope carries none", () => {
    expect(
      scopeGrants({
        actorType: "apiKey",
        permissions: ["read-posts"],
      })
    ).toBeUndefined();
  });
});

describe("a key's super-admin authority on its scope", () => {
  const grants = [{ slug: "read-posts", action: "read", resource: "posts" }];

  it("is carried by the scope made from an authenticated key that holds it, with or without rows", () => {
    expect(
      scopeHoldsSuperAdmin(
        apiKeyScopeFrom({ grants, roles: [], keyHoldsSuperAdmin: true })
      )
    ).toBe(true);
    expect(
      scopeHoldsSuperAdmin(
        apiKeyScopeFrom({
          permissions: ["read-posts"],
          keyHoldsSuperAdmin: true,
        })
      )
    ).toBe(true);
  });

  it("is carried by no narrowed or copied scope, nor one built without it", () => {
    const withRows = apiKeyScopeFrom({ grants, keyHoldsSuperAdmin: true });
    const withoutRows = apiKeyScopeFrom({
      permissions: ["read-posts"],
      keyHoldsSuperAdmin: true,
    });
    // Narrowed to keep everything: the grants are the same, the authority
    // is not, through either way a scope is narrowed.
    expect(scopeHoldsSuperAdmin(narrowScope(withRows, () => true))).toBe(false);
    expect(scopeHoldsSuperAdmin(narrowScope(withoutRows, () => true))).toBe(
      false
    );
    expect(scopeHoldsSuperAdmin({ ...withRows })).toBe(false);
    expect(scopeHoldsSuperAdmin(apiKeyScope(grants))).toBe(false);
    expect(scopeHoldsSuperAdmin(apiKeyScopeFrom({ grants }))).toBe(false);
    expect(scopeHoldsSuperAdmin(undefined)).toBe(false);
  });
});
