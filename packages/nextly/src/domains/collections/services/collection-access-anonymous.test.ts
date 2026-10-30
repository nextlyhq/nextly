/**
 * What a request with no user meets on the way through `checkCollectionAccess`.
 *
 * The gate is two things, and only one of them needs a user. The DB PERMISSION
 * check does, so it does not run for an anonymous caller. The collection's own
 * CODE-DEFINED rule does not: it reads nothing off the caller, and it is
 * consulted. Treating the two as one is what left `access: { create: false }`
 * accepted at boot and never asked.
 *
 * A caller with no user holds what the Public role grants (faked here: the
 * read, unless a test says otherwise). With no rule governing the operation
 * that permission alone decides, and a rule only narrows it: an anonymous
 * create, update or delete needs the Public role's permission, and a rule, if
 * one names it, that answers `true`. Publishing is refused whatever the rule
 * says.
 *
 * The pairing is the point. A service that denied every anonymous request would
 * pass the publish case while being wrong about the read, and one that never
 * refused would pass the read while letting an unauthenticated caller publish.
 * Both directions are asserted here, and each is the other's control.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AccessControlFunction } from "../../../shared/types/access";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockDb,
  createMockAdapter,
  fakeActorForUser,
  fakeUserHoldsPermission,
  fakeUserIsSuperAdmin,
  publicMay,
  resetCallerAccess,
  silentLogger,
} from "../__tests__/collection-test-helpers";

// Spied rather than stubbed away: "was the caller looked up" is half of what
// these tests assert.
vi.mock("../../../auth/access/resolve-actor", async importOriginal => ({
  ...(await importOriginal<object>()),
  ...(await (async () => {
    const fake = await import("../__tests__/collection-test-helpers");
    return {
      actorForUser: fake.fakeActorForUser,
      actorForVisitor: fake.fakeActorForVisitor,
      userHoldsPermission: fake.fakeUserHoldsPermission,
      userIsSuperAdmin: fake.fakeUserIsSuperAdmin,
    };
  })()),
}));

beforeEach(() => {
  resetCallerAccess();
  fakeActorForUser.mockClear();
  fakeUserHoldsPermission.mockClear();
});

/** A gate whose collection declares `rule` for every action, or no rule. */
function buildService(rule?: AccessControlFunction) {
  const access = rule
    ? {
        create: rule,
        read: rule,
        update: rule,
        delete: rule,
        publish: rule,
        unpublish: rule,
      }
    : undefined;
  const rbac = {
    getRegisteredTarget: vi
      .fn()
      .mockReturnValue(
        access ? { kind: "collection", slug: "posts", access } : undefined
      ),
  };
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    rbac as never
  );
  return { service, rbac };
}

describe("checkCollectionAccess with no user", () => {
  it("refuses a write no rule names, and never looks a caller up", async () => {
    const { service } = buildService();

    for (const operation of ["create", "update", "delete"] as const) {
      const result = await service.checkCollectionAccess({
        collectionName: "posts",
        operation,
        user: undefined,
      });

      // A caller with no identity is asked to sign in (401).
      expect(result?.statusCode, operation).toBe(401);
      expect(result?.refusalReason, operation).toBe(
        `${operation} on posts requires an authenticated user`
      );
    }
    // What a missing user skips is the permission lookup: there are no
    // permissions to look up for a caller with no identity.
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("allows a write the Public role holds and the inline rule answers true for", async () => {
    // The control for the refusal above: the same anonymous write, which the
    // Public role grants and a rule lets through, as a public form's
    // submissions are.
    publicMay("read", "create");
    const { service } = buildService(() => true);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "create",
      user: undefined,
    });

    expect(result).toBeNull();
  });

  it("refuses a write the inline rule answers true for, where the Public role does not hold it", async () => {
    // The permission first: a rule only narrows what the Public role grants.
    const { service } = buildService(() => true);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "create",
      user: undefined,
    });

    // A caller with no identity is asked to sign in (401).
    expect(result?.statusCode).toBe(401);
    expect(result?.refusalReason).toBe(
      "create on posts requires an authenticated user"
    );
  });

  it("applies the collection's inline code rule, which needs no user", async () => {
    // A code rule reads what it is given, and an anonymous caller is a thing
    // it can be given: `user: null`, no roles. So it is consulted, and its
    // refusal is the answer, even though the permission lookup never runs.
    const rule = vi.fn(() => false);
    const { service } = buildService(rule);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "read",
      user: undefined,
    });

    expect(rule).toHaveBeenCalledWith(
      expect.objectContaining({
        user: null,
        roles: [],
        // What the Public role grants, which is what the visitor holds.
        permissions: expect.arrayContaining(["read-posts"]),
        operation: "read",
        target: { kind: "collection", slug: "posts" },
      })
    );
    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("reads on the Public role's read when no inline rule governs the operation", async () => {
    // The control that keeps the case above from meaning "anonymous is denied".
    // No rule is no opinion, not a refusal, so the Public role's read decides.
    const { service, rbac } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "read",
      user: undefined,
    });

    expect(rbac.getRegisteredTarget).toHaveBeenCalledWith("posts");
    expect(result).toBeNull();
  });

  it("refuses a read no inline rule governs where the Public role does not grant it", async () => {
    // No public default: what the Public role does not grant, a visitor does
    // not hold.
    publicMay();
    const { service } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "read",
      user: undefined,
    });

    expect(result?.success).toBe(false);
  });

  it("refuses publish with no user", async () => {
    const { service } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: undefined,
    });

    expect(result?.success).toBe(false);
    // A caller with no identity is asked to sign in (401).
    expect(result?.statusCode).toBe(401);
    // Decided without looking any caller up.
    expect(fakeActorForUser).not.toHaveBeenCalled();
    expect(fakeUserHoldsPermission).not.toHaveBeenCalled();
  });

  it("refuses publish with no user even when the inline rule would admit", async () => {
    // Publishing has no identity to stamp, so a rule that admits the anonymous
    // caller does not lift the refusal: a visitor never publishes, which is
    // decided before the rule, application code, is run.
    const rule = vi.fn(() => true);
    const { service } = buildService(rule);

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "publish",
      user: undefined,
    });

    expect(rule).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    // A caller with no identity is asked to sign in (401).
    expect(result?.statusCode).toBe(401);
  });

  it("refuses unpublish with no user", async () => {
    const { service } = buildService();

    const result = await service.checkCollectionAccess({
      collectionName: "posts",
      operation: "unpublish",
      user: undefined,
    });

    expect(result?.success).toBe(false);
    // A caller with no identity is asked to sign in (401).
    expect(result?.statusCode).toBe(401);
  });
});
