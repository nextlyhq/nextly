/**
 * The Direct API's collection gate, in a setup with no access-control service,
 * judges a visitor by the Public role its own database holds.
 *
 * Without the service a signed-in caller's grants are read on the service's
 * own database, with its dialect's tables
 * (`collection-access-without-access-control.test.ts`), because such a setup
 * may have no global container, or one filled for another instance. A
 * visitor is the same question asked of the Public role, so it is read there
 * too: both whether boot seeding recorded making the role, in that database's
 * `nextly_meta`, and the role's grants. No container is registered here at
 * all, so a read through it fails the check with a 500, and the database's
 * Public role decides only when it is the one read.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";

import { CollectionAccessService } from "./collection-access-service";

import {
  createMockAdapter,
  silentLogger,
} from "../__tests__/collection-test-helpers";

vi.mock("../../../di/container", () => ({
  container: {
    has: () => false,
    get: (name: string) => {
      throw new Error(`Service "${name}" is not registered in container`);
    },
  },
}));

// The postgresql tables this file reads; the unit setup loads only the run's
// own dialect, as an app's adapter would.
beforeAll(async () => {
  await loadDialectTables("postgresql");
});

type GrantRow = { slug: string; action: string; resource: string };

/**
 * The service's own database: `nextly_meta` records the Public role as made,
 * the role lookup finds it, and its grants are `grants`. Every select is
 * answered by what it projects.
 */
function ownDatabase(grants: GrantRow[]) {
  return {
    select(projection?: Record<string, unknown>) {
      const rows =
        projection === undefined
          ? [{ key: "public-role-created", value: JSON.stringify("created") }]
          : "slug" in projection
            ? grants
            : [{ id: "role-public" }];
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  };
}

/** A visitor's checked read of `pages`, on a service built over `db`. */
function visitorReadsPages(db: ReturnType<typeof ownDatabase>) {
  const service = new CollectionAccessService(
    createMockAdapter(db) as never,
    silentLogger as never
  );
  return service.checkCollectionAccess({
    collectionName: "pages",
    operation: "read",
    overrideAccess: false,
  });
}

describe("a visitor at the collection gate with no access-control service", () => {
  it("is served what the Public role on the service's own database grants", async () => {
    const result = await visitorReadsPages(
      ownDatabase([{ slug: "read-pages", action: "read", resource: "pages" }])
    );

    expect(result).toBeNull();
  });

  it("is refused, as needing sign-in, what that Public role does not grant", async () => {
    // The control: the same database, its Public role granting another
    // collection's read only, refuses this one rather than failing to read.
    const result = await visitorReadsPages(
      ownDatabase([{ slug: "read-posts", action: "read", resource: "posts" }])
    );

    expect(result?.statusCode).toBe(403);
    expect(result?.refusalReason).toBe(
      "read on pages requires an authenticated user"
    );
  });
});
