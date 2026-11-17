/**
 * A collection create run in development is recorded applied only when its table holds every
 * requested column as the type asked for (`columnsTheCreateLeftOut`); a table standing under the
 * name with a column left out records the create failed. That the table exists says nothing about
 * its columns.
 *
 * The service's collaborators are stubbed: the lock runs its work at once, the ground is clear, the
 * table stands, and the comparison answers as each case sets it. The status the registry row is
 * written with is the subject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shape = vi.hoisted(() => ({
  leftOut: [] as Array<{
    column: string;
    problem: "missing" | "otherType";
    requestedType: string;
  }>,
}));

vi.mock("../../../schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: (_opts: unknown, work: () => unknown) => work(),
}));
vi.mock("../../../schema/services/created-table-shape", () => ({
  columnsTheCreateLeftOut: vi.fn(async () => shape.leftOut),
  describeColumnsLeftOut: vi.fn(() => "a column left out"),
}));
vi.mock("../../../schema/services/leftover-storage", async importOriginal => ({
  ...(await importOriginal<object>()),
  clearLeftoverStorage: vi.fn(async () => undefined),
}));
vi.mock(
  "../../../schema/services/collection-schema-apply",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    refuseNewCollectionIndexNamesTaken: vi.fn(async () => undefined),
  })
);
vi.mock("../../../schema/schema-version", async importOriginal => ({
  ...(await importOriginal<object>()),
  writeRegistryRows: (_adapter: unknown, write: () => unknown) => write(),
}));

import { CollectionMetadataService } from "../collection-metadata-service";

const FIELDS = [{ name: "title", type: "text" }];
const registerCollection = vi.fn(async (metadata: unknown) => metadata);

function service(): CollectionMetadataService {
  const created = new CollectionMetadataService(
    {
      getCapabilities: () => ({ dialect: "sqlite" }),
      getDrizzle: () => ({}),
      tableExists: vi.fn(async () => true),
      selectOne: vi.fn(async () => null),
      select: vi.fn(async () => []),
    } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    {
      runMigration: vi.fn(async () => undefined),
      saveMigration: vi.fn(async () => undefined),
    } as never,
    {
      generateCollection: vi.fn(async () => ({
        tableName: "dc_posts",
        migrationSQL: "",
        migrationFileName: "create_posts.sql",
        metadata: { slug: "posts", fields: FIELDS },
      })),
      registerCollection,
    } as never
  );
  // What follows the row is not judged here.
  const internals = created as unknown as {
    registerRuntimeSchema: () => Promise<void>;
    seedPermissionsForCollection: () => Promise<void>;
  };
  internals.registerRuntimeSchema = vi.fn(async () => undefined);
  internals.seedPermissionsForCollection = vi.fn(async () => undefined);
  return created;
}

/** The status the create's registry row was written with. */
async function recordedStatus(): Promise<unknown> {
  await service().createCollection({
    name: "posts",
    label: "Posts",
    fields: FIELDS as never,
  });
  const [metadata] = registerCollection.mock.calls.at(-1) ?? [];
  return (metadata as { migrationStatus?: unknown } | undefined)
    ?.migrationStatus;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  registerCollection.mockClear();
  shape.leftOut = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a collection create's recorded status", () => {
  it("is applied when the table holds every requested column as asked", async () => {
    expect(await recordedStatus()).toBe("applied");
  });

  it("is failed when the standing table leaves a requested column out", async () => {
    shape.leftOut = [
      { column: "title", problem: "missing", requestedType: "text" },
    ];

    expect(await recordedStatus()).toBe("failed");
  });
});
