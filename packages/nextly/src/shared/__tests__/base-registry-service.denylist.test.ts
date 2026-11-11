/**
 * The registry list's slug denylist: the slugs a list leaves out, as a
 * condition on the query both the count and the page read.
 *
 * The property is what the ADAPTER is asked for. A list that dropped the
 * denied rows from the page it was sent would answer with the same rows on a
 * short registry, and with a `total` that still counts them -- so the
 * assertions are on the where clause each read is given, and on the total.
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

/** The where clause each adapter read was given, in call order. */
function wheresOf(select: ReturnType<typeof vi.fn>): unknown[] {
  return select.mock.calls.map(call => (call[1] as { where?: unknown }).where);
}

const SLUG_NOT_IN = (slugs: string[]) => ({
  column: "slug",
  op: "NOT IN",
  value: slugs,
});

describe("BaseRegistryService.listRecords — slugDenylist", () => {
  it("leaves the denied slugs out of the count and the page alike", async () => {
    const select = vi
      .fn()
      // The count's read, then the page's.
      .mockResolvedValueOnce([{ id: "1" }, { id: "2" }])
      .mockResolvedValueOnce([{ slug: "about" }, { slug: "home" }]);

    const result = await registryOver(select).list({
      slugDenylist: ["form-settings"],
      limit: 10,
    });

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    const wheres = wheresOf(select);
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where).toEqual({ and: [SLUG_NOT_IN(["form-settings"])] });
    }
  });

  it("puts no constraint on the query for an empty denylist", async () => {
    // Never a `NOT IN ()`: its meaning differs by dialect, and an empty
    // denylist denies nothing, so the honest query has no slug condition.
    const select = vi.fn().mockResolvedValue([]);

    await registryOver(select).list({ slugDenylist: [], limit: 10 });

    expect(wheresOf(select)).toEqual([undefined, undefined]);
  });

  it("narrows an allowlist and never widens it", async () => {
    // Both conditions, ANDed: a denylist only ever removes rows from what the
    // allowlist already admits.
    const select = vi.fn().mockResolvedValue([]);

    await registryOver(select).list({
      slugAllowlist: ["about", "form-settings"],
      slugDenylist: ["form-settings"],
      limit: 10,
    });

    for (const where of wheresOf(select)) {
      expect(where).toEqual({
        and: [
          { column: "slug", op: "IN", value: ["about", "form-settings"] },
          SLUG_NOT_IN(["form-settings"]),
        ],
      });
    }
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
