/**
 * The registry's names, read without its records.
 *
 * Shared by both content registries and tested here for the same reason the
 * schema-sync predicate is: a caller that wants the slugs as candidates reads
 * every registry the same way, and the property is what the ADAPTER is asked
 * for -- one column of every row -- rather than what comes back.
 */
import { describe, expect, it, vi } from "vitest";

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
    { select, getCapabilities: () => ({ dialect: "sqlite" }) } as never,
    { debug() {}, info() {}, warn() {}, error() {} } as never
  );
}

describe("BaseRegistryService.getAllSlugs", () => {
  it("asks the adapter for the slug column alone, over every row", async () => {
    // 🔴 The projection is the property. A read of the whole record
    // deserializes each row's fields JSON, so a caller that only wanted the
    // names materialized the whole registry on every request -- and the
    // returned list looks identical either way, which is why the assertion is
    // on the query rather than on the answer alone.
    const select = vi
      .fn()
      .mockResolvedValue([{ slug: "posts" }, { slug: "pages" }]);

    expect(await registryOver(select).getAllSlugs()).toEqual([
      "posts",
      "pages",
    ]);

    expect(select).toHaveBeenCalledTimes(1);
    const [table, options] = select.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("probe_registry");
    expect(options.columns).toEqual(["slug"]);
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
