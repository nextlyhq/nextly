/**
 * The dispatcher's caller is read from the scope the route handler pinned for
 * an API key, never rebuilt from a copy of it.
 *
 * A rebuilt copy is lossy: stored permission slugs, no rows, and roles only
 * for the methods that resolve them. A caller rebuilt that way answered a code
 * rule that decides on `roles`, or on a permission whose row it could not
 * give, with an empty list — a refusal the detail route did not give.
 *
 * @module dispatcher/handlers/__tests__/read-access-caller.test
 */

import { describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import { readAccessCallerForDispatch } from "../read-access-caller";

const GRANTS = [
  { slug: "read-posts", resource: "posts", action: "read" },
  { slug: "update-posts", resource: "posts", action: "update" },
];
const user = { id: "key-owner", roles: ["admin"] };
const key = keyCaller("key-1", { userId: "key-owner" });

describe("the dispatcher's read-access caller", () => {
  it("carries the key's OWN roles from the pinned scope, whatever its owner's are", () => {
    // 🔴 `listCollections` and `listSingles` are not role-aware reads, so the
    // caller carries no roles for them and `user.roles` names the key's OWNER's.
    // A rule `read: ({ roles }) => roles.includes("editor")` refused the key on
    // the list and admitted it on the detail route.
    const caller = asCaller(
      key,
      () => readAccessCallerForDispatch(user),
      apiKeyScope(GRANTS, ["editor"])
    );
    expect(caller.authMethod).toBe("api-key");
    expect(caller.roles).toEqual(["editor"]);
  });

  it("carries the stored slugs for the coarse check, with the rows a rule's list is built from", () => {
    // The coarse `read-{slug}` check compares the stored slugs; a rule is
    // handed them too, and, for one release, each row's earlier spelling,
    // which only the rows can give.
    const caller = asCaller(
      key,
      () => readAccessCallerForDispatch(user),
      apiKeyScope(GRANTS)
    );
    expect(caller.permissions).toEqual(["read-posts", "update-posts"]);
    expect(caller.grants).toEqual(GRANTS);
  });

  it("judges a key with nothing pinned as a key with no grants, and carries no rows", () => {
    // A dispatch that reached a key caller without its scope. It is still a
    // key, so its owner's grants do not stand in; it holds none, and the
    // caller invents no rows for them.
    const caller = asCaller(key, () =>
      readAccessCallerForDispatch({ id: "key-owner", roles: [] })
    );
    expect(caller.authMethod).toBe("api-key");
    expect(caller.permissions).toEqual([]);
    expect(caller.grants).toBeUndefined();
  });

  it("builds a session caller with no grants of its own", () => {
    const caller = asCaller(sessionCaller({ userId: "u1" }), () =>
      readAccessCallerForDispatch({ id: "u1", roles: ["editor"] })
    );
    expect(caller).toEqual({
      userId: "u1",
      authMethod: "session",
      permissions: [],
      roles: ["editor"],
    });
  });
});
