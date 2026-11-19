/**
 * The module-level `nextly.users` facade offers every method the users
 * namespace has, the identity methods among them.
 *
 * The facade lists its delegates by name, so a method the namespace gains is
 * missing from it until someone writes the delegate. `satisfies
 * UsersNamespace` makes a missing one fail to type-check; this makes it fail
 * at run time too.
 */
import { describe, expect, it } from "vitest";

import type { NextlyContext } from "../namespaces/context";
import { createUsersNamespace } from "../namespaces/users";
import { nextly } from "../nextly";

describe("the nextly.users facade", () => {
  it("delegates every method of the users namespace", () => {
    const namespace = createUsersNamespace({} as NextlyContext);
    expect(Object.keys(nextly.users).sort()).toEqual(
      Object.keys(namespace).sort()
    );
  });

  it("offers the identity listing and unlink", () => {
    expect(typeof nextly.users.listIdentities).toBe("function");
    expect(typeof nextly.users.unlinkIdentity).toBe("function");
  });
});
