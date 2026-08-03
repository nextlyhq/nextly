/**
 * A field validator nested in a field group sees the write's request context.
 *
 * A component instance is validated by its own pass, in this service, against
 * the component's own field set — the parent entry's validation never descends
 * into it. That pass used to run with no request at all, so a plugin field
 * type's `validate` was handed an empty `req` and a rule reading `req.user`
 * could not tell an authenticated write from an anonymous one. It failed OPEN:
 * the value was accepted, so nothing surfaced.
 *
 * Every shape a field group can take has its own save method and its own
 * pooled/transactional pair, which is why each is exercised rather than one
 * standing in for the rest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthorableFieldConfig } from "../../../collections/fields/types/plugin-field";
import { fieldGroup, pluginField } from "../../../config";
import { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";

import {
  createSilentLogger,
  createMockAdapter,
  createMockTxContext,
  createMockComponentRegistry,
  createMockRelationshipService,
} from "./field-group-test-helpers";

/** The signed-in caller a write is attributed to. */
const USER = { id: "u1", email: "editor@example.com" };

/** Every `req` the field type's validator was handed, in call order. */
let seen: Record<string, unknown>[] = [];

/**
 * A plugin field type whose rule depends on who is writing — the capability
 * that silently did nothing inside a field group. It records what it was given
 * so a test can assert on the context itself, not only on the verdict.
 */
function registerOwnerOnly(): void {
  registerFieldType({
    type: "owner-only",
    storage: "text",
    component: "@acme/owner/admin#OwnerOnlyInput",
    validate: (_value, args) => {
      seen.push(args.req);
      return args.req.user ? true : "Only a signed-in user may set a badge";
    },
  });
}

type Ctx = {
  service: FieldGroupDataService;
  adapter: ReturnType<typeof createMockAdapter>;
  registry: ReturnType<typeof createMockComponentRegistry>;
};

function createCtx(): Ctx {
  const adapter = createMockAdapter();
  const registry = createMockComponentRegistry();
  const service = new FieldGroupDataService(
    adapter as unknown as ConstructorParameters<
      typeof FieldGroupDataService
    >[0],
    createSilentLogger(),
    registry as unknown as ConstructorParameters<
      typeof FieldGroupDataService
    >[2],
    createMockRelationshipService() as unknown as ConstructorParameters<
      typeof FieldGroupDataService
    >[3]
  );
  return { service, adapter, registry };
}

/** A component holding one field of the request-dependent type. */
const BADGED_FIELDS: AuthorableFieldConfig[] = [
  pluginField({ name: "badge", type: "owner-only" }),
];

const badgeField = fieldGroup({ name: "badge", component: "badged" });

const badgeListField = fieldGroup({
  name: "badges",
  component: "badged",
  repeatable: true,
});

const badgeZoneField = fieldGroup({
  name: "zone",
  components: ["badged", "alsoBadged"],
  repeatable: true,
});

let ctx: Ctx;

beforeEach(() => {
  seen = [];
  registerOwnerOnly();
  ctx = createCtx();
  ctx.registry.registerComponent("badged", {
    slug: "badged",
    tableName: "comp_badged",
    fields: BADGED_FIELDS,
  });
  ctx.registry.registerComponent("alsoBadged", {
    slug: "alsoBadged",
    tableName: "comp_also_badged",
    fields: BADGED_FIELDS,
  });
});

afterEach(() => {
  clearFieldTypes();
});

/** A transaction context whose reads return no existing instances. */
function emptyTx() {
  return createMockTxContext({ select: vi.fn().mockResolvedValue([]) });
}

type TxParam = Parameters<
  FieldGroupDataService["saveComponentDataInTransaction"]
>[0];

describe("request context reaching a field group's validators", () => {
  it("forwards the request to a single component's validator", async () => {
    await ctx.service.saveComponentData({
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeField],
      data: { badge: { badge: "gold" } },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }]);
    expect(ctx.adapter.insert).toHaveBeenCalledTimes(1);
  });

  it("refuses the same write when there is no request behind it", async () => {
    // The control for every case here: it proves the validator runs at all, so
    // a passing case above cannot be a validator that was never reached.
    await expect(
      ctx.service.saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [badgeField],
        data: { badge: { badge: "gold" } },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(seen).toEqual([{}]);
    expect(ctx.adapter.insert).not.toHaveBeenCalled();
  });

  it("reports the refusal against the field, not as a bare message", async () => {
    // The write path wraps issues in an envelope, so the caller's own error
    // handling reads the path and code rather than parsing a sentence.
    const error = await ctx.service
      .saveComponentData({
        parentId: "entry-1",
        parentTable: "dc_pages",
        fields: [badgeField],
        data: { badge: { badge: "gold" } },
      })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "badge",
            code: "CUSTOM",
            message: "Only a signed-in user may set a badge.",
          },
        ],
      },
    });
  });

  it("forwards the request inside a transaction", async () => {
    const tx = emptyTx();

    await ctx.service.saveComponentDataInTransaction(tx as unknown as TxParam, {
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeField],
      data: { badge: { badge: "gold" } },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }]);
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it("forwards it to every instance of a repeatable field group", async () => {
    await ctx.service.saveComponentData({
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeListField],
      data: { badges: [{ badge: "gold" }, { badge: "silver" }] },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }, { user: USER }]);
    expect(ctx.adapter.insert).toHaveBeenCalledTimes(2);
  });

  it("forwards it to a repeatable field group inside a transaction", async () => {
    const tx = emptyTx();

    await ctx.service.saveComponentDataInTransaction(tx as unknown as TxParam, {
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeListField],
      data: { badges: [{ badge: "gold" }, { badge: "silver" }] },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }, { user: USER }]);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it("forwards it across the component types of a dynamic zone", async () => {
    await ctx.service.saveComponentData({
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeZoneField],
      data: {
        zone: [
          { _componentType: "badged", badge: "gold" },
          { _componentType: "alsoBadged", badge: "silver" },
        ],
      },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }, { user: USER }]);
    expect(ctx.adapter.insert).toHaveBeenCalledTimes(2);
  });

  it("forwards it across a dynamic zone inside a transaction", async () => {
    const tx = emptyTx();

    await ctx.service.saveComponentDataInTransaction(tx as unknown as TxParam, {
      parentId: "entry-1",
      parentTable: "dc_pages",
      fields: [badgeZoneField],
      data: {
        zone: [
          { _componentType: "badged", badge: "gold" },
          { _componentType: "alsoBadged", badge: "silver" },
        ],
      },
      req: { user: USER },
    });

    expect(seen).toEqual([{ user: USER }, { user: USER }]);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });
});
