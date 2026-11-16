/**
 * Every entity's permissions come out the same whichever road seeds them, on
 * every dialect.
 *
 * Two roads ensure an entity's permissions: the registry sync, one entity at a
 * time, for a caller with no seeding to follow (the CLI, the test harness, a
 * Schema Builder save); and a start's own seeding, every entity against one
 * read of the table, which the sync leaves them to while a start holds the
 * seeding gate. The same configuration through each must leave the same rows:
 * the same permissions, spelled the same, with the same provenance.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../../config";
import { getService } from "../../../../di/service-access";
import {
  holdBootSeeding,
  seedAllPermissions,
} from "../../../../init/seed-permissions";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { PermissionService } from "../permission-service";

const COLLECTIONS = [
  defineCollection({ slug: "parity-posts", fields: [text({ name: "title" })] }),
  // Draft/Published, which adds the publish lifecycle's permissions.
  defineCollection({
    slug: "parity-pages",
    status: true,
    fields: [text({ name: "title" })],
  }),
];
const SINGLES = [
  defineSingle({ slug: "parity-site", fields: [text({ name: "title" })] }),
];

/** The entity permissions stored, as a seeder writes them, in one order. */
async function entityPermissions(t: TestNextly): Promise<unknown[]> {
  const rows = await new PermissionService(
    t.adapter as never,
    getService("logger")
  ).permissionRows();
  return rows
    .filter(row => String(row.resource).startsWith("parity-"))
    .map(({ id: _id, ...rest }) => rest)
    .sort((a, b) =>
      `${String(a.action)} ${String(a.resource)}`.localeCompare(
        `${String(b.action)} ${String(b.resource)}`
      )
    );
}

describeEachDialect("an entity's permissions, by either road", dialect => {
  let current: TestNextly | undefined;

  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  it("are the same seeded one entity at a time as all at once", async () => {
    // The registry sync seeds each entity as it registers it.
    const synced = await createTestNextly({
      dialect,
      collections: COLLECTIONS,
      singles: SINGLES,
    });
    current = synced;
    const oneAtATime = await entityPermissions(synced);
    await synced.destroy();
    current = undefined;

    // A start holds the seeding gate, so the sync leaves them to the start's
    // own seeding, which ensures them all against one read.
    let allAtOnce: unknown[] = [];
    const release = holdBootSeeding();
    try {
      const started = await createTestNextly({
        dialect,
        collections: COLLECTIONS,
        singles: SINGLES,
      });
      current = started;
      expect(await entityPermissions(started)).toEqual([]);
      await seedAllPermissions();
      allAtOnce = await entityPermissions(started);
    } finally {
      release();
    }

    expect(oneAtATime.length).toBeGreaterThan(0);
    expect(allAtOnce).toEqual(oneAtATime);
  }, 240_000);

  it("checks each resource against the registries on either road", async () => {
    current = await createTestNextly({
      dialect,
      collections: COLLECTIONS,
      singles: SINGLES,
    });
    const warn = vi.fn();
    const logger = { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const service = new PermissionService(
      current.adapter as never,
      logger as never
    );
    /** The resources a road's check warned about. */
    const warnedAbout = () =>
      warn.mock.calls
        .map(([message]) => String(message))
        .flatMap(message => message.match(/"([^"]+)"/)?.slice(1) ?? []);
    const declaration = (resource: string) => ({
      action: "read",
      resource,
      name: `Read ${resource}`,
      slug: `read-${resource}`,
    });

    // One permission at a time.
    for (const resource of ["parity-posts", "users", "parity-one"]) {
      const { name, slug } = declaration(resource);
      await service.ensurePermission("read", resource, name, slug);
    }
    const oneAtATime = warnedAbout();
    warn.mockClear();

    // Many at once: the same check, for a registered collection, a system
    // resource and a resource no registry holds.
    await service.ensurePermissions(
      ["parity-site", "users", "parity-many"].map(declaration)
    );
    const allAtOnce = warnedAbout();

    expect(oneAtATime).toEqual(["parity-one"]);
    expect(allAtOnce).toEqual(["parity-many"]);
  }, 240_000);
});
