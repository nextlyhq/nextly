/**
 * A visitor's field rule is judged by the same Public role as the collection
 * gate above it: in a setup with no access-control service, the one the
 * service's own database records.
 *
 * Without the service the collection gate reads Public on the service's own
 * database, since such a setup may have no global container, or one filled
 * for another Nextly instance. A field rule asking
 * `permissions.includes("read-prices")` must be handed the same grants, or a
 * read the gate allows strips a field the database's Public role grants, or
 * keeps one it does not because another instance's Public role grants it.
 * A populated related row is judged the same way, by its target's rules.
 *
 * `listPublicGrants` answers by where it is asked: on a database of the
 * caller's own (`own` given) as that database records Public, otherwise as
 * the process's container records it. The two disagree only on
 * `read-prices`, so which one a field rule was handed decides the field.
 *
 * Control: with an access-control service the gate reads Public on the pool,
 * and so does the field rule, so production keeps the process's cached read.
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
import { CollectionRelationshipService } from "../services/collection-relationship-service";

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
const READ_MEMBERS: GrantedPermission = {
  slug: "read-members",
  action: "read",
  resource: "members",
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

/** `title`, and a `price` readable only by a caller holding `read-prices`. */
const PRICED_FIELDS = [
  { name: "title" },
  {
    name: "price",
    access: {
      read: ({ permissions }: AccessRuleContext) =>
        permissions.includes("read-prices"),
    },
  },
];

/** A visitor's checked read of one post, as the service answers it. */
async function visitorReadsPost(withAccessService = false) {
  registerFieldFunctions("collection", "posts", PRICED_FIELDS);
  const result = await entryService(withAccessService).getEntry({
    collectionName: "posts",
    entryId: "entry-1",
    overrideAccess: false,
  });
  expect(result.statusCode).toBe(200);
  return result.data as Record<string, unknown>;
}

afterEach(() => {
  clearFieldFunctions();
  publicRole.ownDatabase = [];
  publicRole.process = [];
});

describe("a visitor's field rule with no access-control service", () => {
  it("keeps a field the Public role on the service's own database grants", async () => {
    publicRole.ownDatabase = [READ_POSTS, READ_PRICES];
    publicRole.process = [READ_POSTS];

    const entry = await visitorReadsPost();

    expect(entry.title).toBe("Test Post");
    expect(entry.price).toBe(100);
  });

  it("strips a field only another instance's Public role grants", async () => {
    publicRole.ownDatabase = [READ_POSTS];
    publicRole.process = [READ_POSTS, READ_PRICES];

    const entry = await visitorReadsPost();

    expect(entry.title).toBe("Test Post");
    expect(entry).not.toHaveProperty("price");
  });
});

describe("a visitor's field rule on a related row with no access-control service", () => {
  /** A visitor's populated `members` row, its field rules enforced. */
  function visitorPopulatesMember() {
    registerFieldFunctions("collection", "members", PRICED_FIELDS);
    const db = createMockDb({
      rows: [{ id: "m1", title: "A member", price: 100 }],
    });
    // A table whose id column the read by id list can name.
    const fileManager = {
      loadDynamicSchema: vi.fn().mockResolvedValue({ id: {} }),
    };
    const service = new CollectionRelationshipService(
      createMockAdapter(db) as never,
      silentLogger as never,
      fileManager as never,
      // A collection with no lifecycle, so its one row is read as stored.
      {
        getCollection: vi.fn().mockResolvedValue({ fields: PRICED_FIELDS }),
      } as never
    );
    // The row gate runs too, by the Public role on the same database: a
    // checked read, trusting no target.
    return service.fetchRelatedEntry("members", "m1", {
      trusted: () => false,
      enforceFieldAccess: true,
    });
  }

  it("keeps a field the Public role on the service's own database grants", async () => {
    publicRole.ownDatabase = [READ_MEMBERS, READ_PRICES];
    publicRole.process = [READ_MEMBERS];

    const related = await visitorPopulatesMember();

    expect(related).toMatchObject({ id: "m1", price: 100 });
  });

  it("strips a field only another instance's Public role grants", async () => {
    publicRole.ownDatabase = [READ_MEMBERS];
    publicRole.process = [READ_MEMBERS, READ_PRICES];

    const related = await visitorPopulatesMember();

    expect(related).toMatchObject({ id: "m1", title: "A member" });
    expect(related).not.toHaveProperty("price");
  });
});

describe("a visitor's field rule with an access-control service", () => {
  it("is judged by the Public role the process reads, as the gate is", async () => {
    publicRole.ownDatabase = [READ_POSTS];
    publicRole.process = [READ_POSTS, READ_PRICES];

    const entry = await visitorReadsPost(true);

    expect(entry.price).toBe(100);
  });
});
