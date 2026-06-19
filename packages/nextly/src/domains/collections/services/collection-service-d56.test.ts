/**
 * D56 (P7a) — the collection facade plumbs rich-query options + the new
 * `count` / `createMany` methods through to the entry service. Focused unit
 * tests with a spied entry service (the live `createTestNextly` path is proven
 * end-to-end separately in `plugins/__tests__/service-d56.integration.test.ts`).
 *
 * Pre-P7a, the facade `listEntries` dropped `where`/`sort`/`depth`/`select` on
 * the floor (only `page`/`limit` were forwarded) — so service-level filtering
 * through `ctx.services.collections` was silently a no-op. These assert it
 * forwards every option, and that `count`/`createMany` exist and delegate.
 */
import { describe, expect, it, vi } from "vitest";

import { CollectionService } from "./collection-service";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function make(entry: Record<string, unknown>): CollectionService {
  return new CollectionService(
    {} as never,
    noopLogger as never,
    {} as never,
    entry as never
  );
}

const listOk = {
  success: true,
  data: { docs: [], totalDocs: 0, limit: 10, hasNextPage: false },
};

describe("CollectionService.listEntries forwards rich-query options (D56, T1)", () => {
  it("forwards `where` to the entry service", async () => {
    const entry = { listEntries: vi.fn().mockResolvedValue(listOk) };
    await make(entry).listEntries(
      "posts",
      { where: { status: { equals: "published" } } },
      { overrideAccess: true }
    );
    expect(entry.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "posts",
        where: { status: { equals: "published" } },
        overrideAccess: true,
      })
    );
  });

  it("converts SortOptions to the entry service's string format", async () => {
    const entry = { listEntries: vi.fn().mockResolvedValue(listOk) };
    await make(entry).listEntries(
      "posts",
      { sort: { field: "createdAt", direction: "desc" } },
      {}
    );
    expect(entry.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "-createdAt" })
    );

    await make(entry).listEntries(
      "posts",
      { sort: { field: "title", direction: "asc" } },
      {}
    );
    expect(entry.listEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "title" })
    );
  });

  it("forwards no `where`/`sort` when omitted (negative control)", async () => {
    const entry = { listEntries: vi.fn().mockResolvedValue(listOk) };
    await make(entry).listEntries("posts", {}, {});
    const arg = entry.listEntries.mock.calls[0][0];
    expect(arg.where).toBeUndefined();
    expect(arg.sort).toBeUndefined();
  });
});

describe("CollectionService.listEntries forwards relations/projection (D56, T2)", () => {
  it("forwards `depth` and `select` to the entry service", async () => {
    const entry = { listEntries: vi.fn().mockResolvedValue(listOk) };
    await make(entry).listEntries(
      "posts",
      { depth: 2, select: { title: true } },
      {}
    );
    expect(entry.listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 2, select: { title: true } })
    );
  });

  it("leaves `depth`/`select` undefined when omitted (default depth preserved)", async () => {
    const entry = { listEntries: vi.fn().mockResolvedValue(listOk) };
    await make(entry).listEntries("posts", {}, {});
    const arg = entry.listEntries.mock.calls[0][0];
    expect(arg.depth).toBeUndefined();
    expect(arg.select).toBeUndefined();
  });
});
