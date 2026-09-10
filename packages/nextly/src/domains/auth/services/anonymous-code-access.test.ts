/**
 * A code-defined access rule is consulted for a caller with no session.
 *
 * `checkAccess` cannot answer this question. It returns `false` at `!userId`
 * before it reads the rule at all, because everything past that line resolves
 * roles and permissions from a user id. Its only caller in the collection
 * access service was gated on a truthy `user` for the same reason.
 *
 * The consequence was that `access: { create: false }` on a collection was
 * accepted at boot, recorded in the registry, and never consulted for the one
 * caller it most obviously describes: an anonymous visitor posting to a public
 * route. Only the STORED rules ran, which live elsewhere and are usually empty,
 * so the declaration was inert while looking deliberate.
 *
 * These pin the three answers the evaluator owes: deny, allow, and "no opinion"
 * so the stored rules still decide.
 */

import { describe, expect, it } from "vitest";

import { RBACAccessControlService } from "./rbac-access-control-service";

function service() {
  return new RBACAccessControlService();
}

describe("code-defined access for a caller with no session", () => {
  it("denies when the rule is a literal false", () => {
    // The case from the report: a host closing public creation.
    return expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "submissions",
        codeAccess: { create: false },
      })
    ).resolves.toBe(false);
  });

  it("allows when the rule is a literal true", () => {
    // The control. A check that denied everything would satisfy the assertion
    // above while closing every public form on every install.
    return expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "submissions",
        codeAccess: { create: true },
      })
    ).resolves.toBe(true);
  });

  it("runs a function rule against a real anonymous context", async () => {
    // `user` is null and both lists are empty, which is the truth about this
    // caller rather than a stand-in. A rule reading `roles` must not see roles.
    let seen: unknown;
    const allowed = await service().checkAnonymousCodeAccess({
      operation: "read",
      resource: "forms",
      codeAccess: {
        read: ctx => {
          seen = ctx;
          return !!ctx.user;
        },
      },
    });

    expect(allowed).toBe(false);
    expect(seen).toMatchObject({
      user: null,
      roles: [],
      permissions: [],
      operation: "read",
      collection: "forms",
    });
  });

  it("answers undefined when no rule governs the operation", async () => {
    // Not `false`. "No opinion" leaves the stored rules to decide, and
    // returning a verdict here would close every operation a collection did
    // not happen to name.
    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: { read: true },
      })
    ).resolves.toBeUndefined();

    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: {},
      })
    ).resolves.toBeUndefined();
  });

  it("denies when the rule throws, rather than falling through", async () => {
    // Fail-secure, matching the authenticated path. A rule that threw did not
    // allow anything, and answering `undefined` here would hand the decision to
    // stored rules that usually allow.
    await expect(
      service().checkAnonymousCodeAccess({
        operation: "create",
        resource: "forms",
        codeAccess: {
          create: () => {
            throw new Error("rule exploded");
          },
        },
      })
    ).resolves.toBe(false);
  });
});
