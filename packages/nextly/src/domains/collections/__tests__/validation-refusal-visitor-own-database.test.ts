/**
 * A visitor's validation refusal is judged by the same Public role as the
 * collection gate above it: in a setup with no access-control service, the
 * one the service's own database records.
 *
 * Whether an issue names a field is the read redaction's answer. A field rule
 * asking `permissions.includes("read-prices")` must be handed the visitor's
 * grants as the gate reads them, or a refusal names a field another
 * instance's Public role lets them read and this database's does not.
 *
 * `listPublicGrants` answers by where it is asked: on a database of the
 * caller's own (`own` given) as that database records Public, otherwise as the
 * process's container records it. The two disagree only on `read-prices`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { GrantedPermission } from "../../../auth/authenticated-scope";

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

vi.mock("../../../di/container", () => ({
  container: {
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../database/index", () => ({
  getDialectTables: vi.fn(() => ({})),
}));

vi.mock("../../../collections/fields/guards", () => ({
  isFieldGroupField: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../services/collections/query-operators", () => ({
  buildWhereClause: vi.fn().mockReturnValue(null),
  extractGeoFilters: vi.fn((where: unknown) => ({
    geoFilters: [],
    cleanedWhere: where,
  })),
  extractComponentFieldConditions: vi.fn((where: unknown) => ({
    componentFilters: [],
    cleanedWhere: where,
  })),
  componentFilterTargets: vi.fn(() => []),
}));

import { loadDialectTables } from "../../../database/dialect-tables";
import { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import { UNREADABLE_FIELD_ISSUE } from "../../../shared/lib/unreadable-field-issues";
import type { AccessRuleContext } from "../../../shared/types/access";

import {
  createMockAdapter,
  createMockCollectionService,
  createMockComponentDataService,
  createMockDb,
  createMockFileManager,
  createMockHookRegistry,
  createMockRbacAccessControlService,
  createMockRelationshipService,
  createMockSchema,
  createSampleEntry,
  silentLogger,
} from "./collection-test-helpers";

// The postgresql tables this file reads; the unit setup loads only the run's
// own dialect, as an app's adapter would.
beforeAll(async () => {
  await loadDialectTables("postgresql");
});

const READ_POSTS: GrantedPermission = {
  slug: "read-posts",
  action: "read",
  resource: "posts",
};
const CREATE_POSTS: GrantedPermission = {
  slug: "create-posts",
  action: "create",
  resource: "posts",
};
const READ_PRICES: GrantedPermission = {
  slug: "read-prices",
  action: "read",
  resource: "prices",
};

/** A service over a mocked database, with or without the access service. */
function entryService(withAccessService: boolean) {
  const db = createMockDb({ rows: [createSampleEntry()] });
  return new CollectionEntryService(
    createMockAdapter(db) as never,
    silentLogger as never,
    createMockFileManager(createMockSchema()) as never,
    createMockCollectionService() as never,
    createMockRelationshipService() as never,
    createMockHookRegistry() as never,
    createMockComponentDataService() as never,
    withAccessService
      ? (createMockRbacAccessControlService() as never)
      : undefined
  );
}

/**
 * `title`, and a `price` readable only by a caller holding `read-prices`,
 * whose validator names the value it refuses.
 */
const PRICED_FIELDS = [
  { name: "title" },
  {
    name: "price",
    access: {
      read: ({ permissions }: AccessRuleContext) =>
        permissions.includes("read-prices"),
    },
    validate: (value: unknown) => `Price ${String(value)} is not allowed`,
  },
];

afterEach(() => {
  clearFieldFunctions();
  publicRole.ownDatabase = [];
  publicRole.process = [];
});

describe("a visitor's validation refusal with no access-control service", () => {
  it("withholds a field only another instance's Public role lets them read", async () => {
    registerFieldFunctions("collection", "posts", PRICED_FIELDS);
    publicRole.ownDatabase = [CREATE_POSTS, READ_POSTS];
    publicRole.process = [CREATE_POSTS, READ_POSTS, READ_PRICES];

    const result = await entryService(false).createEntry(
      { collectionName: "posts", overrideAccess: false },
      { title: "A post", price: 99 }
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(JSON.stringify(result)).not.toContain("Price 99");
    expect(
      (result as { publicData?: { errors?: unknown[] } }).publicData?.errors
    ).toEqual([UNREADABLE_FIELD_ISSUE]);
  });

  it("names a field this database's Public role lets them read", async () => {
    registerFieldFunctions("collection", "posts", PRICED_FIELDS);
    publicRole.ownDatabase = [CREATE_POSTS, READ_POSTS, READ_PRICES];
    publicRole.process = [CREATE_POSTS, READ_POSTS];

    const result = await entryService(false).createEntry(
      { collectionName: "posts", overrideAccess: false },
      { title: "A post", price: 99 }
    );

    expect(result.statusCode).toBe(400);
    expect(
      (result as { publicData?: { errors?: unknown[] } }).publicData?.errors
    ).toEqual([
      { path: "price", code: "CUSTOM", message: "Price 99 is not allowed." },
    ]);
  });
});
