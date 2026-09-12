/**
 * What a request with no user meets on the way through `checkCollectionAccess`.
 *
 * The gate is two things, and only one of them needs a user. The DB PERMISSION
 * check does, so it does not run for an anonymous caller. The collection's own
 * CODE-DEFINED rule does not: it reads nothing off the caller, and it is
 * consulted. Treating the two as one is what left `access: { create: false }`
 * accepted at boot and never asked.
 *
 * With no rule governing the operation, the request falls through to the
 * permission-less default and is allowed. Publishing is the exception, refused
 * in this service before the default is reached.
 *
 * The pairing is the point. A service that denied every anonymous request would
 * pass the publish case while being wrong about the read, and one that never
 * refused would pass the read while letting an unauthenticated caller publish.
 * Both directions are asserted here, and each is the other's control.
 */

import { describe, it, expect, vi } from "vitest";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockDb,
  createMockAdapter,
  silentLogger,
} from "../__tests__/collection-test-helpers";

function buildService() {
  // Spied rather than stubbed away: "was this consulted" is half of what these
  // tests assert.
  const rbac = {
    checkAccess: vi.fn().mockResolvedValue(true),
    // Answers `undefined`: no code-defined rule governs the operation.
    checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
  };
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    rbac as never
  );
  return { service, rbac };
}

describe("checkCollectionAccess with no user", () => {
  it("allows an ordinary operation and never asks the permission check", async () => {
    const { service, rbac } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "update",
      user: undefined,
    });

    expect(result).toBeNull();
    // What a missing user skips is the permission check: there are no
    // permissions to look up for a caller with no identity.
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("applies the collection's inline code rule, which needs no user", async () => {
    // A code rule reads what it is given, and an anonymous caller is a thing
    // it can be given: `user: null`, no roles. So it is consulted, and its
    // refusal is the answer, even though the permission check beside it never
    // runs.
    const { service, rbac } = buildService();
    rbac.checkAnonymousCodeAccess.mockResolvedValue(false);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "read",
      user: undefined,
    });

    expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalledWith({
      operation: "read",
      resource: "posts",
    });
    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("falls through to the public default when no inline rule governs the operation", async () => {
    // The control that keeps the case above from meaning "anonymous is denied".
    // `undefined` is no opinion, not a refusal, so a collection with no inline
    // rule for this operation still reads as it always did.
    const { service, rbac } = buildService();
    rbac.checkAnonymousCodeAccess.mockResolvedValue(undefined);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "read",
      user: undefined,
    });

    expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("refuses publish with no user", async () => {
    const { service, rbac } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: undefined,
    });

    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
    // Decided in this service rather than by the permission check, which was
    // never reached.
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("refuses publish with no user even when the inline rule would admit", async () => {
    // Publishing has no identity to stamp, so a rule that admits the anonymous
    // caller does not lift the refusal: the rule is asked, and then overruled.
    const { service, rbac } = buildService();
    rbac.checkAnonymousCodeAccess.mockResolvedValue(true);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: undefined,
    });

    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
  });

  it("refuses unpublish with no user", async () => {
    const { service } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "unpublish",
      user: undefined,
    });

    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
  });
});
