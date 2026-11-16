/**
 * The registry list's slug denylist: the slugs a list leaves out, before the
 * total is counted and the page cut.
 *
 * The list is derived from the registry's listing (one read of every row,
 * `listStoredRegistry`), so the property is what it answers: a list that
 * dropped the denied rows only from the page would still count them in
 * `total`, and the assertions are on both.
 */
import { describe, expect, it, vi } from "vitest";

import {
  BaseRegistryService,
  type BaseListOptions,
  type BaseRegistryRecord,
} from "../base-registry-service";

/** A concrete registry over a recording adapter, with its list made callable. */
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
  list(options: BaseListOptions) {
    return this.listRecords(options);
  }
}

function registryOver(select: ReturnType<typeof vi.fn>): ProbeRegistry {
  return new ProbeRegistry(
    { select, getCapabilities: () => ({ dialect: "sqlite" }) } as never,
    { debug() {}, info() {}, warn() {}, error() {} } as never
  );
}

/** The registry's listing, oldest first, as the adapter's read answers it. */
const LISTING = [
  { id: "1", slug: "about", createdAt: new Date(1) },
  { id: "2", slug: "form-settings", createdAt: new Date(2) },
  { id: "3", slug: "home", createdAt: new Date(3) },
];

const slugsOf = (result: { data: BaseRegistryRecord[] }) =>
  result.data.map(record => record.slug);

describe("BaseRegistryService.listRecords — slugDenylist", () => {
  it("leaves the denied slugs out of the count and the page alike", async () => {
    const select = vi.fn().mockResolvedValue(LISTING);

    const result = await registryOver(select).list({
      slugDenylist: ["form-settings"],
      limit: 1,
    });

    expect(result.total).toBe(2);
    expect(slugsOf(result)).toEqual(["about"]);
    // One read of the listing, with no condition: the list is cut from it.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("denies nothing for an empty denylist", async () => {
    const select = vi.fn().mockResolvedValue(LISTING);

    const result = await registryOver(select).list({
      slugDenylist: [],
      limit: 10,
    });

    expect(result.total).toBe(3);
    expect(slugsOf(result)).toEqual(["about", "form-settings", "home"]);
  });

  it("narrows an allowlist and never widens it", async () => {
    // Both apply: a denylist only ever removes rows from what the allowlist
    // already admits.
    const select = vi.fn().mockResolvedValue(LISTING);

    const result = await registryOver(select).list({
      slugAllowlist: ["about", "form-settings"],
      slugDenylist: ["form-settings", "home"],
      limit: 10,
    });

    expect(result.total).toBe(1);
    expect(slugsOf(result)).toEqual(["about"]);
  });

  it("still answers nothing for an empty allowlist, whatever the denylist", async () => {
    // The access guard: a reader allowed no slugs sees no rows and no count,
    // and the database is not asked.
    const select = vi.fn().mockResolvedValue([{ id: "1" }]);

    const result = await registryOver(select).list({
      slugAllowlist: [],
      slugDenylist: [],
      limit: 10,
    });

    expect(result).toEqual({ data: [], total: 0 });
    expect(select).not.toHaveBeenCalled();
  });
});
