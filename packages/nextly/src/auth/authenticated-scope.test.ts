/**
 * `apiKeyScopeAllows` judges a scoped API key on its own grants and defers for
 * everyone else; `readAuthenticatedScope` decodes the scope the route stamps.
 */
import { describe, it, expect } from "vitest";

import { readAuthenticatedScope } from "../dispatcher/helpers/authenticated-actor";

import {
  apiKeyScope,
  apiKeyScopeAllows,
  narrowScope,
  ruleFacingPermissions,
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
  it("decodes an API key's stamped permission list", () => {
    const scope = readAuthenticatedScope({
      _authenticatedActorType: "apiKey",
      _authenticatedPermissions: JSON.stringify([
        "update-posts",
        "publish-posts",
      ]),
    });
    expect(scope).toEqual({
      actorType: "apiKey",
      permissions: ["update-posts", "publish-posts"],
    });
  });

  it("yields an empty permission list for a session caller", () => {
    const scope = readAuthenticatedScope({ _authenticatedActorType: "user" });
    expect(scope).toEqual({ actorType: "user", permissions: [] });
  });

  it("returns undefined when no actor type is stamped", () => {
    expect(readAuthenticatedScope({})).toBeUndefined();
  });

  it("denies safely (empty list) when the permissions value is corrupt", () => {
    const scope = readAuthenticatedScope({
      _authenticatedActorType: "apiKey",
      _authenticatedPermissions: "{not json",
    });
    expect(scope).toEqual({ actorType: "apiKey", permissions: [] });
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

describe("ruleFacingPermissions", () => {
  const grants = [
    { slug: "read-posts", action: "read", resource: "posts" },
    { slug: "create-posts", action: "create", resource: "posts" },
  ];

  it("answers in the rule spelling, from the rows", () => {
    expect(ruleFacingPermissions(apiKeyScope(grants))).toEqual([
      "posts:read",
      "posts:create",
    ]);
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
    expect(() => ruleFacingPermissions(narrowedBySpread)).toThrow();
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
    expect(() => ruleFacingPermissions(full)).not.toThrow();
    const narrowed = narrowScope(full, grant => grant.action === "read");
    expect(ruleFacingPermissions(narrowed)).toEqual(["posts:read"]);
  });

  it("returns the stored slugs when the scope carries no rows", () => {
    expect(
      ruleFacingPermissions({
        actorType: "apiKey",
        permissions: ["read-posts"],
      })
    ).toEqual(["read-posts"]);
  });
});
