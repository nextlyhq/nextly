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
  const rbac = { checkAccess: vi.fn().mockResolvedValue(true) };
  const collectionService = createMockCollectionService();
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb()) as never,
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
