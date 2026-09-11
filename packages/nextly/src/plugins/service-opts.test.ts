import { describe, expect, it } from "vitest";

import {
  resolveServiceOpts as resolve,
  type ServiceOpts,
} from "./service-opts";

/**
 * The roles the resolver answers with, by user id. A user the table does not
 * name holds none, which is what a fresh account looks like.
 */
const ROLES: Record<string, string[]> = { editor1: ["editor", "viewer"] };
const deps = { listRoleSlugs: async (userId: string) => ROLES[userId] ?? [] };
const resolveServiceOpts = (opts: ServiceOpts) => resolve(opts, deps);

describe("resolveServiceOpts", () => {
  it("defaults to system when no as and no user", async () => {
    expect(await resolveServiceOpts({})).toEqual({ overrideAccess: true });
  });

  it("as:'system' → overrideAccess, no user", async () => {
    expect(await resolveServiceOpts({ as: "system" })).toEqual({
      overrideAccess: true,
    });
  });

  it("as:'user' with a user → enforce, RequestContext.user shape", async () => {
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
      })
    ).toEqual({
      overrideAccess: false,
      user: {
        id: "u1",
        email: "u@e.com",
        name: "U",
        role: "",
        roles: [],
        permissions: [],
      },
    });
  });

  it("resolves the caller's roles, so a rule reading user.role sees them", async () => {
    // Built with `role: ""` before, so `req.user?.role === "editor"` refused
    // every caller on this path while the same caller's own request passed.
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "editor1", email: "e@e.com", name: "E" },
      })
    ).toEqual({
      overrideAccess: false,
      user: {
        id: "editor1",
        email: "e@e.com",
        name: "E",
        role: "editor",
        roles: ["editor", "viewer"],
        permissions: [],
      },
    });
  });

  it("a user without explicit as is treated as as:'user'", async () => {
    expect(
      await resolveServiceOpts({ user: { id: "u1", email: "u@e.com" } })
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
  it("as:'public' enforces access with no user at all", async () => {
    expect(await resolveServiceOpts({ as: "public" })).toEqual({
      overrideAccess: false,
    });
  });

  it("as:'public' does not become a user when one is in scope", async () => {
    // A route may hold a `user` for other reasons while deliberately reading as
    // the public. Letting the presence of one silently upgrade the mode would
    // make the elevation depend on an unrelated field.
    expect(
      await resolveServiceOpts({
        as: "public",
        user: { id: "u1", email: "u@e.com", name: "U" },
      })
    ).toEqual({ overrideAccess: false });
  });

  it("as:'public' is the ONLY mode that enforces without a user", async () => {
    // The control that makes the two above mean something. If any other
    // spelling also enforced, a route could reach the right behaviour by
    // accident and this mode would not need to exist.
    const spellings = [
      {},
      { as: "system" as const },
      { as: "public" as const },
    ] as const;
    const resolved = await Promise.all(
      spellings.map(opts => resolveServiceOpts(opts))
    );
    const enforcingWithoutUser = spellings.filter(
      (_, index) => resolved[index].overrideAccess === false
    );

    expect(enforcingWithoutUser).toEqual([{ as: "public" }]);
  });

  it("as:'user' without a user throws", async () => {
    await expect(resolveServiceOpts({ as: "user" })).rejects.toThrow();
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

  it("forwards an API key's grants alongside the account", async () => {
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
        authenticatedScope: KEY_SCOPE,
      })
    ).toEqual({
      overrideAccess: false,
      user: {
        id: "u1",
        email: "u@e.com",
        name: "U",
        role: "",
        roles: [],
        permissions: [],
      },
      authenticatedScope: KEY_SCOPE,
    });
  });

  it("judges a key on ITS roles, never its owner's, when the scope carries them", async () => {
    // The owner holds editor and viewer; the key was minted on viewer alone.
    // A stored role rule reads `user.roles` with no scope in front of it, so
    // the owner's roles here would let this key satisfy an editors-only rule
    // over the plugin path that the REST path refuses it.
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "editor1", email: "e@e.com", name: "E" },
        authenticatedScope: { ...KEY_SCOPE, roles: ["viewer"] },
      })
    ).toMatchObject({
      overrideAccess: false,
      user: { id: "editor1", role: "viewer", roles: ["viewer"] },
    });
  });

  it("grants a key the role it was minted on even when its owner lacks it", async () => {
    // The other direction, and the one that separates this from a blanket
    // refusal: u1 holds no roles at all, the key holds editor.
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
        authenticatedScope: { ...KEY_SCOPE, roles: ["editor"] },
      })
    ).toMatchObject({ user: { role: "editor", roles: ["editor"] } });
  });

  it("a key whose role is gone holds no roles here either", async () => {
    // `[]` is what authentication resolves for a role-based key whose role
    // was deleted. It is a list, not an absence: falling back to the owner's
    // roles on an empty one would revive the deleted role as the owner.
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "editor1", email: "e@e.com", name: "E" },
        authenticatedScope: { ...KEY_SCOPE, roles: [] },
      })
    ).toMatchObject({ user: { role: "", roles: [] } });
  });

  it("falls back to the account's roles for a scope that carries none", async () => {
    // `roles` is omitted, not emptied, when authentication resolved none;
    // `apiKeyWriteAllowed` reads `scope.roles ?? user.roles` for the same
    // reason, and this is the `user.roles` it falls back to.
    expect(
      await resolveServiceOpts({
        as: "user",
        user: { id: "editor1", email: "e@e.com", name: "E" },
        authenticatedScope: KEY_SCOPE,
      })
    ).toMatchObject({ user: { role: "editor", roles: ["editor", "viewer"] } });
  });

  it("hands the rule a copy, not the scope's frozen list", async () => {
    const scope = Object.freeze({
      ...KEY_SCOPE,
      roles: Object.freeze(["viewer"]) as readonly string[],
    });
    const resolved = await resolveServiceOpts({
      as: "user",
      user: { id: "editor1", email: "e@e.com", name: "E" },
      authenticatedScope: scope,
    });
    expect(resolved.user?.roles).toEqual(["viewer"]);
    expect(Object.isFrozen(resolved.user?.roles)).toBe(false);
  });

  it("omits the key entirely for a session caller, who has no key scope", async () => {
    // The control. `toEqual` ignores an explicitly-undefined property, so
    // asserting the scope is absent has to be done on the KEYS — otherwise a
    // hop that always wrote `authenticatedScope: undefined` would satisfy it,
    // and so would one that wrote nothing.
    const resolved = await resolveServiceOpts({
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

  it("drops a scope under system elevation, which bypasses the check it feeds", async () => {
    // A scope only means anything to an access check, and `as:'system'` skips
    // it. Carrying one here would imply a narrowing that is not applied.
    expect(
      await resolveServiceOpts({ as: "system", authenticatedScope: KEY_SCOPE })
    ).toEqual({ overrideAccess: true });
  });
});
