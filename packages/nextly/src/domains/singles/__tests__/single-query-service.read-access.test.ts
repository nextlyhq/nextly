/**
 * A Single's read gate has to hold on the read path, not just on writes.
 *
 * `get()` is driven end to end rather than `checkSingleAccess` directly,
 * because the claim is about the gate being REACHED with the caller intact —
 * the read once called it without the caller's scope, so a rule that was
 * enforced on every update did nothing over HTTP.
 *
 * The second half covers the opt-in nature of related-row field enforcement.
 * The default matters: a caller that supplies no access context cannot be told
 * apart from an anonymous one, so enforcing by default would strip protected
 * related fields from every caller of the mutation-response path, which passes
 * no context at all.
 */

import { describe, it, expect, vi } from "vitest";

import { container } from "../../../di/container";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";
import { SingleQueryService } from "../services/single-query-service";

import {
  createMockAdapter,
  createSilentLogger,
  createMockSingleRegistry,
  createMockHookRegistry,
  createMockRBACService,
  siteSettingsMeta,
  textField,
} from "./single-test-helpers";

type Ctor = ConstructorParameters<typeof SingleQueryService>;

const editor = { id: "user-1", roles: ["editor"] };

function createService(rbacAllows: boolean) {
  const registry = createMockSingleRegistry();
  registry.registerSingle("site-settings", {
    ...siteSettingsMeta(),
    fields: [textField("siteName")],
  });

  const rbac = createMockRBACService(rbacAllows);

  const service = new SingleQueryService(
    createMockAdapter({
      selectOne: vi
        .fn()
        .mockResolvedValue({ id: "doc1", siteName: "Nextly", status: null }),
    }) as unknown as Ctor[0],
    createSilentLogger() as unknown as Ctor[1],
    registry as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    undefined,
    rbac as unknown as Ctor[5]
  );

  return { service, rbac };
}

describe("SingleQueryService.get — the read gate", () => {
  it("denies a caller the gate rejects", async () => {
    const { service } = createService(false);

    const result = await service.get("site-settings", { user: editor });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("allows a caller the gate admits", async () => {
    const { service } = createService(true);

    const result = await service.get("site-settings", { user: editor });

    expect(result.success).toBe(true);
  });

  it("asks the gate about the read operation, for this caller", async () => {
    const { service, rbac } = createService(true);

    await service.get("site-settings", { user: editor });

    expect(rbac.checkAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        operation: "read",
        resource: "site-settings",
      })
    );
  });

  it("lets a trusted read bypass the gate", async () => {
    // The mirror of the denial above, and the reason that one is not enough on
    // its own: a service that refused every read would pass it while being
    // wrong here.
    const { service, rbac } = createService(false);

    const result = await service.get("site-settings", {
      user: editor,
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("skips the permission check for a caller with no identity", async () => {
    // There are no permissions to look up for an anonymous caller, so with no
    // code-defined rule governing the read it falls through to the
    // permission-less default rather than being refused.
    const { service, rbac } = createService(false);

    const result = await service.get("site-settings", {});

    expect(result.success).toBe(true);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
    // The half of the gate that needs no user WAS asked.
    expect(rbac.checkAnonymousCodeAccess).toHaveBeenCalledWith({
      operation: "read",
      resource: "site-settings",
    });
  });

  it("applies the Single's own code-defined rule to a caller with no identity", async () => {
    // `read: false` or `read: ({ user }) => !!user` on a Single describes an
    // anonymous reader most clearly of all. The same rule on a collection
    // refuses them; a Single that admitted them answered one rule two ways.
    const { service, rbac } = createService(true);
    rbac.checkAnonymousCodeAccess.mockResolvedValue(false);

    const result = await service.get("site-settings", {});

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(rbac.checkAccess).not.toHaveBeenCalled();
  });

  it("refuses an anonymous publish even when the rule would admit", async () => {
    // Publishing has no identity to stamp, so the rule's admission does not
    // lift the refusal: asked, then overruled.
    const { service, rbac } = createService(true);
    rbac.checkAnonymousCodeAccess.mockResolvedValue(true);

    const { checkSingleAccess } = await import(
      "../services/single-query-service"
    );
    const denied = await checkSingleAccess({
      slug: "site-settings",
      operation: "publish",
      rbacAccessControlService: rbac as never,
      logger: createSilentLogger() as never,
    });

    expect(denied?.statusCode).toBe(403);
    expect(rbac.checkAnonymousCodeAccess).not.toHaveBeenCalled();
  });
});

describe("SingleQueryService.expandRelationshipFields — enforcement is opt-in", () => {
  const RELATION_FIELDS = [{ name: "author", type: "relationship" }];

  function serviceWithRelationshipSpy() {
    const expandRelationships = vi
      .fn()
      .mockImplementation((doc: unknown) => Promise.resolve(doc));
    container.register("collectionsHandler", () => ({
      getRelationshipService: () => ({ expandRelationships }),
    }));

    const service = new SingleQueryService(
      createMockAdapter() as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      createMockSingleRegistry() as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3]
    );
    return { service, expandRelationships };
  }

  it("returns the document unexpanded when expansion throws", async () => {
    // A response is better served incomplete than not at all: one relationship
    // that could not be resolved comes back as the stored reference rather than
    // failing the whole read.
    const expandRelationships = vi
      .fn()
      .mockRejectedValue(new Error('no such table: "dc_authors"'));
    container.register("collectionsHandler", () => ({
      getRelationshipService: () => ({ expandRelationships }),
    }));
    const service = new SingleQueryService(
      createMockAdapter() as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      createMockSingleRegistry() as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3]
    );

    const doc = { id: "doc1", author: "a1" };
    await expect(
      service.expandRelationshipFields(
        doc as never,
        RELATION_FIELDS as never,
        1,
        {
          trusted: TRUSTS_EVERY_COLLECTION,
        }
      )
    ).resolves.toEqual(doc);
    // The failure was real: without this the resolve above would also hold for
    // an expansion that never ran.
    expect(expandRelationships).toHaveBeenCalled();
  });

  it("leaves relationships inside containers alone for a caller with no context", async () => {
    // Expansion copies whole related rows in, and a caller that threads no user
    // cannot have the target collection's field rules evaluated for them — the
    // mutation response path is exactly that caller. Reaching into containers
    // for it would hand over rows nothing downstream can redact.
    const { service, expandRelationships } = serviceWithRelationshipSpy();

    await service.expandRelationshipFields(
      { id: "doc1" } as never,
      [
        {
          name: "meta",
          type: "group",
          fields: [{ name: "author", type: "relationship" }],
        },
      ] as never
    );

    expect(expandRelationships).not.toHaveBeenCalled();
  });

  it("leaves enforcement off for a caller that supplies no access context", async () => {
    const { service, expandRelationships } = serviceWithRelationshipSpy();

    await service.expandRelationshipFields(
      { id: "doc1" } as never,
      RELATION_FIELDS as never
    );

    expect(expandRelationships.mock.calls[0][3].enforceFieldAccess).toBeFalsy();
  });

  it("enforces when the read path opts in with its caller", async () => {
    const { service, expandRelationships } = serviceWithRelationshipSpy();

    await service.expandRelationshipFields(
      { id: "doc1" } as never,
      RELATION_FIELDS as never,
      undefined,
      {
        trusted: TRUSTS_EVERY_COLLECTION,
        enforceFieldAccess: true,
        user: editor,
      }
    );

    const options = expandRelationships.mock.calls[0][3];
    expect(options.enforceFieldAccess).toBe(true);
    expect(options.user).toMatchObject({ id: "user-1" });
  });
});
