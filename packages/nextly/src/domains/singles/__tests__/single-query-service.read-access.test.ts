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
  accessRules: Record<string, unknown> | undefined = ROLE_BASED_READ
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

  it("leaves a Single with no read rule publicly readable", async () => {
    // The standalone GET route is deliberately public (it serves public
    // frontends) and forwards no caller, so an unrestricted Single has to keep
    // reading anonymously. Enforcement must only bite where a rule exists.
    const { service } = createService(true, undefined);

    const result = await service.get("site-settings", {});

    expect(result.success).toBe(true);
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
 * Owner-only reads, against the REAL AccessControlService.
 *
 * These deliberately do not mock the evaluator. For a read it does not return a
 * decision at all: `evaluateOwnerAccess` reports `allowed: true` whoever owns
 * the row and hands back the predicate a LIST would have filtered by. A mocked
 * `allowed: false` is a value the real evaluator never produces for this rule,
 * so a test built on one proves nothing about ownership and hides a read path
 * that admits everybody.
 */
describe("SingleQueryService.get — owner-only reads (real evaluator)", () => {
  const OWNER_ONLY_READ = { read: { type: "owner-only" as const } };

  function createOwnerOnlyService(row: Record<string, unknown> | null) {
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({ accessRules: OWNER_ONLY_READ }),
      fields: [textField("siteName")],
    });
    const selectOne = vi.fn().mockResolvedValue(row);
    const insert = vi.fn().mockResolvedValue({ id: "doc1" });

    const service = new SingleQueryService(
      createMockAdapter({ selectOne, insert }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3],
      undefined,
      createMockRBACService(true) as unknown as Ctor[5]
      // No accessControlService override: the real one is constructed, which is
      // the entire point of these tests.
    );
    return { service, selectOne, insert };
  }

  it("denies a caller who does not own the row", async () => {
    const { service } = createOwnerOnlyService({
      id: "doc1",
      created_by: "someone-else",
      siteName: "Nextly",
    });

    const result = await service.get("site-settings", {
      user: { id: "not-the-owner" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("admits the owner", async () => {
    const { service } = createOwnerOnlyService({
      id: "doc1",
      created_by: "owner-1",
      siteName: "Nextly",
    });

    const result = await service.get("site-settings", {
      user: { id: "owner-1" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts the camelCase spelling of the owner column", async () => {
    const { service } = createOwnerOnlyService({
      id: "doc1",
      createdBy: "owner-1",
      siteName: "Nextly",
    });

    const result = await service.get("site-settings", {
      user: { id: "owner-1" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
  });

  it("denies without auto-creating when the row does not exist", async () => {
    // Auto-create would permanently materialize an unowned document, plus its
    // first version and localized defaults, for a caller the rule may not
    // admit — a write triggered by a read that is about to be refused.
    const { service, insert } = createOwnerOnlyService(null);

    const result = await service.get("site-settings", {
      user: { id: "someone" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it("lets a trusted read through untouched", async () => {
    const { service } = createOwnerOnlyService({
      id: "doc1",
      created_by: "someone-else",
    });

    const result = await service.get("site-settings", {
      overrideAccess: true,
    });

    expect(result.success).toBe(true);
  });
});

/**
 * Custom read rules are consulted on Singles.
 *
 * A custom function may answer with a boolean or with a query constraint; the
 * constraint is applied BY THE DATABASE as the filter on a single-row fetch, so
 * the predicate a list read compiles is the one that decides. End-to-end
 * behaviour is covered by `custom-read-constraint.integration.test.ts`, which
 * needs a real schema; this pins that the rule is reached at all.
 */
describe("SingleQueryService.get — custom read rules are consulted", () => {
  function createCustomRuleService(row: Record<string, unknown> | null) {
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({
        accessRules: { read: { type: "custom", functionPath: "./rule" } },
      }),
      fields: [textField("siteName")],
    });
    const evaluateAccess = vi.fn();
    const service = new SingleQueryService(
      createMockAdapter({
        selectOne: vi.fn().mockResolvedValue(row),
      }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3],
      undefined,
      createMockRBACService(true) as unknown as Ctor[5],
      undefined,
      { evaluateAccess } as unknown as Ctor[7]
    );
    return { service, evaluateAccess };
  }

  it("consults the rule rather than reading through", async () => {
    const { service, evaluateAccess } = createCustomRuleService({
      id: "doc1",
      siteName: "Nextly",
    });

    const result = await service.get("site-settings", {
      user: { id: "u1" },
      routeAuthorized: true,
    });

    // The rule decides. A stub returning no verdict denies, which is the safe
    // direction; what matters here is that it was asked.
    expect(evaluateAccess).toHaveBeenCalled();
    void result;
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
