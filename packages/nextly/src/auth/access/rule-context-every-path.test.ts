/**
 * Every way a rule is asked hands it the one context, with permissions
 * spelled as the role screen spells them.
 *
 * Seven places ask a rule: the one decision, `nextly.access.check` for a session,
 * a visitor and a plugin's person, the key gates on a read and on a write, and
 * the field-rule passes. Each is asked here with a rule that checks the role
 * screen's spelling (`read-posts`) and records what it was handed, so a path
 * still building a context of its own, still handing `posts:read` alone, or
 * dropping the target, fails on that path by name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../authenticated-scope";

const { container } = vi.hoisted(() => ({
  container: { service: undefined as unknown },
}));

vi.mock("../../di/container", () => ({
  container: {
    has: (name: string) =>
      name === "rbacAccessControlService" && container.service !== undefined,
    get: () => container.service,
  },
}));

const GRANTS: GrantedPermission[] = [
  { slug: "read-posts", action: "read", resource: "posts" },
  { slug: "update-posts", action: "update", resource: "posts" },
  { slug: "update-site", action: "update", resource: "site" },
  { slug: "read-cards", action: "read", resource: "cards" },
];

vi.mock("../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../services/lib/permissions")>()),
  isSuperAdmin: vi.fn(async () => false),
  isSuperAdminOrRefuse: vi.fn(async () => false),
  isSuperAdminOrThrow: vi.fn(async () => false),
  hasPermission: vi.fn(async () => true),
  listRoleSlugsForUser: vi.fn(async () => ["editor"]),
  listEffectiveGrants: vi.fn(async () => GRANTS),
  listEffectivePermissions: vi.fn(async () =>
    GRANTS.map(grant => `${grant.resource}:${grant.action}`)
  ),
}));

import { RBACAccessControlService } from "../../domains/auth/services/rbac-access-control-service";
import type { NextlyContext } from "../../direct-api/namespaces/context";
import { createAccessNamespace } from "../../direct-api/namespaces/rbac";
import { makePrincipal } from "../../plugins/principals/principal";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../shared/lib/field-level-registry";
import type { AccessRuleContext } from "../../shared/types/access";
import { apiKeyScope, apiKeyWriteAllowed } from "../authenticated-scope";
import { canReadEntity, readAccessCaller } from "../entity-read-access";

import { userActor } from "./actor";
import { decide } from "./decide";

/**
 * A rule that allows only when the caller holds the permission for what it
 * is asked, in the role screen's spelling, and records each context.
 */
function roleScreenRule() {
  const seen: AccessRuleContext[] = [];
  const rule = (ctx: AccessRuleContext) => {
    seen.push(ctx);
    return ctx.permissions.includes(`${ctx.operation}-${ctx.collection}`);
  };
  return { rule, seen };
}

let rbac: RBACAccessControlService;
/** `nextly.access.check` over the service the rules are registered on. */
const sessionCheck = (args: {
  userId: string;
  operation: "read" | "update";
  resource: string;
}) =>
  createAccessNamespace({
    rbacAccessControlService: rbac,
  } as unknown as NextlyContext).check(args);
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rbac = new RBACAccessControlService();
  container.service = rbac;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  container.service = undefined;
  clearFieldFunctions();
  warn.mockRestore();
});

const keyScope = () => apiKeyScope(GRANTS, ["editor"]);

describe("a collection or Single rule", () => {
  it("is handed the role screen's spelling by the one decision", async () => {
    const { rule, seen } = roleScreenRule();
    const actor = userActor({
      userId: "u1",
      roles: ["editor"],
      permissions: GRANTS,
    });
    const decision = await decide(actor, "read", {
      kind: "collection",
      slug: "posts",
      access: { read: rule },
    });
    expect(decision).toEqual({ allowed: true });
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
  });

  it("is handed the role screen's spelling for a session", async () => {
    const { rule, seen } = roleScreenRule();
    rbac.registerCollectionAccess("posts", { read: rule });
    await expect(
      sessionCheck({ userId: "u1", operation: "read", resource: "posts" })
    ).resolves.toBe(true);
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
    expect(seen[0].user).toEqual({ id: "u1" });
    expect(seen[0].req.user).toEqual({ id: "u1", roles: ["editor"] });
  });

  it("names a Single as a Single", async () => {
    const { rule, seen } = roleScreenRule();
    rbac.registerSingleAccess("site", { update: rule });
    await expect(
      sessionCheck({ userId: "u1", operation: "update", resource: "site" })
    ).resolves.toBe(true);
    expect(seen[0].target).toEqual({ kind: "single", slug: "site" });
  });

  it("is handed the target for a visitor, with no permissions", async () => {
    const { rule, seen } = roleScreenRule();
    rbac.registerCollectionAccess("posts", { read: rule });
    await expect(
      rbac.checkAnonymousCodeAccess({ operation: "read", resource: "posts" })
    ).resolves.toBe(false);
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
    expect([...seen[0].permissions]).toEqual([]);
    expect(seen[0].user).toBeNull();
  });

  it("is handed the target and the person for a plugin's person", async () => {
    const member = makePrincipal("members:member", "m1", {});
    const seen: AccessRuleContext[] = [];
    rbac.registerCollectionAccess("posts", {
      read: ctx => {
        seen.push(ctx);
        return ctx.principal?.kind === "members:member";
      },
    });
    await expect(
      rbac.checkPrincipalCodeAccess({
        operation: "read",
        resource: "posts",
        principal: member,
      })
    ).resolves.toBe(true);
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
    expect(seen[0].principal).toBe(member);
  });

  it("is handed the role screen's spelling for a key's read", async () => {
    const { rule, seen } = roleScreenRule();
    rbac.registerCollectionAccess("posts", { read: rule });
    const caller = readAccessCaller({
      user: { id: "owner-1", roles: ["editor"] },
      authenticatedScope: keyScope(),
    });
    await expect(canReadEntity("posts", caller)).resolves.toBe(true);
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
    expect(seen[0].user).toEqual({ id: "owner-1" });
  });

  it("is handed the role screen's spelling for a key's write", async () => {
    const { rule, seen } = roleScreenRule();
    rbac.registerCollectionAccess("posts", { update: rule });
    await expect(
      apiKeyWriteAllowed(keyScope(), "update", "posts", { id: "owner-1" }, rbac)
    ).resolves.toBe(true);
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
  });

  it("no longer allows on the earlier spelling on a session, and warns nothing", async () => {
    // The session holds `read-posts`; the rule names it the way rules were
    // once handed it, which is no longer in the list.
    const rule = ({ permissions }: AccessRuleContext) =>
      permissions.includes("posts:read");
    rbac.registerCollectionAccess("posts", { read: rule });
    await expect(
      sessionCheck({ userId: "u1", operation: "read", resource: "posts" })
    ).resolves.toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a field rule", () => {
  /** Registers `rule` as the read and update rule of `posts.secret`. */
  function gate(
    rule: (ctx: AccessRuleContext) => boolean,
    kind: "collection" | "fieldGroup" = "collection",
    slug = "posts"
  ) {
    registerFieldFunctions(kind, slug, [
      { name: "title" },
      { name: "secret", access: { read: rule, update: rule } },
    ]);
  }

  it("is handed the role screen's spelling and the entry on a session's read", async () => {
    const { rule, seen } = roleScreenRule();
    gate(rule);
    const entry: Record<string, unknown> = {
      id: "e1",
      title: "a",
      secret: "s",
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
      user: { id: "u1", email: "u1@example.test" },
    });
    expect(entry.secret).toBe("s");
    expect(seen[0].operation).toBe("read");
    expect(seen[0].target).toEqual({ kind: "collection", slug: "posts" });
    expect(seen[0].collection).toBe("posts");
    expect(seen[0].id).toBe("e1");
    expect(seen[0].user).toEqual({ id: "u1", email: "u1@example.test" });
    expect(seen[0].req.user).toEqual({ id: "u1", email: "u1@example.test" });
  });

  it("is handed the role screen's spelling for a key's write", async () => {
    const { rule, seen } = roleScreenRule();
    gate(rule);
    const data: Record<string, unknown> = { title: "a", secret: "s" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "owner-1" },
      authenticatedScope: keyScope(),
    });
    expect(data.secret).toBe("s");
    expect(seen[0].operation).toBe("update");
  });

  it("names a component as a component", async () => {
    const seen: AccessRuleContext[] = [];
    gate(
      ctx => {
        seen.push(ctx);
        return ctx.permissions.includes("read-cards");
      },
      "fieldGroup",
      "cards"
    );
    const entry: Record<string, unknown> = { id: "c1", secret: "s" };
    await applyFieldReadAccess({
      kind: "fieldGroup",
      slug: "cards",
      entry,
      user: { id: "u1" },
    });
    expect(entry.secret).toBe("s");
    expect(seen[0].target).toEqual({ kind: "component", slug: "cards" });
  });

  it("hands an anonymous reader no user and no permissions", async () => {
    const seen: AccessRuleContext[] = [];
    gate(ctx => {
      seen.push(ctx);
      return true;
    });
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry: { id: "e1", secret: "s" },
    });
    expect(seen[0].user).toBeNull();
    expect(seen[0].req.user).toBeUndefined();
    expect([...seen[0].permissions]).toEqual([]);
  });
});
