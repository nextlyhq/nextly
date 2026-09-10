import { describe, expect, it } from "vitest";

import { resolveServiceOpts } from "./service-opts";

describe("resolveServiceOpts", () => {
  it("defaults to system when no as and no user", () => {
    expect(resolveServiceOpts({})).toEqual({ overrideAccess: true });
  });

  it("as:'system' → overrideAccess, no user", () => {
    expect(resolveServiceOpts({ as: "system" })).toEqual({
      overrideAccess: true,
    });
  });

  it("as:'user' with a user → enforce, RequestContext.user shape", () => {
    expect(
      resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
      })
    ).toEqual({
      overrideAccess: false,
      user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
    });
  });

  it("a user without explicit as is treated as as:'user'", () => {
    expect(
      resolveServiceOpts({ user: { id: "u1", email: "u@e.com" } })
    ).toMatchObject({
      overrideAccess: false,
      user: { id: "u1" },
    });
  });

  /**
   * The mode a public plugin route needs, and the one that did not exist.
   *
   * `public: true` on a route waives the ROUTE's authentication. It says
   * nothing about the collections behind it, and before this mode a route
   * serving an anonymous visitor had no way to say so: `user` throws without a
   * user, and every other spelling set `overrideAccess`. So a public route
   * could only read by bypassing whatever the host had configured.
   */
  it("as:'public' enforces access with no user at all", () => {
    expect(resolveServiceOpts({ as: "public" })).toEqual({
      overrideAccess: false,
    });
  });

  it("as:'public' does not become a user when one is in scope", () => {
    // A route may hold a `user` for other reasons while deliberately reading as
    // the public. Letting the presence of one silently upgrade the mode would
    // make the elevation depend on an unrelated field.
    expect(
      resolveServiceOpts({
        as: "public",
        user: { id: "u1", email: "u@e.com", name: "U" },
      })
    ).toEqual({ overrideAccess: false });
  });

  it("as:'public' is the ONLY mode that enforces without a user", () => {
    // The control that makes the two above mean something. If any other
    // spelling also enforced, a route could reach the right behaviour by
    // accident and this mode would not need to exist.
    const enforcingWithoutUser = (
      [{}, { as: "system" as const }, { as: "public" as const }] as const
    ).filter(opts => resolveServiceOpts(opts).overrideAccess === false);

    expect(enforcingWithoutUser).toEqual([{ as: "public" }]);
  });

  it("as:'user' without a user throws", () => {
    expect(() => resolveServiceOpts({ as: "user" })).toThrow();
  });
});

/**
 * `user` names the key's OWNER, so a facade that receives it alone resolves the
 * owner's roles and a viewer-scoped key minted by a super-admin is judged as a
 * super-admin. This is the hop that either carries the key's own grants or
 * drops them.
 */
describe("resolveServiceOpts — the caller's own scope", () => {
  const KEY_SCOPE = {
    actorType: "apiKey" as const,
    permissions: ["read-posts"],
  };

  it("forwards an API key's grants alongside the account", () => {
    expect(
      resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
        authenticatedScope: KEY_SCOPE,
      })
    ).toEqual({
      overrideAccess: false,
      user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
      authenticatedScope: KEY_SCOPE,
    });
  });

  it("omits the key entirely for a session caller, who has no key scope", () => {
    // The control. `toEqual` ignores an explicitly-undefined property, so
    // asserting the scope is absent has to be done on the KEYS — otherwise a
    // hop that always wrote `authenticatedScope: undefined` would satisfy it,
    // and so would one that wrote nothing.
    const resolved = resolveServiceOpts({
      as: "user",
      user: { id: "u1", email: "u@e.com", name: "U" },
    });
    // On the KEY rather than the value: `toEqual` ignores an
    // explicitly-undefined property, so comparing against `undefined` would be
    // satisfied by a hop that always wrote `authenticatedScope: undefined` and
    // by one that wrote nothing, which are different behaviours downstream.
    //
    // Asserting this one key rather than the whole key set, because the set is
    // shared: `context` arrived here from another change and broke an
    // exact-set assertion that was never about it.
    expect(Object.keys(resolved)).not.toContain("authenticatedScope");
    expect(resolved.overrideAccess).toBe(false);
  });

  it("drops a scope under system elevation, which bypasses the check it feeds", () => {
    // A scope only means anything to an access check, and `as:'system'` skips
    // it. Carrying one here would imply a narrowing that is not applied.
    expect(
      resolveServiceOpts({ as: "system", authenticatedScope: KEY_SCOPE })
    ).toEqual({ overrideAccess: true });
  });
});
