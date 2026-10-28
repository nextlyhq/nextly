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
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../../../auth/authenticated-scope";
import { loadDialectTables } from "../../../database/dialect-tables";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import type { AccessRuleContext } from "../../../shared/types/access";
import { SingleEntryService } from "../services/single-entry-service";

import {
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

    expect(result.statusCode).toBe(403);
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
