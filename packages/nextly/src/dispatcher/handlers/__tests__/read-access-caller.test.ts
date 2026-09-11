/**
 * The dispatcher's caller is read from the scope the route handler pinned,
 * and only from the params when nothing was pinned.
 *
 * The params are a lossy copy of an API key: stored permission slugs, no
 * rows, and roles only for the methods the route handler chose to serialise
 * them for. A caller rebuilt from them answered a code rule that decides on
 * `roles`, or checks the documented `resource:action` spelling, with an empty
 * list and the wrong spelling — a refusal the detail route did not give.
 *
 * @module dispatcher/handlers/__tests__/read-access-caller.test
 */

import { describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { runWithCallerScope } from "../../../auth/caller-scope";
import { readAccessCallerForDispatch } from "../read-access-caller";

const GRANTS = [
  { slug: "read-posts", resource: "posts", action: "read" },
  { slug: "update-posts", resource: "posts", action: "update" },
];
const user = { id: "key-owner", roles: ["admin"] };

describe("the dispatcher's read-access caller", () => {
  it("carries the key's OWN roles from the pinned scope, whatever the params say", () => {
    // 🔴 `listCollections` and `listSingles` are not role-aware reads, so the
    // params never carry the key's roles and `user.roles` names its OWNER's.
    // A rule `read: ({ roles }) => roles.includes("editor")` refused the key on
    // the list and admitted it on the detail route.
    const caller = runWithCallerScope(apiKeyScope(GRANTS, ["editor"]), () =>
      readAccessCallerForDispatch({}, user)
    );
    expect(caller.authMethod).toBe("api-key");
    expect(caller.roles).toEqual(["editor"]);
  });

  it("hands a rule the resource:action spelling, and the coarse check the stored one", () => {
    // 🔴 Two spellings of one list. `AccessControlContext.permissions`
    // promises `posts:read`; the coarse `read-{slug}` check compares against
    // `read-posts`. Forwarding the stored slugs to the rule refused every key
    // whose rule was written to the documented promise.
    const caller = runWithCallerScope(apiKeyScope(GRANTS), () =>
      readAccessCallerForDispatch({}, user)
    );
    expect(caller.permissions).toEqual(["read-posts", "update-posts"]);
    expect(caller.rulePermissions).toEqual(["posts:read", "posts:update"]);
  });

  it("falls back to the params when nothing is pinned, and says so by carrying no rule spelling", () => {
    // A direct dispatch outside the route handler. The stored slugs are all
    // the params hold, and the caller is honest about it: no rule-facing
    // spelling rather than one invented by splitting a slug on its hyphen.
    const caller = readAccessCallerForDispatch(
      {
        _authenticatedActorType: "apiKey",
        _authenticatedPermissions: JSON.stringify(["read-posts"]),
      },
      { id: "key-owner", roles: [] }
    );
    expect(caller.authMethod).toBe("api-key");
    expect(caller.permissions).toEqual(["read-posts"]);
    expect(caller.rulePermissions).toBeUndefined();
  });

  it("builds a session caller with no grants of its own", () => {
    const caller = readAccessCallerForDispatch(
      {},
      { id: "u1", roles: ["editor"] }
    );
    expect(caller).toEqual({
      userId: "u1",
      authMethod: "session",
      permissions: [],
      roles: ["editor"],
    });
  });
});
