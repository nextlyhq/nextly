/**
 * Proves that Single writes/reads enforce the Single's STORED access rules, not
 * just the coarse RBAC permission. UI-created Singles persist `accessRules`
 * (role-based / authenticated / owner-only / custom); before this, a caller
 * holding the `update-<single>` permission but failing a stored rule could
 * still PATCH because the route path only ran RBAC (or skipped it entirely when
 * route-authorized). These tests lock in that the stored rules run on every
 * transport, and that overrideAccess / super-admin remain the bypasses.
 */

import { describe, it, expect, vi } from "vitest";

import type { CollectionAccessRules } from "../../../services/access";

import { checkSingleAccess } from "./single-query-service";

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

function makeDeps() {
  const accessControlService = { evaluateAccess: vi.fn() };
  const rbacAccessControlService = {
    checkAccess: vi.fn().mockResolvedValue(true),
    // No code-defined access by default; a scoped API key is judged on its
    // permission grant alone unless a test registers a rule.
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
  };
  return { accessControlService, rbacAccessControlService };
}

// Update restricted to the `admin` role; the caller is an editor.
const roleBasedUpdate: CollectionAccessRules = {
  update: { type: "role-based", allowedRoles: ["admin"] },
};

const editor = { id: "user-1", roles: ["editor"] };
const superAdmin = { id: "user-1", roles: ["super-admin"] };

describe("checkSingleAccess — stored rule enforcement", () => {
  it("fails closed for an owner-only update when no document exists yet", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    // Not consulted — the guard denies before evaluateAccess runs.
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: { update: { type: "owner-only" } },
      document: undefined,
      logger: silentLogger,
    });

    // Without a document there is no ownership to compare, so the first PATCH
    // must not slip through with only the coarse permission.
    expect(result?.statusCode).toBe(403);
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("denies a route-authorized update when the stored rule fails, without RBAC", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "role not allowed",
    });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      overrideAccess: false,
      routeAuthorized: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
    // The redundant RBAC gate is skipped for a route-authorized caller.
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("allows a route-authorized update when the stored rule allows, skipping RBAC", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("enforces the stored rule even when the caller holds the RBAC permission (Direct API)", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    // RBAC would allow, but the stored rule denies — the stored rule must win.
    rbacAccessControlService.checkAccess.mockResolvedValue(true);
    accessControlService.evaluateAccess.mockResolvedValue({
      allowed: false,
      reason: "role not allowed",
    });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
    // Denied at the stored-rule stage, before the RBAC gate runs.
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("runs the RBAC gate for a Direct API caller once the stored rule allows", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    rbacAccessControlService.checkAccess.mockResolvedValue(false);

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
    expect(rbacAccessControlService.checkAccess).toHaveBeenCalledTimes(1);
  });

  it("bypasses stored rules when overrideAccess is true", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: false });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      overrideAccess: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("lets a super-admin bypass stored rules on every transport", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: false });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: superAdmin,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: roleBasedUpdate,
      logger: silentLogger,
    });

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("forwards the current document to evaluateAccess so owner-only rules can check ownership", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    const ownerOnly: CollectionAccessRules = {
      update: { type: "owner-only", ownerField: "createdBy" },
    };
    const doc = { id: "site", createdBy: "user-1" };

    await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: ownerOnly,
      document: doc,
      logger: silentLogger,
    });

    // The document id is passed as the 4th arg (for custom rules) and the
    // document as the 5th arg so evaluateOwnerAccess compares ownership instead
    // of allowing by default.
    expect(accessControlService.evaluateAccess).toHaveBeenCalledWith(
      ownerOnly,
      "update",
      expect.anything(),
      "site",
      doc
    );
  });

  it("skips stored evaluation and honors routeAuthorized when there are no stored rules", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();

    const result = await checkSingleAccess({
      slug: "site",
      operation: "update",
      user: editor,
      routeAuthorized: true,
      rbacAccessControlService: rbacAccessControlService as never,
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });
});

describe("checkSingleAccess — scoped API key", () => {
  // The publish/unpublish transition gate runs NOT route-authorized (the route
  // attested only `update`). For a scoped API key it judges the key's OWN
  // stamped grants, not the key owner's RBAC.
  const apiKeyOwner = { id: "publisher-1", roles: ["editor"] };

  it("denies a publish the key is not scoped for, even when the owner's RBAC allows", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    rbacAccessControlService.checkAccess.mockResolvedValue(true); // owner can publish

    const result = await checkSingleAccess({
      slug: "site",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      authenticatedScope: { actorType: "apiKey", permissions: ["update-site"] },
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("does not let a super-admin-owned key bypass its scope for publish", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "publish",
      // The key's resolved role set carries super-admin, but a scoped key must
      // not get the session super-admin bypass.
      user: { id: "admin-1", roles: ["super-admin"] },
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      authenticatedScope: { actorType: "apiKey", permissions: ["update-site"] },
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
  });

  it("still enforces a code-defined access rule for a scoped key that holds the grant", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    // The key HAS publish-site, but the Single's code-defined access.publish
    // denies — the grant must not bypass it.
    rbacAccessControlService.getRegisteredAccess.mockReturnValue({
      publish: () => false,
    });

    const result = await checkSingleAccess({
      slug: "site",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["publish-site"],
      },
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
  });

  it("allows a publish the key IS scoped for, even when the owner's RBAC denies", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    rbacAccessControlService.checkAccess.mockResolvedValue(false); // owner cannot publish

    const result = await checkSingleAccess({
      slug: "site",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      authenticatedScope: {
        actorType: "apiKey",
        permissions: ["update-site", "publish-site"],
      },
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result).toBeNull();
    expect(rbacAccessControlService.checkAccess).not.toHaveBeenCalled();
  });

  it("falls through to the owner's RBAC for a session caller (no api-key scope)", async () => {
    const { accessControlService, rbacAccessControlService } = makeDeps();
    accessControlService.evaluateAccess.mockResolvedValue({ allowed: true });
    rbacAccessControlService.checkAccess.mockResolvedValue(false);

    const result = await checkSingleAccess({
      slug: "site",
      operation: "publish",
      user: apiKeyOwner,
      overrideAccess: false,
      routeAuthorized: false,
      rbacAccessControlService: rbacAccessControlService as never,
      authenticatedScope: { actorType: "user", permissions: [] },
      accessControlService: accessControlService as never,
      accessRules: undefined,
      logger: silentLogger,
    });

    expect(result?.statusCode).toBe(403);
    expect(rbacAccessControlService.checkAccess).toHaveBeenCalledTimes(1);
  });
});
