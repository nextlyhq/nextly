/**
 * Proves the route-write access decoupling: a route-authorized write skips only
 * the redundant RBAC gate (the middleware already ran it) but STILL evaluates
 * the stored collection access rules, while `overrideAccess` remains a full
 * system bypass and super-admin bypasses the stored rules on every transport.
 *
 * Before the fix, route writes forced `overrideAccess: true`, which returned
 * early and never evaluated the stored rules — the bug these tests guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockDb,
  createMockAdapter,
  silentLogger,
  createMockCollectionService,
  createMockAccessControlService,
} from "../__tests__/collection-test-helpers";

// isSuperAdmin does a DB lookup; mock it so we can drive the super-admin path
// deterministically. Default: not a super-admin.
const isSuperAdminMock = vi.fn().mockResolvedValue(false);
vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  isSuperAdmin: (userId: string) => isSuperAdminMock(userId),
}));

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

const user = { id: "user-1" };

describe("checkCollectionAccess — route-authorized decoupling", () => {
  beforeEach(() => {
    isSuperAdminMock.mockResolvedValue(false);
  });

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

  it("lets a super-admin bypass the stored rules on every transport", async () => {
    const { service, accessControlService } = buildAccessService();
    isSuperAdminMock.mockResolvedValue(true);
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
      false,
      true
    );

    expect(result).toBeNull();
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });

  it("fails safe (no bypass) when the super-admin lookup throws", async () => {
    const { service, accessControlService } = buildAccessService();
    isSuperAdminMock.mockRejectedValue(new Error("db down"));
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
      false,
      true
    );

    // Lookup error must NOT grant the bypass — the stored rule still denies.
    expect(result?.statusCode).toBe(403);
    expect(accessControlService.evaluateAccess).toHaveBeenCalledTimes(1);
  });
});
