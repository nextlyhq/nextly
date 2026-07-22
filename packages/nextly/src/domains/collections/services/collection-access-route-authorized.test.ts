/**
 * Proves the route-write access decoupling: a route-authorized write skips only
 * the redundant RBAC gate (the middleware already ran it) but STILL evaluates
 * the stored collection access rules, while `overrideAccess` remains a full
 * system bypass and super-admin bypasses the stored rules on every transport.
 *
 * Before the fix, route writes forced `overrideAccess: true`, which returned
 * early and never evaluated the stored rules — the bug these tests guard.
 */

import { describe, it, expect, vi } from "vitest";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockDb,
  createMockAdapter,
  silentLogger,
  createMockCollectionService,
  createMockAccessControlService,
} from "../__tests__/collection-test-helpers";

function buildAccessService() {
  const accessControlService = createMockAccessControlService();
  const rbac = {
    checkAccess: vi.fn().mockResolvedValue(true),
    // No code-defined access by default: a scoped API key is judged on its
    // permission grant alone unless a test registers a rule.
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
  };
  const collectionService = createMockCollectionService();
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    collectionService as never,
    accessControlService as never,
    rbac as never
  );
  return { service, accessControlService, rbac };
}

// A caller with no super-admin role. Its `roles` deliberately omit super-admin
// even though a real super-admin could OWN a scoped API key with these roles —
// the bypass must key off this authorized set, not the account.
const user = { id: "user-1", roles: ["editor"] };
const superAdminUser = { id: "user-1", roles: ["super-admin"] };
// The Direct API collection namespace forwards only `{ id, role }` (singular),
// so the bypass must also honor a super-admin arriving via the singular slug.
const singularRoleSuperAdmin = { id: "user-1", role: "super-admin" };

describe("checkCollectionAccess — route-authorized decoupling", () => {
  it("still evaluates stored rules when routeAuthorized (denies via stored rule)", async () => {
    const { service, accessControlService, rbac } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "not the owner",
    });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      user,
      "doc-1",
      { id: "doc-1", createdBy: "someone-else" },
      false, // overrideAccess
      true // routeAuthorized
    );

    // The stored rule was evaluated and denied — the exact path route writes
    // used to skip.
    expect(result?.statusCode).toBe(403);
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
    // The redundant RBAC gate is skipped when routeAuthorized.
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("allows when routeAuthorized and the stored rule allows, skipping RBAC", async () => {
    const { service, accessControlService, rbac } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      user,
      "doc-1",
      { id: "doc-1" },
      false,
      true
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("runs the RBAC gate when NOT routeAuthorized (Direct API)", async () => {
    const { service, rbac } = buildAccessService();
    rbac.checkAccess.mockResolvedValue(false);

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      user,
      "doc-1",
      { id: "doc-1" },
      false,
      false // routeAuthorized
    );

    expect(result?.statusCode).toBe(403);
    expect(rbac.checkAccess).toHaveBeenCalledTimes(1);
  });

  it("bypasses everything when overrideAccess is true (system write)", async () => {
    const { service, accessControlService, rbac } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: false });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      user,
      "doc-1",
      { id: "doc-1" },
      true, // overrideAccess
      true
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("lets a super-admin (by authorized role) bypass stored rules on the route path", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "not the owner",
    });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      superAdminUser,
      "doc-1",
      { id: "doc-1", createdBy: "someone-else" },
      false,
      true
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("lets a super-admin bypass stored rules on the Direct API path too", async () => {
    const { service, accessControlService, rbac } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "not the owner",
    });

    // routeAuthorized: false = Direct API. A super-admin bypasses on every
    // transport, short-circuiting before the RBAC gate.
    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      superAdminUser,
      "doc-1",
      { id: "doc-1", createdBy: "someone-else" },
      false,
      false // routeAuthorized (Direct API)
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("lets a super-admin identified by the singular `role` bypass stored rules", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "not the owner",
    });

    // A Direct API caller carrying only `{ id, role: "super-admin" }` (no
    // `roles` array) must still bypass — the changeset promises the bypass on
    // every transport, and this surface only forwards the singular slug.
    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      singularRoleSuperAdmin,
      "doc-1",
      { id: "doc-1", createdBy: "someone-else" },
      false,
      false // routeAuthorized (Direct API)
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("fails closed when routeAuthorized is set without an authenticated user", async () => {
    const { service, accessControlService, rbac } = buildAccessService();
    // A rule-less collection would otherwise fall through to the public default.
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      undefined, // no user
      "doc-1",
      { id: "doc-1" },
      false, // overrideAccess
      true // routeAuthorized
    );

    // A bare routeAuthorized flag (e.g. a direct bulkUpdateByQuery caller) must
    // not skip the RBAC gate and reach the stored-rule public default.
    expect(result?.statusCode).toBe(403);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("does NOT grant the super-admin bypass to a scoped context (no super-admin role)", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "not the owner",
    });

    // `user` here has roles ["editor"] — even if this account happens to own a
    // super-admin key elsewhere, the authorized role set has no super-admin, so
    // the stored rules must still be evaluated and can deny. Guards the API-key
    // owner escalation.
    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      user,
      "doc-1",
      { id: "doc-1", createdBy: "someone-else" },
      false,
      true
    );

    expect(result?.statusCode).toBe(403);
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
  });
});

describe("CollectionAccessService.isSuperAdmin", () => {
  it("is true for the plural authorized role set including super-admin", () => {
    const { service } = buildAccessService();
    expect(service.isSuperAdmin(superAdminUser)).toBe(true);
  });

  it("is true for the singular super-admin role (Direct API shape)", () => {
    const { service } = buildAccessService();
    expect(service.isSuperAdmin(singularRoleSuperAdmin)).toBe(true);
  });

  it("is false for a scoped context without the super-admin role", () => {
    const { service } = buildAccessService();
    // The transaction owner-only safety nets rely on this being scope-keyed:
    // an editor (even one whose account owns a super-admin key elsewhere) must
    // not skip the owner check.
    expect(service.isSuperAdmin(user)).toBe(false);
    expect(service.isSuperAdmin(undefined)).toBe(false);
  });
});

describe("getAccessRules normalizes collection owner fields", () => {
  it("rewrites the createdBy/created_by alias to the system column, leaving custom fields", () => {
    const { service } = buildAccessService();
    const rules = service.getAccessRules({
      accessRules: {
        read: { type: "owner-only", ownerField: "createdBy" },
        update: { type: "owner-only", ownerField: "created_by" },
        delete: { type: "owner-only", ownerField: "authorId" },
        create: { type: "authenticated" },
      },
    });
    // Both spellings of the reserved owner name resolve to the stamped column.
    expect(rules?.read?.ownerField).toBe("created_by");
    expect(rules?.update?.ownerField).toBe("created_by");
    // A genuine custom owner field is left untouched.
    expect(rules?.delete?.ownerField).toBe("authorId");
    expect(rules?.create?.type).toBe("authenticated");
  });

  it("leaves a rule-less owner-only rule alone (default resolved downstream)", () => {
    const { service } = buildAccessService();
    const rules = service.getAccessRules({
      accessRules: { read: { type: "owner-only" } },
    });
    expect(rules?.read?.ownerField).toBeUndefined();
  });
});

describe("checkCollectionAccess — scoped API key", () => {
  // The publish/unpublish transition gate runs NOT route-authorized (the route
  // only attested `update`). For a scoped API key it must judge the key's OWN
  // stamped grants, never the key owner's RBAC — otherwise an update-only key
  // owned by a publisher could publish.
  const apiKeyOwner = { id: "publisher-1", roles: ["editor"] };

  it("denies a publish the key is not scoped for, even when the owner's RBAC allows", async () => {
    const { service, rbac } = buildAccessService();
    // The OWNER can publish...
    rbac.checkAccess.mockResolvedValue(true);

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      apiKeyOwner,
      "doc-1",
      { id: "doc-1" },
      false, // overrideAccess
      false, // routeAuthorized (transition check)
      // ...but the KEY is scoped for update only.
      { actorType: "apiKey", permissions: ["update-posts"] }
    );

    expect(result?.statusCode).toBe(403);
    // The owner's RBAC is never consulted for a scoped key.
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("does not let a super-admin-owned key bypass its scope for publish", async () => {
    const { service } = buildAccessService();
    // The key's resolved role set carries super-admin (from its owner), but the
    // session super-admin bypass must NOT apply to a scoped key — otherwise an
    // update-only key issued by an admin could publish.
    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      { id: "admin-1", roles: ["super-admin"] },
      "doc-1",
      { id: "doc-1" },
      false,
      false,
      { actorType: "apiKey", permissions: ["update-posts"] }
    );

    expect(result?.statusCode).toBe(403);
  });

  it("still enforces a code-defined access rule for a scoped key that holds the grant", async () => {
    const { service, rbac } = buildAccessService();
    // The key HAS publish-posts, but the collection's code-defined
    // `access.publish` denies. The grant must not bypass that rule (which
    // `rbac.checkAccess` — the path the API-key branch replaces — would have run).
    rbac.getRegisteredAccess.mockReturnValue({ publish: () => false });

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      apiKeyOwner,
      "doc-1",
      { id: "doc-1" },
      false,
      false,
      { actorType: "apiKey", permissions: ["publish-posts"] }
    );

    expect(result?.statusCode).toBe(403);
  });

  it("allows a scoped key with the grant when the code-defined rule allows", async () => {
    const { service, rbac } = buildAccessService();
    rbac.getRegisteredAccess.mockReturnValue({ publish: () => true });

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      apiKeyOwner,
      "doc-1",
      { id: "doc-1" },
      false,
      false,
      { actorType: "apiKey", permissions: ["publish-posts"] }
    );

    expect(result).toBeNull();
  });

  it("allows a publish the key IS scoped for, even when the owner's RBAC denies", async () => {
    const { service, rbac } = buildAccessService();
    // The OWNER cannot publish...
    rbac.checkAccess.mockResolvedValue(false);

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      apiKeyOwner,
      "doc-1",
      { id: "doc-1" },
      false,
      false,
      // ...but the KEY carries the publish grant.
      { actorType: "apiKey", permissions: ["update-posts", "publish-posts"] }
    );

    expect(result).toBeNull();
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("falls through to the owner's RBAC for a session caller (no api-key scope)", async () => {
    const { service, rbac } = buildAccessService();
    rbac.checkAccess.mockResolvedValue(false);

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      apiKeyOwner,
      "doc-1",
      { id: "doc-1" },
      false,
      false,
      // A session caller carries a scope with actorType "user" (or none), so the
      // owner/session RBAC decides.
      { actorType: "user", permissions: [] }
    );

    expect(result?.statusCode).toBe(403);
    expect(rbac.checkAccess).toHaveBeenCalledTimes(1);
  });
});

describe("getOwnerConstraint — scoped API key", () => {
  // getOwnerConstraint emits the owner predicate that a read/mutate folds into
  // its WHERE clause. The session super-admin bypass lifts it — but a scoped API
  // key owned by a super-admin must still obey a stored owner-only rule, so the
  // predicate has to survive for the key even though the account is super-admin.
  function buildWithOwnerOnlyRead() {
    const accessControlService = createMockAccessControlService();
    const rbac = {
      checkAccess: vi.fn().mockResolvedValue(true),
      getRegisteredAccess: vi.fn().mockReturnValue(undefined),
    };
    const collectionService = {
      getCollection: vi
        .fn()
        .mockResolvedValue({ accessRules: { read: { type: "owner-only" } } }),
      generateId: vi.fn(),
    };
    return new CollectionAccessService(
      createMockAdapter(createMockDb({ rows: [] })) as never,
      silentLogger as never,
      collectionService as never,
      accessControlService as never,
      rbac as never
    );
  }

  it("lifts the owner predicate for a session super-admin (no scope)", async () => {
    const service = buildWithOwnerOnlyRead();
    const constraint = await service.getOwnerConstraint(
      "posts",
      "read",
      superAdminUser,
      false
    );
    expect(constraint).toBeNull();
  });

  it("keeps the owner predicate for a super-admin-owned scoped API key", async () => {
    const service = buildWithOwnerOnlyRead();
    const constraint = await service.getOwnerConstraint(
      "posts",
      "read",
      superAdminUser,
      false,
      { actorType: "apiKey", permissions: ["read-posts"] }
    );
    // The scope skips the super-admin bypass, so the owner-only rule still binds
    // the key to rows it owns.
    expect(constraint).toEqual({ field: "created_by", value: "user-1" });
  });
});

describe("resolveTransitionDocumentRule — owner-only transition pre-resolve", () => {
  const ownerOnlyPublish = {
    accessRules: { publish: { type: "owner-only" } },
  } as Record<string, unknown>;

  it("returns the pre-fetched rules + user for an owner-only publish rule", () => {
    const { service } = buildAccessService();
    const resolved = service.resolveTransitionDocumentRule(
      ownerOnlyPublish,
      user
    );
    expect(resolved).not.toBeNull();
    expect(resolved?.user).toBe(user);
    expect(resolved?.accessRules.publish?.type).toBe("owner-only");
  });

  it("returns null for a super-admin SESSION (stored rules are bypassed)", () => {
    const { service } = buildAccessService();
    expect(
      service.resolveTransitionDocumentRule(ownerOnlyPublish, superAdminUser)
    ).toBeNull();
  });

  it("keeps the rule for a super-admin-owned scoped API key", () => {
    const { service } = buildAccessService();
    const resolved = service.resolveTransitionDocumentRule(
      ownerOnlyPublish,
      superAdminUser,
      { actorType: "apiKey", permissions: ["publish-posts"] }
    );
    // The scope skips the super-admin bypass, so the owner-only rule still applies.
    expect(resolved).not.toBeNull();
  });

  it("returns null when no owner-only publish/unpublish rule exists", () => {
    const { service } = buildAccessService();
    // An owner-only READ rule is document-dependent for reads but not for the
    // publish/unpublish transition, so there is nothing to enforce under the lock.
    expect(
      service.resolveTransitionDocumentRule(
        { accessRules: { read: { type: "owner-only" } } } as Record<
          string,
          unknown
        >,
        user
      )
    ).toBeNull();
  });

  it("returns the rules for a custom publish rule (may inspect the document)", () => {
    const { service } = buildAccessService();
    const resolved = service.resolveTransitionDocumentRule(
      {
        accessRules: { publish: { type: "custom", functionPath: "./fn" } },
      } as Record<string, unknown>,
      user
    );
    // A custom rule can key off id/data, so it must be re-judged under the lock.
    expect(resolved).not.toBeNull();
    expect(resolved?.accessRules.publish?.type).toBe("custom");
  });
});

describe("evaluateTransitionDocumentRule — owner-only against a locked row", () => {
  it("returns null (skips) when the operation has no owner-only rule", async () => {
    const { service, accessControlService } = buildAccessService();
    const result = await service.evaluateTransitionDocumentRule(
      { publish: { type: "role-based", allowedRoles: ["editor"] } },
      "publish",
      user,
      { id: "doc-1", created_by: "someone-else" }
    );
    expect(result).toBeNull();
    // A non-owner-only rule was already decided by the permission pre-resolve, so
    // the document evaluator must not re-run it.
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("returns a 403 when the owner-only rule denies the locked document", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "You can only modify your own documents",
    });
    const result = await service.evaluateTransitionDocumentRule(
      { publish: { type: "owner-only" } },
      "publish",
      user,
      { id: "doc-1", created_by: "someone-else" }
    );
    expect(result?.statusCode).toBe(403);
    expect(result?.success).toBe(false);
  });

  it("returns null when the owner-only rule allows the locked document", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    const result = await service.evaluateTransitionDocumentRule(
      { publish: { type: "owner-only" } },
      "publish",
      user,
      { id: "doc-1", created_by: "user-1" }
    );
    expect(result).toBeNull();
  });

  it("re-judges a custom rule against the locked row, forwarding its id", async () => {
    const { service, accessControlService } = buildAccessService();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "custom denied",
    });
    const result = await service.evaluateTransitionDocumentRule(
      { publish: { type: "custom", functionPath: "./fn" } },
      "publish",
      user,
      { id: "doc-1", title: "hello" }
    );
    expect(result?.statusCode).toBe(403);
    // The locked row's id and full data reach the custom evaluator, so a
    // row-dependent rule sees the real document instead of the docless default.
    expect(accessControlService.evaluateAccess).toHaveBeenCalledWith(
      { publish: { type: "custom", functionPath: "./fn" } },
      "publish",
      expect.anything(),
      "doc-1",
      { id: "doc-1", title: "hello" },
      expect.anything()
    );
  });
});
