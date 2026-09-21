/**
 * The naming and indexability rules.
 *
 * Every case here is a declaration that would otherwise fail somewhere far from
 * its cause: a table the pipeline silently drops, or an index that only a
 * MySQL deployment rejects.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { pluginAdminSlug } from "../../../../plugins/plugin-slug";
import {
  assertUsableAppTableName,
  judgeIndex,
  pluginTableName,
  pluginTablePrefix,
} from "../naming";
import type { ExtensionColumn } from "../types";

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected the call to throw, and it returned");
}

const column = (
  name: string,
  kind: ExtensionColumn["kind"],
  length?: number
): ExtensionColumn => ({
  key: name,
  name,
  kind,
  nullable: false,
  ...(length !== undefined ? { length } : {}),
});

describe("pluginTablePrefix", () => {
  it("derives a prefix from the plugin's admin slug", () => {
    expect(
      pluginTablePrefix("My Auth Plugin", undefined, pluginAdminSlug)
    ).toBe("my_auth_plugin");
  });

  it("prefers a declared prefix", () => {
    expect(pluginTablePrefix("whatever", "auth", pluginAdminSlug)).toBe("auth");
  });

  it("refuses a prefix containing the separator", () => {
    // `a__b` + table `c` and `a` + table `b__c` would produce one name.
    expect(
      refusal(() => pluginTablePrefix("p", "a__b", pluginAdminSlug))
    ).toMatch(/may not contain/);
  });

  it("refuses a reserved prefix", () => {
    expect(
      refusal(() => pluginTablePrefix("p", "nextly", pluginAdminSlug))
    ).toMatch(/reserved/);
  });

  it("refuses a prefix that is not a usable identifier", () => {
    expect(
      refusal(() => pluginTablePrefix("p", "9bad", pluginAdminSlug))
    ).toMatch(/lower-case letters/);
  });
});

describe("pluginTableName", () => {
  it("joins prefix and table with the separator", () => {
    expect(pluginTableName("auth", "identities")).toBe("auth__identities");
  });

  it("refuses a name that lands inside a managed prefix, though the prefix itself is legal", () => {
    // This is the case a prefix-only check misses: `dc_x` is not reserved, and
    // `dc_x__t` is still claimed by the collection pipeline, which would
    // propose dropping it.
    expect(refusal(() => pluginTableName("dc_x", "t"))).toMatch(
      /prefix the schema pipeline manages/
    );
  });

  it("refuses a name ending in the localization companion suffix", () => {
    expect(refusal(() => pluginTableName("auth", "thing_locales"))).toMatch(
      /localization layer owns/
    );
  });

  it("refuses a name past the identifier limit", () => {
    expect(refusal(() => pluginTableName("auth", "x".repeat(60)))).toMatch(
      /at most 63 characters/
    );
  });
});

describe("assertUsableAppTableName", () => {
  it("refuses a core table name", () => {
    expect(
      refusal(() => assertUsableAppTableName("audit_log", ["audit_log"], []))
    ).toMatch(/is a core table/);
  });

  it("refuses a name inside a plugin's namespace", () => {
    expect(
      refusal(() => assertUsableAppTableName("auth__x", [], ["auth"]))
    ).toMatch(/namespace of the plugin prefix/);
  });

  it("allows an ordinary app table", () => {
    expect(() =>
      assertUsableAppTableName("billing_invoices", ["users"], ["auth"])
    ).not.toThrow();
  });
});

describe("judgeIndex", () => {
  const cols = [
    column("id", "varchar", 36),
    column("payload", "json"),
    column("body", "longText"),
    column("wide", "varchar", 800),
  ];

  it("allows an ordinary index on every dialect", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      expect(
        judgeIndex({ columns: ["id"], unique: true }, cols, dialect)
      ).toBeNull();
    }
  });

  it("refuses a JSON index on MySQL and allows it elsewhere", () => {
    expect(
      judgeIndex({ columns: ["payload"], unique: false }, cols, "mysql")
    ).toMatchObject({ reason: "not-indexable" });
    expect(
      judgeIndex({ columns: ["payload"], unique: false }, cols, "postgresql")
    ).toBeNull();
  });

  it("refuses uniqueness on an unbounded text column on MySQL", () => {
    // Distinct from `not-indexable`: MySQL will index this column, it just
    // cannot key it without a prefix length. The separate reason is what lets
    // the message tell an author to use varchar(n) rather than to drop the
    // index entirely.
    expect(
      judgeIndex({ columns: ["body"], unique: true }, cols, "mysql")
    ).toMatchObject({ reason: "unique-not-indexable" });
    // Non-unique is refused too, by the key-width rule rather than the
    // uniqueness one: MySQL cannot key a TEXT column without a prefix length
    // in either form. Asserted so the two rules are seen to cover the column
    // between them rather than one masking a gap in the other.
    expect(
      judgeIndex({ columns: ["body"], unique: false }, cols, "mysql")
    ).toMatchObject({ reason: "not-indexable" });
    // Postgres keys it either way, which is what makes this a portability
    // rule rather than a property of the column.
    expect(
      judgeIndex({ columns: ["body"], unique: true }, cols, "postgresql")
    ).toBeNull();
  });

  it("refuses a compound key past the MySQL byte limit", () => {
    // 800 chars x 4 bytes (utf8mb4) = 3200, over the 3072 InnoDB cap — and
    // MySQL counts the DECLARED width, whatever the rows actually hold.
    expect(
      judgeIndex({ columns: ["wide"], unique: false }, cols, "mysql")
    ).toMatchObject({ reason: "key-too-wide" });
    expect(
      judgeIndex({ columns: ["wide"], unique: false }, cols, "postgresql")
    ).toBeNull();
  });

  it("refuses an index naming a column that is not there", () => {
    expect(
      judgeIndex({ columns: ["ghost"], unique: false }, cols, "postgresql")
    ).toMatchObject({ reason: "unknown-column" });
  });
});
