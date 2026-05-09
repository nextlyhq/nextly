// Why: lock the contract that DynamicCollectionRegistryService.registerCollection
// persists the `status` flag into the row it writes. Before this fix the
// admin UI's POST /api/collections (which routes through this service via the
// dispatcher → metadata-service path) silently dropped status, so the entry
// edit form never showed Save Draft / Publish even when the user toggled it.
import { describe, it, expect, vi } from "vitest";

import { DynamicCollectionRegistryService } from "../dynamic-collection-registry-service";

function makeService() {
  const insertedValues: Record<string, unknown>[] = [];

  // Stub the Drizzle insert chain — `.insert(table).values(row)` is called
  // unawaited (the SUT awaits the result). We capture `row` for assertions
  // and resolve the call with `undefined` so the awaiter sees a settled
  // thenable.
  const valuesFn = (row: Record<string, unknown>) => {
    insertedValues.push(row);
    return Promise.resolve(undefined);
  };

  const insertChain = { values: valuesFn };

  // Stub for the dynamic-singles slug-uniqueness check
  // (ensureGlobalSlugUniqueness queries dynamic_singles before insert).
  const selectChain = {
    select: () => selectChain,
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve([]),
  };

  const db = {
    insert: () => insertChain,
    select: () => selectChain,
    from: () => selectChain,
    where: () => selectChain,
  };

  const adapter = {
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as never;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as never;

  return {
    svc: new DynamicCollectionRegistryService(adapter, logger),
    insertedValues,
  };
}

describe("DynamicCollectionRegistryService.registerCollection — status persistence", () => {
  it("writes status: true when metadata.status is true", async () => {
    const { svc, insertedValues } = makeService();
    await svc.registerCollection({
      id: "id-1",
      slug: "posts",
      tableName: "dc_posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [],
      status: true,
      schemaHash: "hash",
    } as never);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0].status).toBe(true);
  });

  it("writes status: false when metadata.status is false", async () => {
    const { svc, insertedValues } = makeService();
    await svc.registerCollection({
      id: "id-2",
      slug: "comments",
      tableName: "dc_comments",
      labels: { singular: "Comment", plural: "Comments" },
      fields: [],
      status: false,
      schemaHash: "hash",
    } as never);
    expect(insertedValues[0].status).toBe(false);
  });

  it("writes status: false when metadata.status is undefined (default off)", async () => {
    const { svc, insertedValues } = makeService();
    await svc.registerCollection({
      id: "id-3",
      slug: "tags",
      tableName: "dc_tags",
      labels: { singular: "Tag", plural: "Tags" },
      fields: [],
      schemaHash: "hash",
    } as never);
    expect(insertedValues[0].status).toBe(false);
  });
});
