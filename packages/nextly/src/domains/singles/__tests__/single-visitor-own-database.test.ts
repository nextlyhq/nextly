/**
 * A Single read through a service that holds its own database and no
 * access-control service judges a visitor by the Public role THAT database
 * records, at the gate and in the Single's field rules alike.
 *
 * The collection gate already reads Public there, since such a setup may have
 * no global container, or one filled for another Nextly instance. The Single
 * gate is the same question, so a visitor's read of a Single must not be
 * answered by the process's Public role instead: that answer is a 500 where
 * the container is unset, and another instance's grants where it is filled
 * for one. Its field rules are handed the same Public role as its gate, so
 * one read is never judged by two.
 *
 * `listPublicGrants` answers by where it is asked: on a database of the
 * caller's own (`own` given) as that database records Public, otherwise as
 * the process's container records it. Each case makes the two disagree on
 * exactly the grant that decides it.
 *
 * Control: with an access-control service the gate and the field rules read
 * Public on the pool, so production keeps the process's cached read.
 *
 * A visitor's update is judged the same way all the way down: the rules
 * declared on a field group's own fields are handed the Public role of the
 * service's database too, so a field group the Single saves is never judged
 * by another instance's grants while the Single itself is judged by its own.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../../../auth/authenticated-scope";
import { loadDialectTables } from "../../../database/dialect-tables";
import { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import type { AccessRuleContext } from "../../../shared/types/access";
import {
  createMockComponentRegistry,
  createMockRelationshipService,
} from "../../field-groups/__tests__/field-group-test-helpers";
import { SingleEntryService } from "../services/single-entry-service";

import {
  componentFieldDef,
  createMockAdapter,
  createMockHookRegistry,
  createMockRBACService,
  createMockSingleRegistry,
  createSilentLogger,
  siteSettingsMeta,
  textField,
} from "./single-test-helpers";

const publicRole = vi.hoisted(() => ({
  ownDatabase: [] as GrantedPermission[],
  process: [] as GrantedPermission[],
}));

vi.mock("../../../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../services/lib/permissions")
  >()),
  listPublicGrants: vi.fn(async (_executor?: unknown, own?: unknown) =>
    own === undefined ? publicRole.process : publicRole.ownDatabase
  ),
}));

// The postgresql tables the service's own database is read with; the unit
// setup loads only the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await loadDialectTables("postgresql");
});

const READ_SITE_SETTINGS: GrantedPermission = {
  slug: "read-site-settings",
  action: "read",
  resource: "site-settings",
};
const READ_PRICES: GrantedPermission = {
  slug: "read-prices",
  action: "read",
  resource: "prices",
};

/** `siteName`, and a `price` readable only by a caller holding `read-prices`. */
const PRICED_FIELDS = [
  textField("siteName"),
  {
    name: "price",
    type: "number" as const,
    access: {
      read: ({ permissions }: AccessRuleContext) =>
        permissions.includes("read-prices"),
    },
  },
];

type Ctor = ConstructorParameters<typeof SingleEntryService>;

/** A Single service over its own mocked database, with or without the access service. */
function singleService(withAccessService: boolean) {
  const registry = createMockSingleRegistry();
  registry.registerSingle(
    "site-settings",
    siteSettingsMeta({ fields: PRICED_FIELDS })
  );
  const adapter = createMockAdapter({
    selectOne: vi.fn().mockResolvedValue({
      id: "doc-1",
      siteName: "Nextly",
      price: 100,
      status: null,
    }),
  });
  return new SingleEntryService(
    adapter as unknown as Ctor[0],
    createSilentLogger(),
    registry as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    undefined,
    withAccessService
      ? (createMockRBACService() as unknown as Ctor[5])
      : undefined
  );
}

/** A visitor's checked read of the Single, as the service answers it. */
function visitorReadsSiteSettings(withAccessService = false) {
  registerFieldFunctions("single", "site-settings", PRICED_FIELDS);
  return singleService(withAccessService).get("site-settings", {
    overrideAccess: false,
  });
}

afterEach(() => {
  clearFieldFunctions();
  publicRole.ownDatabase = [];
  publicRole.process = [];
});

describe("a visitor at the Single gate with no access-control service", () => {
  it("is served what the Public role on the service's own database grants", async () => {
    publicRole.ownDatabase = [READ_SITE_SETTINGS];
    publicRole.process = [];

    const result = await visitorReadsSiteSettings();

    expect(result.statusCode).toBe(200);
    expect(result.data).toMatchObject({ siteName: "Nextly" });
  });

  it("is refused, as needing sign-in, what only another instance's Public role grants", async () => {
    publicRole.ownDatabase = [];
    publicRole.process = [READ_SITE_SETTINGS];

    const result = await visitorReadsSiteSettings();

    // A caller with no identity is asked to sign in (401).
    expect(result.statusCode).toBe(401);
    expect(result.refusalReason).toBe(
      'read on single "site-settings" requires an authenticated user'
    );
  });
});

describe("a visitor's field rule on a Single with no access-control service", () => {
  it("keeps a field the Public role on the service's own database grants", async () => {
    publicRole.ownDatabase = [READ_SITE_SETTINGS, READ_PRICES];
    publicRole.process = [READ_SITE_SETTINGS];

    const result = await visitorReadsSiteSettings();

    expect(result.statusCode).toBe(200);
    expect(result.data).toMatchObject({ siteName: "Nextly", price: 100 });
  });

  it("strips a field only another instance's Public role grants", async () => {
    publicRole.ownDatabase = [READ_SITE_SETTINGS];
    publicRole.process = [READ_SITE_SETTINGS, READ_PRICES];

    const result = await visitorReadsSiteSettings();

    expect(result.statusCode).toBe(200);
    expect(result.data).toMatchObject({ siteName: "Nextly" });
    expect(result.data).not.toHaveProperty("price");
  });
});

describe("a visitor's Single read with an access-control service", () => {
  it("is judged by the Public role the process reads, gate and field rule alike", async () => {
    publicRole.ownDatabase = [];
    publicRole.process = [READ_SITE_SETTINGS, READ_PRICES];

    const result = await visitorReadsSiteSettings(true);

    expect(result.statusCode).toBe(200);
    expect(result.data).toMatchObject({ siteName: "Nextly", price: 100 });
  });
});

const UPDATE_SITE_SETTINGS: GrantedPermission = {
  slug: "update-site-settings",
  action: "update",
  resource: "site-settings",
};
const EDIT_CANONICAL_LINKS: GrantedPermission = {
  slug: "update-canonical-links",
  action: "update",
  resource: "canonical-links",
};

/**
 * The `seo` field group: `metaTitle`, and a `canonical` only a writer holding
 * `update-canonical-links` may set, whether its instance is new or stored.
 */
const SEO_FIELDS = [textField("metaTitle"), textField("canonical")];
const writesCanonicalLinks = ({ permissions }: AccessRuleContext) =>
  permissions.includes("update-canonical-links");
const SEO_FIELD_RULES = [
  {
    name: "canonical",
    access: { create: writesCanonicalLinks, update: writesCanonicalLinks },
  },
];
const SEO_SINGLE_FIELDS = [textField("siteName"), componentFieldDef("seo")];

/**
 * A visitor's checked update of a Single holding the `seo` field group,
 * through a service over its own mocked database with no access-control
 * service, saved by a real field-group service so the group's own rules run.
 * Answers the row the group's instance was stored with.
 */
async function visitorUpdatesSeo(): Promise<Record<string, unknown>> {
  const registry = createMockSingleRegistry();
  registry.registerSingle(
    "site-settings",
    siteSettingsMeta({ fields: SEO_SINGLE_FIELDS })
  );
  // No instance stored yet, so the visitor's value creates one.
  const adapter = createMockAdapter({
    selectOne: vi.fn().mockResolvedValue({
      id: "doc-1",
      siteName: "Nextly",
      status: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    }),
  });
  const components = createMockComponentRegistry();
  components.registerComponent("seo", {
    slug: "seo",
    tableName: "comp_seo",
    fields: SEO_FIELDS,
  });
  registerFieldFunctions("fieldGroup", "seo", SEO_FIELD_RULES);
  type GroupCtor = ConstructorParameters<typeof FieldGroupDataService>;
  const fieldGroups = new FieldGroupDataService(
    adapter as unknown as GroupCtor[0],
    createSilentLogger(),
    components as unknown as GroupCtor[2],
    createMockRelationshipService() as unknown as GroupCtor[3]
  );
  const service = new SingleEntryService(
    adapter as unknown as Ctor[0],
    createSilentLogger(),
    registry as unknown as Ctor[2],
    createMockHookRegistry() as unknown as Ctor[3],
    fieldGroups as unknown as Ctor[4]
  );

  await service.update(
    "site-settings",
    { seo: { metaTitle: "Home", canonical: "https://example.com/" } },
    { overrideAccess: false }
  );

  const stored = adapter.insert.mock.calls.find(
    ([table]: [string]) => table === "comp_seo"
  );
  expect(stored).toBeDefined();
  return stored?.[1] as Record<string, unknown>;
}

describe("a visitor's field-group rule on a Single update with no access-control service", () => {
  it("stores a field the Public role on the service's own database grants", async () => {
    publicRole.ownDatabase = [UPDATE_SITE_SETTINGS, EDIT_CANONICAL_LINKS];
    publicRole.process = [UPDATE_SITE_SETTINGS];

    const row = await visitorUpdatesSeo();

    expect(row).toMatchObject({
      meta_title: "Home",
      canonical: "https://example.com/",
    });
  });

  it("does not store a field only another instance's Public role grants", async () => {
    publicRole.ownDatabase = [UPDATE_SITE_SETTINGS];
    publicRole.process = [UPDATE_SITE_SETTINGS, EDIT_CANONICAL_LINKS];

    const row = await visitorUpdatesSeo();

    expect(row).toMatchObject({ meta_title: "Home" });
    expect(row.canonical ?? null).toBeNull();
  });
});
