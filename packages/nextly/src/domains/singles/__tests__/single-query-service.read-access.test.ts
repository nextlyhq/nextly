/**
 * A Single's stored read rule has to hold on the read path, not just on writes.
 *
 * The rule was previously never evaluated on reads: the read gate was called
 * without the Single's `accessRules`, so a `read: role-based` rule an admin
 * configured did nothing over HTTP while the same rule was enforced on every
 * update. These tests drive `get()` so they cover the whole gate — the rules
 * being handed over AND something being present to evaluate them with, which
 * are two separate arguments that both have to arrive for enforcement to run.
 */

import { describe, it, expect, vi } from "vitest";

import { container } from "../../../di/container";
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

/** Read restricted to the `admin` role. */
const ROLE_BASED_READ = {
  read: { type: "role-based" as const, allowedRoles: ["admin"] },
};

const editor = { id: "user-1", roles: ["editor"] };
const admin = { id: "user-2", roles: ["admin"] };

function createService(
  evaluateAllowed: boolean,
  accessRules: Record<string, unknown> = ROLE_BASED_READ
) {
  const registry = createMockSingleRegistry();
  registry.registerSingle("site-settings", {
    ...siteSettingsMeta({ accessRules }),
    fields: [textField("siteName")],
  });

  const accessControlService = {
    evaluateAccess: vi
      .fn()
      .mockResolvedValue(
        evaluateAllowed
          ? { allowed: true }
          : { allowed: false, reason: "denied" }
      ),
  };

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
    createMockRBACService(true) as unknown as Ctor[5],
    undefined,
    accessControlService as unknown as Ctor[7]
  );

  return { service, accessControlService };
}

describe("SingleQueryService.get — stored read rules", () => {
  it("denies a caller the stored read rule rejects", async () => {
    const { service, accessControlService } = createService(false);

    const result = await service.get("site-settings", {
      user: editor,
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    // The rule was actually consulted, rather than the read failing for some
    // unrelated reason.
    expect(accessControlService.evaluateAccess).toHaveBeenCalled();
  });

  it("allows a caller the stored read rule admits", async () => {
    const { service } = createService(true);

    const result = await service.get("site-settings", {
      user: admin,
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("evaluates the rule for the read operation, against the caller", async () => {
    const { service, accessControlService } = createService(true);

    await service.get("site-settings", { user: editor, routeAuthorized: true });

    // Guards the two arguments that each silently disable enforcement when
    // missing: the rules themselves, and the operation they are read under.
    const [rules, operation, context] =
      accessControlService.evaluateAccess.mock.calls[0];
    expect(rules).toMatchObject(ROLE_BASED_READ);
    expect(operation).toBe("read");
    expect(context.user).toMatchObject({ id: "user-1", roles: ["editor"] });
  });

  it("does not blanket-deny an owner-only read before the row is loaded", async () => {
    // The gate runs before the document is fetched and fails an owner-only rule
    // closed when it has no document, so evaluating it there would 403 every
    // non-super-admin read. The rule has to be judged against the loaded row.
    const { service, accessControlService } = createService(true, {
      read: { type: "owner-only" as const },
    });

    const result = await service.get("site-settings", {
      user: editor,
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    const [, , , documentId, document] =
      accessControlService.evaluateAccess.mock.calls[0];
    // Judged against the real row, so ownership is actually comparable.
    expect(documentId).toBe("doc1");
    expect(document).toMatchObject({ id: "doc1" });
  });

  it("denies an owner-only read the rule rejects for this caller", async () => {
    const { service } = createService(false, {
      read: { type: "owner-only" as const },
    });

    const result = await service.get("site-settings", {
      user: editor,
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("lets a trusted read bypass the stored rule", async () => {
    const { service, accessControlService } = createService(false);

    const result = await service.get("site-settings", {
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
    expect(accessControlService.evaluateAccess).not.toHaveBeenCalled();
  });
});

/**
 * Enforcement of related-row field rules is opt-in, and the default matters: a
 * caller that supplies no access context cannot be told apart from an anonymous
 * one, so enforcing by default would strip protected related fields from every
 * caller of the mutation-response path, which passes no context at all.
 */
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
      { enforceFieldAccess: true, user: editor }
    );

    const options = expandRelationships.mock.calls[0][3];
    expect(options.enforceFieldAccess).toBe(true);
    expect(options.user).toMatchObject({ id: "user-1" });
  });
});
