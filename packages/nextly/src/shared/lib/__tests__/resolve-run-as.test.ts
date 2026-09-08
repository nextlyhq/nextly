/**
 * Who a job runs as — and what happens when that person is gone.
 *
 * This is the access boundary of the whole domain. Every other failure in a job
 * queue is a job that did not run; this one is a job that runs with the wrong
 * authority, which is a different class of problem.
 *
 * @module shared/lib/__tests__/resolve-run-as.test
 */
import { describe, expect, it } from "vitest";

import { buildUserContext } from "../../../auth/user-context";
import { resolveRunAs, type RunAsDeps } from "../resolve-run-as";

const deps = (over: Partial<RunAsDeps> = {}): RunAsDeps => ({
  findUser: async () => ({ id: "u1", isActive: true }),
  listRoleSlugs: async () => [],
  ...over,
});

describe("resolveRunAs", () => {
  it("distinguishes 'no identity was asked for' from 'the identity is gone'", async () => {
    // THE test of this module. An implementation that returns "no user" for
    // both cases passes every other assertion here and silently promotes a
    // deleted author's job into an unauthenticated run — which applies no
    // field rules at all.
    const gone = deps({ findUser: async () => null });

    await expect(resolveRunAs(gone, null)).resolves.toEqual({
      ok: true,
      user: null,
    });
    await expect(resolveRunAs(gone, "deleted-user")).resolves.toEqual({
      ok: false,
      reason: "JOB_IDENTITY_UNRESOLVABLE",
    });
  });

  it("REFUSES a user who no longer resolves", async () => {
    await expect(
      resolveRunAs(deps({ findUser: async () => null }), "ghost")
    ).resolves.toMatchObject({ ok: false });
  });

  it("REFUSES a user who has been deactivated", async () => {
    // A deactivated account cannot sign in. A job continuing to act as one
    // would be a way to keep using an authority that was deliberately withdrawn.
    await expect(
      resolveRunAs(
        deps({ findUser: async () => ({ id: "u1", isActive: false }) }),
        "u1"
      )
    ).resolves.toEqual({ ok: false, reason: "JOB_IDENTITY_DISABLED" });
  });

  it("carries the full role set, not just the id", async () => {
    // Verified against UserContext (domains/singles/types.ts:21), whose own
    // docblock says the route path forwards decoded roles precisely so stored
    // role-based rules can match. An id-only context makes a role-gated
    // collection match NOTHING and report itself complete — fail-closed, but
    // SILENTLY, and "nothing to do" is indistinguishable from a correct answer.
    const result = await resolveRunAs(
      deps({ listRoleSlugs: async () => ["editor", "legal"] }),
      "u1"
    );
    expect(result).toEqual({
      ok: true,
      user: buildUserContext({
        id: "u1",
        name: undefined,
        email: undefined,
        roles: ["editor", "legal"],
      }),
    });
  });

  it("resolves a user with no roles as ok, with an empty role set", async () => {
    // The control for the case above: an implementation that refused whenever
    // the role list was empty would satisfy it while breaking every job queued
    // by a user who holds permissions directly rather than through a role.
    await expect(resolveRunAs(deps(), "u1")).resolves.toEqual({
      ok: true,
      user: buildUserContext({
        id: "u1",
        name: undefined,
        email: undefined,
        roles: [],
      }),
    });
  });

  it("never reports a system principal as the resolved identity", async () => {
    // Guards the failure mode the design forbids by name: falling back to a
    // privileged principal when the stored one cannot be found.
    const result = await resolveRunAs(
      deps({ findUser: async () => null }),
      "ghost"
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/system|admin|root/i);
  });

  it("carries every attribute the user has, not just id and roles", async () => {
    // Access predicates in this repository inspect `user.email`. A context
    // missing it evaluates such a rule against `undefined` — which denies
    // authorized work, or for a negative predicate like `email !== blocked`
    // GRANTS work it should refuse. Either way the job is not running with the
    // named person's authority, which is the whole point of resolving one.
    const result = await resolveRunAs(
      deps({
        findUser: async () => ({
          id: "u1",
          isActive: true,
          name: "Ada",
          email: "ada@example.com",
        }),
        listRoleSlugs: async () => ["editor"],
      }),
      "u1"
    );
    expect(result).toEqual({
      ok: true,
      user: buildUserContext({
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        roles: ["editor"],
      }),
    });
  });

  it("derives the single-role alias a rule written against `user.role` reads", async () => {
    // The specific attribute a hand-built context dropped. `buildUserContext`
    // sets `role` from `roles[0]` because rules and field-level callbacks
    // written against a single-role model read it; a job whose context omits
    // it evaluates `user.role === "editor"` against `undefined` and denies
    // authorized work, while `user.role !== "suspended"` GRANTS work it should
    // refuse. Asserted on its own so a change that keeps the object shape but
    // stops deriving the alias still fails.
    const result = await resolveRunAs(
      deps({ listRoleSlugs: async () => ["editor", "legal"] }),
      "u1"
    );
    expect((result as { user: { role?: string } }).user.role).toBe("editor");
  });

  it("builds the same context an authenticated request would for that person", async () => {
    // The property the three cases above are each an instance of. A
    // `UserContext` is an open record an access rule is evaluated against, so
    // a second builder that merely agrees today authorizes differently the
    // moment the canonical one gains a field. Comparing against
    // `buildUserContext` itself is what makes this test notice that, rather
    // than pinning the shape this module happens to produce.
    const identity = {
      id: "u1",
      isActive: true,
      name: "Ada",
      email: "ada@example.com",
    };
    const result = await resolveRunAs(
      deps({
        findUser: async () => identity,
        listRoleSlugs: async () => ["editor", "legal"],
      }),
      "u1"
    );
    expect((result as { user: unknown }).user).toEqual(
      buildUserContext({
        id: identity.id,
        name: identity.name,
        email: identity.email,
        roles: ["editor", "legal"],
      })
    );
  });
});
