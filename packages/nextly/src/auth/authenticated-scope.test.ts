/**
 * `apiKeyScopeAllows` judges a scoped API key on its own grants and defers for
 * everyone else; `readAuthenticatedScope` decodes the scope the route stamps.
 */
import { describe, it, expect } from "vitest";

import { readAuthenticatedScope } from "../dispatcher/helpers/authenticated-actor";

import { apiKeyScopeAllows } from "./authenticated-scope";

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
