import { describe, it, expect } from "vitest";

import {
  MANAGED_TABLE_PREFIXES,
  isCompanionTable,
  isManagedTable,
  isSnapshotComparableTable,
} from "./managed-tables";

describe("isCompanionTable", () => {
  it("detects localized companion tables", () => {
    expect(isCompanionTable("dc_pages_locales")).toBe(true);
    expect(isCompanionTable("single_home_locales")).toBe(true);
  });

  it("is false for main / component / other tables", () => {
    expect(isCompanionTable("dc_pages")).toBe(false);
    expect(isCompanionTable("single_home")).toBe(false);
    expect(isCompanionTable("comp_hero")).toBe(false);
    expect(isCompanionTable("users")).toBe(false);
  });

  // A localized field group whose storage has been migrated has a companion
  // under the migrated prefix. A caller that walks the catalog rather than the
  // managed filter reaches it, and one that does not recognise it as a
  // companion probes it as an instance table — for an `id` column a companion
  // does not have, which fails the delete of any entity that gets that far.
  it("detects companions under the migrated field-group prefix", () => {
    expect(isCompanionTable("fg_hero_locales")).toBe(true);
    expect(isCompanionTable("fg_hero")).toBe(false);
  });

  it("companion tables still match the managed-prefix regex (prefix-based)", () => {
    // They are prefixed dc_/single_ so tablesFilter still covers them — the
    // pipeline must additionally exclude them via isCompanionTable.
    expect(isManagedTable("dc_pages_locales")).toBe(true);
  });
});

describe("isManagedTable", () => {
  // This regex is drizzle-kit's `tablesFilter`, so a prefix missing from it is
  // a table drizzle-kit never introspects — and a desired table it did not find
  // is one it creates. After the storage migration a generated field-group
  // table carries `fg_`, so every apply would propose creating one that exists.
  it("manages field-group tables under both storage generations", () => {
    expect(isManagedTable("comp_hero")).toBe(true);
    expect(isManagedTable("fg_hero")).toBe(true);
  });

  it("leaves tables outside the managed prefixes alone", () => {
    expect(isManagedTable("users")).toBe(false);
    expect(isManagedTable("nextly_versions")).toBe(false);
  });

  // The CLI matches by `startsWith` against the exported list while the
  // pipeline matches by regex. They named different prefix sets once; deriving
  // one from the other is what stops that recurring.
  it("exposes the same prefixes the regex matches", () => {
    for (const prefix of MANAGED_TABLE_PREFIXES) {
      expect(isManagedTable(`${prefix}thing`)).toBe(true);
    }
  });
});

/**
 * 🔴 One predicate, because the two callers had written it twice and drifted.
 *
 * `nextly migrate`'s drift check excluded localized companions; `migrate:resolve
 * --applied` did not. A companion is migration-owned and never appears in a
 * `migrate:create` snapshot, so a live snapshot containing one can never match
 * the file it is compared against — which made the recovery command report
 * drift and refuse to run on any database with a localized entity.
 */
describe("isSnapshotComparableTable", () => {
  it("includes managed main tables under both storage generations", () => {
    expect(isSnapshotComparableTable("dc_pages")).toBe(true);
    expect(isSnapshotComparableTable("comp_hero")).toBe(true);
    expect(isSnapshotComparableTable("fg_hero")).toBe(true);
  });

  it("excludes localized companions under both storage generations", () => {
    expect(isSnapshotComparableTable("dc_pages_locales")).toBe(false);
    expect(isSnapshotComparableTable("comp_hero_locales")).toBe(false);
    expect(isSnapshotComparableTable("fg_hero_locales")).toBe(false);
  });

  it("excludes tables Nextly does not manage", () => {
    expect(isSnapshotComparableTable("users")).toBe(false);
  });
});
