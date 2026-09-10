/**
 * What a request with no user meets on the way through, at both layers.
 *
 * The gate is two things, and only one of them needs a user. The DB PERMISSION
 * check does, so it does not run for an anonymous caller. The collection's own
 * CODE-DEFINED rule does not: it reads nothing off the caller, and it is
 * consulted. Treating the two as one is what left `access: { create: false }`
 * accepted at boot and never asked.
 *
 * The stored rules run regardless, and are where an `owner-only` rule refuses:
 * it has nobody to compare against and denies. So skipping the permission check
 * is not a way past the rules, and the three layers must not be confused for
 * one another.
 *
 * Driven through `checkCollectionAccess` with the real leaf evaluator, because
 * this is a claim about how the layers combine. Calling the evaluator directly
 * proves only the leaf, and would stay green if this service ever stopped
 * running the stored rules when a user is absent.
 */

import { describe, it, expect, vi } from "vitest";

import { AccessControlService } from "../../../services/access/access-control-service";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockDb,
  createMockAdapter,
  silentLogger,
  createMockCollection,
  createMockCollectionService,
} from "../__tests__/collection-test-helpers";

function buildService(accessRules: Record<string, unknown>) {
  // Spied rather than stubbed away: "was this consulted" is half of what these
  // tests assert.
  const rbac = {
    checkAccess: vi.fn().mockResolvedValue(true),
    // Answers `undefined`: no code-defined rule, so the stored rules decide.
    checkAnonymousCodeAccess: vi.fn().mockResolvedValue(undefined),
    getRegisteredAccess: vi.fn().mockReturnValue(undefined),
  };
  const service = new CollectionAccessService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    createMockCollectionService(
      createMockCollection({ accessRules }) as never
    ) as never,
    // The real one. A stub here would decide the outcome this test is about.
    new AccessControlService() as never,
    rbac as never
  );
  return { service, rbac };
}

describe("checkCollectionAccess with no user", () => {
  it("denies an owner-only write through the stored rule", async () => {
    const { service, rbac } = buildService({ update: { type: "owner-only" } });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      undefined
    );

    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
    // The gate was never asked, and the refusal still happened. This is the
    // pairing: what a missing user skips is the permission check, not the rule.
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("allows an operation the collection states no rule for", async () => {
    // The positive control, and the surprising half: absent means public. A
    // service that denied every anonymous request would pass the case above
    // while being wrong about this one.
    const { service, rbac } = buildService({ read: { type: "owner-only" } });

    const result = await service.checkCollectionAccess(
      "posts",
      "update",
      undefined
    );

    expect(result).toBeNull();
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("applies the collection's inline code rule, which needs no user", async () => {
    // The layer the doc on `resolveContent` said could not run. A code rule
    // reads what it is given, and an anonymous caller is a thing it can be
    // given: `user: null`, no roles. So it is consulted, and its refusal is the
    // answer, even though the permission check beside it never runs.
    const { service, rbac } = buildService({});
    rbac.checkAnonymousCodeAccess.mockResolvedValue(false);

    const result = await service.checkCollectionAccess(
      "posts",
      "read",
      undefined
    );

    expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalledWith({
      operation: "read",
      resource: "posts",
    });
    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("lets the stored rules decide when no inline rule governs the operation", async () => {
    // The control that keeps the case above from meaning "anonymous is denied".
    // `undefined` is no opinion, not a refusal, so a collection with no inline
    // rule for this operation still reads as it always did.
    const { service, rbac } = buildService({});
    rbac.checkAnonymousCodeAccess.mockResolvedValue(undefined);

    const result = await service.checkCollectionAccess(
      "posts",
      "read",
      undefined
    );

    expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("refuses publish with no user and no rule for it", async () => {
    // The exception to that default, decided in this service rather than the
    // leaf: publishing anonymously needs a rule that says so.
    const { service } = buildService({ read: { type: "public" } });

    const result = await service.checkCollectionAccess(
      "posts",
      "publish",
      undefined
    );

    expect(result?.success).toBe(false);
    expect(result?.statusCode).toBe(403);
  });
});
