/**
 * The one decision for a call made as a plugin-defined person, and what every
 * other caller's rule is told about persons.
 *
 * A person is admitted only by a code-defined rule: one that names them, or
 * one set to `true`. Where an anonymous caller with no rule falls through to
 * the public default, a person is refused, and no staff path applies to one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../services/lib/permissions", () => ({
  hasPermission: vi.fn(async () => true),
  isSuperAdmin: vi.fn(async () => true),
  listEffectiveGrants: vi.fn(async () => [
    { slug: "read-posts", action: "read", resource: "posts" },
  ]),
  listRoleSlugsForUser: vi.fn(async () => ["super-admin"]),
}));

import { hasPermission, isSuperAdmin } from "../../../services/lib/permissions";
import { makePrincipal } from "../../../plugins/principals/principal";
import type { Principal } from "../../../plugins/principals/types";
import type { AccessControlContext } from "../../../shared/types/access";

import { RBACAccessControlService } from "./rbac-access-control-service";

const verified = makePrincipal("accounts:account", "acc_1", {
  verified: true,
});
const unverified = makePrincipal("accounts:account", "acc_2", {
  verified: false,
});

function ask(
  rule: Parameters<
    RBACAccessControlService["checkPrincipalCodeAccess"]
  >[0]["codeAccess"],
  principal: Principal = verified,
  operation: "read" | "publish" = "read"
): Promise<boolean> {
  return new RBACAccessControlService().checkPrincipalCodeAccess({
    operation,
    resource: "orders",
    principal,
    codeAccess: rule,
  });
}

describe("a call made as a plugin-defined person", () => {
  it("is admitted by a rule that names the kind", async () => {
    await expect(
      ask({ read: ({ principal }) => principal?.kind === "accounts:account" })
    ).resolves.toBe(true);
  });

  it("is judged on its declared attributes", async () => {
    const rule = {
      read: ({ principal }: AccessControlContext) =>
        principal?.attributes.verified === true,
    };
    await expect(ask(rule, verified)).resolves.toBe(true);
    await expect(ask(rule, unverified)).resolves.toBe(false);
  });

  it("hands the rule the person, with no user, no roles and no permissions", async () => {
    let seen: AccessControlContext | undefined;
    await ask({
      read: ctx => {
        seen = ctx;
        return true;
      },
    });
    expect(seen).toEqual({
      user: null,
      req: { user: undefined },
      roles: [],
      permissions: [],
      principal: verified,
      operation: "read",
      target: { kind: "collection", slug: "orders" },
      collection: "orders",
      locales: [],
    });
  });

  it("is refused by a rule written for any signed-in staff user", async () => {
    await expect(ask({ read: ({ user }) => !!user })).resolves.toBe(false);
  });

  it("is refused where no rule governs the operation", async () => {
    // Where an anonymous caller gets "no opinion" and its public default.
    const service = new RBACAccessControlService();
    await expect(
      service.checkAnonymousCodeAccess({
        operation: "read",
        resource: "orders",
        codeAccess: {},
      })
    ).resolves.toBeUndefined();
    await expect(ask({})).resolves.toBe(false);
  });

  it("is admitted by a rule set to true, as everyone is", async () => {
    await expect(ask({ read: true })).resolves.toBe(true);
  });

  it("is refused by a rule that throws", async () => {
    await expect(
      ask({
        read: () => {
          throw new Error("rule failed");
        },
      })
    ).resolves.toBe(false);
  });

  it("is never allowed to publish, whatever the rule says", async () => {
    await expect(ask({ publish: true }, verified, "publish")).resolves.toBe(
      false
    );
  });

  it("never reaches the super-admin bypass or database permissions", async () => {
    // Both are mocked to say yes, so a path that consulted either would admit.
    vi.mocked(isSuperAdmin).mockClear();
    vi.mocked(hasPermission).mockClear();
    await expect(ask({})).resolves.toBe(false);
    expect(isSuperAdmin).not.toHaveBeenCalled();
    expect(hasPermission).not.toHaveBeenCalled();
  });
});

describe("a call made by anyone else", () => {
  it("tells a staff user's rule there is no person", async () => {
    let seen: AccessControlContext | undefined;
    vi.mocked(isSuperAdmin).mockResolvedValueOnce(false);
    await new RBACAccessControlService().checkAccess({
      userId: "u1",
      operation: "read",
      resource: "orders",
      codeAccess: {
        read: ctx => {
          seen = ctx;
          return true;
        },
      },
    });
    expect(seen?.principal).toBeNull();
    expect(seen?.user).toEqual({ id: "u1" });
  });

  it("tells an anonymous caller's rule there is no person", async () => {
    let seen: AccessControlContext | undefined;
    await new RBACAccessControlService().checkAnonymousCodeAccess({
      operation: "read",
      resource: "orders",
      codeAccess: {
        read: ctx => {
          seen = ctx;
          return true;
        },
      },
    });
    expect(seen?.principal).toBeNull();
  });
});
