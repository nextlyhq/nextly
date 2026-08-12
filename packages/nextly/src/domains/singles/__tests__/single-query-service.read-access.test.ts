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

  function createOwnerOnlyService(
    row: Record<string, unknown> | null,
    hookRegistry: ReturnType<
      typeof createMockHookRegistry
    > = createMockHookRegistry()
  ) {
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
      hookRegistry as unknown as Ctor[3],
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

  it("refuses when the row loses its owner between the two reads", async () => {
    // Access is decided on a row read before the hooks, and the response is
    // read again after them. A `beforeRead` hook may write, and another writer
    // may reassign the owner column in between, so the row actually being
    // returned has to be judged too — otherwise the caller receives a document
    // someone else now owns.
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({ accessRules: OWNER_ONLY_READ }),
      fields: [textField("siteName")],
    });
    const selectOne = vi
      .fn()
      .mockResolvedValueOnce({ id: "doc1", created_by: "owner-1" })
      .mockResolvedValue({ id: "doc1", created_by: "someone-else" });

    const service = new SingleQueryService(
      createMockAdapter({ selectOne }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3],
      undefined,
      createMockRBACService(true) as unknown as Ctor[5]
    );

    const result = await service.get("site-settings", {
      user: { id: "owner-1" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("still admits the owner when a hook drops the owner value", async () => {
    // Ownership is settled once, against the stored row. An `afterRead` hook
    // shapes the RESPONSE and is free to drop the owner identifier from it, so
    // re-deciding ownership on what the hook produced refuses the caller the
    // stored row proves is the owner.
    const hookRegistry = createMockHookRegistry();
    hookRegistry.hasHooks = vi
      .fn()
      .mockImplementation((phase: string) => phase === "afterRead");
    hookRegistry.execute = vi
      .fn()
      .mockImplementation(
        async (_phase: string, ctx: { data: Record<string, unknown> }) => {
          const { created_by: _owner, ...rest } = ctx.data;
          return rest;
        }
      );

    const { service } = createOwnerOnlyService(
      { id: "doc1", created_by: "owner-1", siteName: "Nextly" },
      hookRegistry
    );

    const result = await service.get("site-settings", {
      user: { id: "owner-1" },
      routeAuthorized: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("created_by");
  });
});

/**
 * Custom read rules are consulted on Singles, and consulted early enough.
 *
 * The rule is judged against the document a caller would receive, assembled from
 * the stored row before any user code runs. Deciding on the way out instead
 * would let a caller the rule refuses trigger hooks on every attempt. End-to-end
 * behaviour is covered by `custom-read-constraint.integration.test.ts`, which
 * needs a real schema; this pins that the rule is reached, and reached first.
 */
describe("SingleQueryService.get — custom read rules are consulted", () => {
  function createCustomRuleService(
    row: Record<string, unknown> | null,
    evaluateAccess = vi.fn()
  ) {
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({
        accessRules: { read: { type: "custom", functionPath: "./rule" } },
      }),
      fields: [textField("siteName")],
    });
    const hookRegistry = createMockHookRegistry();
    hookRegistry.hasHooks = vi.fn().mockReturnValue(true);
    const service = new SingleQueryService(
      createMockAdapter({
        selectOne: vi.fn().mockResolvedValue(row),
      }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      hookRegistry as unknown as Ctor[3],
      undefined,
      createMockRBACService(true) as unknown as Ctor[5],
      undefined,
      { evaluateAccess } as unknown as Ctor[7]
    );
    return { service, evaluateAccess, hookRegistry };
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

  it("creates the Single from the very draft the rule judged", async () => {
    // The first read of an unmaterialized Single is authorized against the
    // document it would create. Building a second draft for the insert gives
    // the outgoing check a different identity than the rule was asked about,
    // so the same draft has to carry through.
    const { service } = createCustomRuleService(
      null,
      vi.fn().mockResolvedValue({ allowed: true })
    );
    const buildDraft = vi.spyOn(service, "buildDefaultDocument");

    await service.get("site-settings", {
      user: { id: "u1" },
      routeAuthorized: true,
    });

    expect(buildDraft).toHaveBeenCalledTimes(1);
  });

  it("runs no user hook for a caller the rule refuses", async () => {
    // Hooks are user code and can reach outside the process, so a read the rule
    // refuses must not be able to trigger them — otherwise an unauthorized
    // caller drives those side effects on every attempt.
    const { service, hookRegistry } = createCustomRuleService(
      { id: "doc1", siteName: "Nextly" },
      vi.fn().mockResolvedValue({ allowed: false, reason: "no" })
    );

    const result = await service.get("site-settings", {
      user: { id: "u1" },
      routeAuthorized: true,
    });

    expect(result.statusCode).toBe(403);
    expect(hookRegistry.execute).not.toHaveBeenCalled();
    expect(hookRegistry.executeBeforeOperation).not.toHaveBeenCalled();
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

  it("hides the underlying failure when a strict expansion throws", async () => {
    // The strict path exists for the authorization view, and a failure there
    // reaches the caller. `buildSingleErrorResult` puts a bare Error's own
    // message on the wire, which for a driver fault is schema detail.
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

    await expect(
      service.expandRelationshipFields(
        { id: "doc1", author: "a1" } as never,
        RELATION_FIELDS as never,
        1,
        { trusted: undefined },
        true
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("hides the underlying failure when strict component population throws", async () => {
    // The component path has its own strict mode, and its failures reach the
    // caller the same way a relationship failure does.
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({
        accessRules: { read: { type: "custom", functionPath: "./rule" } },
      }),
      fields: [textField("siteName")],
    });
    const fieldGroupDataService = {
      populateComponentData: vi
        .fn()
        .mockRejectedValue(new Error('no such table: "comp_hero"')),
    };
    const service = new SingleQueryService(
      createMockAdapter({
        selectOne: vi.fn().mockResolvedValue({ id: "doc1" }),
      }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3],
      fieldGroupDataService as unknown as Ctor[4],
      createMockRBACService(true) as unknown as Ctor[5],
      undefined,
      {
        evaluateAccess: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as Ctor[7]
    );

    const result = await service.get("site-settings", {
      user: { id: "u1" },
      routeAuthorized: true,
    });

    // Both halves matter: `not.toContain` alone holds for any failure, so the
    // status pins that this is the strict-component path refusing rather than
    // some earlier gate the mock happened to trip.
    expect(result.statusCode).toBe(500);
    expect(fieldGroupDataService.populateComponentData).toHaveBeenCalled();
    expect(result.message).not.toContain("comp_hero");
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

  it("hides the underlying failure when a strict overview read throws", async () => {
    // The overview read only throws for a caller that will judge on it, and the
    // result builder puts a bare Error's own message on the wire.
    const registry = createMockSingleRegistry();
    registry.registerSingle("site-settings", {
      ...siteSettingsMeta({
        accessRules: { read: { type: "custom", functionPath: "./rule" } },
        localized: true,
      }),
      fields: [textField("siteName")],
    });
    const service = new SingleQueryService(
      createMockAdapter({
        selectOne: vi.fn().mockResolvedValue({ id: "doc1" }),
      }) as unknown as Ctor[0],
      createSilentLogger() as unknown as Ctor[1],
      registry as unknown as Ctor[2],
      createMockHookRegistry() as unknown as Ctor[3],
      undefined,
      createMockRBACService(true) as unknown as Ctor[5],
      undefined,
      {
        evaluateAccess: vi.fn().mockResolvedValue({ allowed: true }),
      } as unknown as Ctor[7]
    );
    vi.spyOn(
      service as unknown as {
        populateTranslationMeta: () => Promise<void>;
      },
      "populateTranslationMeta"
    ).mockRejectedValue(new Error('permission denied for "branding_locales"'));

    const result = await service.get("site-settings", {
      user: { id: "u1" },
      routeAuthorized: true,
      translationStatus: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).not.toContain("branding_locales");
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
      { trusted: undefined, enforceFieldAccess: true, user: editor }
    );

    const options = expandRelationships.mock.calls[0][3];
    expect(options.enforceFieldAccess).toBe(true);
    expect(options.user).toMatchObject({ id: "user-1" });
  });
});
