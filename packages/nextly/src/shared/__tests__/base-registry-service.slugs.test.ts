/**
 * The registry's names, derived from its one listing.
 *
 * Shared by both content registries and tested here for the same reason the
 * schema-sync predicate is: a caller that wants the slugs as candidates reads
 * every registry the same way, and the property is what the ADAPTER is asked
 * for -- every row, unpaged and unfiltered, once while the registry stays as
 * it is -- rather than what comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRegistryRowCache } from "../../domains/dynamic-collections/services/collection-row-cache";

import { NextlyError } from "../../errors/nextly-error";
import {
  BaseRegistryService,
  type BaseRegistryRecord,
} from "../base-registry-service";

/** A concrete registry over a recording adapter. */
class ProbeRegistry extends BaseRegistryService<BaseRegistryRecord> {
  protected readonly registryTableName = "probe_registry";
  protected readonly resourceType = "Probe";
  protected readonly tableNamePrefix = "probe_";
  protected getSearchColumns(): string[] {
    return [];
  }
  protected deserializeRecord(record: BaseRegistryRecord): BaseRegistryRecord {
    return record;
  }
}

function registryOver(select: ReturnType<typeof vi.fn>): ProbeRegistry {
  return new ProbeRegistry(
    // The error path reads the dialect off the adapter's capabilities to name
    // the driver failure; nothing else of the adapter is touched here.
    // No transaction is open, so the listing comes from the registry cache.
    {
      select,
      getCapabilities: () => ({ dialect: "sqlite" }),
      transactionOpenInFlow: () => false,
    } as never,
    { debug() {}, info() {}, warn() {}, error() {} } as never
  );
}

beforeEach(() => {
  clearRegistryRowCache();
});

describe("BaseRegistryService.getAllSlugs", () => {
  it("derives the slugs from one read of every row, not read again for the next caller", async () => {
    // 🔴 The listing is the property. Every narrower view of the registry
    // (its slugs, its labels, its records) is derived from one read of every
    // row, so the views cannot disagree; and that read is kept, so a caller
    // that only wanted the names no longer reads the registry on every
    // request. The returned list looks identical either way, which is why the
    // assertion is on the query rather than on the answer alone.
    const select = vi
      .fn()
      .mockResolvedValue([{ slug: "posts" }, { slug: "pages" }]);
    const registry = registryOver(select);

    expect(await registry.getAllSlugs()).toEqual(["posts", "pages"]);
    expect(await registry.getAllSlugs()).toEqual(["posts", "pages"]);

    expect(select).toHaveBeenCalledTimes(1);
    const [table, options] = select.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("probe_registry");
    // No page and no filter: the candidates are every row, or the allowlist
    // built from them silently drops whatever a page boundary cut off.
    expect(options.limit).toBeUndefined();
    expect(options.where).toBeUndefined();
  });

  it("reports a driver failure as the registry failing, not as an empty registry", async () => {
    // An empty answer from a failed read is the direction that widens an
    // access decision built on it; the caller distinguishes a throw from a
    // floor, so the throw has to reach it in the package's own error shape.
    const select = vi.fn().mockRejectedValue(new Error("pool timeout"));

    await expect(registryOver(select).getAllSlugs()).rejects.toSatisfy(
      (error: unknown) => NextlyError.is(error)
    );
  });
});
