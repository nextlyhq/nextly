/**
 * Every road that writes a new address gives the rule's verdict and reason.
 *
 * One list of addresses is handed to each road's own check, as the road runs
 * it, and each verdict is compared with `judgeAddress`. A road that kept a rule
 * of its own (as three did before this rule) fails here for the address it
 * judges differently. The Builder's Single create and the field-group service
 * are judged with the same list beside their harnesses
 * (`single-dispatcher-ddl.test.ts`, `field-group-metadata-apply-contract.test.ts`), as are the
 * Builder's collection create (`collections-handler-address.test.ts`), the field-group Direct API
 * (`field-groups-address-rule.test.ts`), a configuration reload under `next dev`
 * (`reload-config.test.ts`) and the migrate commands (`migrate-create/__tests__/addresses.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createFieldGroup = vi.fn();
const registerCollection = vi.fn();

vi.mock("../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "fieldGroupMetadataService"
      ? { createFieldGroup }
      : { registerCollection }
  ),
  isServicesRegistered: vi.fn(() => true),
}));

vi.mock("../../init", () => ({
  getCachedNextly: vi.fn(async () => undefined),
}));

vi.mock("../../api/route-auth", () => ({
  requireRouteAnyPermission: vi.fn(async () => undefined),
  requireRouteAllPermissions: vi.fn(async () => undefined),
  requireRouteAuthentication: vi.fn(async () => undefined),
}));

import { validateCollectionConfig } from "../../collections/config/validate-config";
import { DynamicCollectionValidationService } from "../../domains/dynamic-collections/services/dynamic-collection-validation-service";
import { validateFieldGroupConfig } from "../../field-groups/config/validate-field-group";
import { validateSingleConfig } from "../../singles/config/validate-single";
import {
  type AddressKind,
  assertConfiguredAddresses,
  judgeAddress,
} from "../address-rule";

import { ADDRESS_CASES } from "./helpers/address-cases";

/** The verdict as a road reports it: the refusal's message, or `null`. */
type Verdict = string | null;

const rule = (kind: AddressKind, address: string): Verdict =>
  judgeAddress(kind, address)?.message ?? null;

/** The message a thrown refusal carries, from a plain or a validation error. */
function refusalMessage(error: unknown): string {
  const data = (error as { publicData?: { errors?: { message: string }[] } })
    .publicData;
  return data?.errors?.[0]?.message ?? (error as Error).message;
}

/**
 * Configuration in code: the `define*` check at import, then the start's
 * check of an address no registry row holds yet.
 */
async function configuredRoad(
  kind: AddressKind,
  address: string
): Promise<Verdict> {
  const definition = { slug: address, fields: [] };
  const errors =
    kind === "collection"
      ? validateCollectionConfig(definition as never).errors
      : kind === "single"
        ? validateSingleConfig(definition as never).errors
        : validateFieldGroupConfig(definition as never).errors;
  const slugError = errors.find(e => e.path === "slug");
  if (slugError) return slugError.message;
  const key = {
    collection: "collections",
    single: "singles",
    fieldGroup: "fieldGroups",
  }[kind];
  try {
    await assertConfiguredAddresses(
      { [key]: [{ slug: address }] },
      { collections: [], singles: [], components: [] },
      async () => false
    );
    return null;
  } catch (error) {
    return refusalMessage(error);
  }
}

function builderCollectionRoad(address: string): Verdict {
  try {
    new DynamicCollectionValidationService().validateCollectionName(address);
    return null;
  } catch (error) {
    return refusalMessage(error);
  }
}

async function routeRefusal(response: Response): Promise<Verdict> {
  if (response.ok) return null;
  const body = (await response.json()) as {
    error: { data?: { errors?: { message: string }[] } };
  };
  return body.error.data?.errors?.[0]?.message ?? null;
}

async function collectionsSchemaRoad(address: string): Promise<Verdict> {
  const { POST } = await import("../../api/collections-schema");
  return routeRefusal(
    await POST(
      new Request("http://localhost/api/collections-schema", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: address,
          labels: { singular: "Thing" },
          fields: [],
        }),
      })
    )
  );
}

async function fieldGroupsRoad(address: string): Promise<Verdict> {
  const { POST } = await import("../../api/field-groups");
  return routeRefusal(
    await POST(
      new Request("http://localhost/api/field-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: address, label: "Thing", fields: [] }),
      })
    )
  );
}

beforeEach(() => {
  createFieldGroup.mockReset();
  createFieldGroup.mockResolvedValue({
    record: { id: "fg-1", slug: "x", label: "X", fields: [] },
    migrationStatus: "applied",
  });
  registerCollection.mockReset();
  registerCollection.mockResolvedValue({ id: "c-1", slug: "x", fields: [] });
});

describe.each(ADDRESS_CASES)("the address '%s'", address => {
  it("gets the rule's verdict from configuration, for every kind", async () => {
    for (const kind of ["collection", "single", "fieldGroup"] as const) {
      expect(await configuredRoad(kind, address), kind).toBe(
        rule(kind, address)
      );
    }
  });

  it("gets the rule's verdict from the Builder's collection create", () => {
    expect(builderCollectionRoad(address)).toBe(rule("collection", address));
  });

  it("gets the rule's verdict from the collection schema endpoint", async () => {
    expect(await collectionsSchemaRoad(address)).toBe(
      rule("collection", address)
    );
  });

  it("gets the rule's verdict from the field-group endpoint", async () => {
    expect(await fieldGroupsRoad(address)).toBe(rule("fieldGroup", address));
  });
});

describe("configuration at start", () => {
  it("refuses a new address with the same snake_case form as a registered one", async () => {
    await expect(
      assertConfiguredAddresses(
        { singles: [{ slug: "team_updates" }] },
        {
          collections: [{ slug: "team-updates" }],
          singles: [],
          components: [],
        },
        async () => false
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ code: "SLUG_SAME_SNAKE_CASE" }] },
    });
  });

  it("keeps an entity a registry row already holds, whatever the rule says of its address", async () => {
    await expect(
      assertConfiguredAddresses(
        {
          collections: [{ slug: "cascade" }, { slug: "team-updates" }],
          singles: [{ slug: "team_updates" }],
        },
        {
          collections: [{ slug: "cascade" }, { slug: "team-updates" }],
          singles: [{ slug: "team_updates" }],
          components: [],
        },
        async () => false
      )
    ).resolves.toBeUndefined();
  });
});
