// Why: lock the contract that DynamicCollectionRegistryService.getCollection
// coerces the `status` column from any dialect (postgres native boolean,
// mysql tinyint-as-number, sqlite integer-mode-boolean) into a real JS boolean.
// Without this coercion the EntryForm's `collection.status === true` gate
// fails on dialects where Drizzle returns a numeric 0/1.
import { describe, it, expect, beforeEach, vi } from "vitest";

import { DynamicCollectionRegistryService } from "../dynamic-collection-registry-service";

function makeService(rows: unknown[]) {
  // Minimal stub adapter: getDrizzle().select().from(...).where(...).limit(1)
  // chain returns the configured rows. getCapabilities returns sqlite so
  // BaseService's lazy `tables` getter picks the sqlite dialect tables.
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  const adapter = {
    getDrizzle: () => chain,
    getCapabilities: () => ({ dialect: "sqlite" }),
  } as never;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as never;
  return new DynamicCollectionRegistryService(adapter, logger);
}

describe("DynamicCollectionRegistryService.getCollection — status coercion", () => {
  it("returns status: true when DB row has status=1 (sqlite integer-boolean)", async () => {
    const svc = makeService([
      { id: "1", slug: "posts", status: 1 },
    ]);
    const result = (await svc.getCollection("posts")) as { status: boolean };
    expect(result.status).toBe(true);
  });

  it("returns status: true when DB row has status=true (postgres native boolean)", async () => {
    const svc = makeService([
      { id: "1", slug: "posts", status: true },
    ]);
    const result = (await svc.getCollection("posts")) as { status: boolean };
    expect(result.status).toBe(true);
  });

  it("returns status: false when DB row has status=0", async () => {
    const svc = makeService([
      { id: "1", slug: "posts", status: 0 },
    ]);
    const result = (await svc.getCollection("posts")) as { status: boolean };
    expect(result.status).toBe(false);
  });

  it("returns status: false when DB row has status=false", async () => {
    const svc = makeService([
      { id: "1", slug: "posts", status: false },
    ]);
    const result = (await svc.getCollection("posts")) as { status: boolean };
    expect(result.status).toBe(false);
  });

  it("returns status: false when DB row has no status field (legacy row)", async () => {
    const svc = makeService([{ id: "1", slug: "posts" }]);
    const result = (await svc.getCollection("posts")) as { status: boolean };
    expect(result.status).toBe(false);
  });
});
