/**
 * The key an indexed custom user field's column is indexed by.
 *
 * A text field with no `maxLength` is a TEXT column on MySQL, which refuses a plain index on it
 * without a key length (error 1170), so the key is the column's first 191 characters, the shared
 * rule collections and the schema pipeline index by. A bounded text is a VARCHAR, keyed whole, and
 * PostgreSQL and SQLite index the whole value of every column.
 */
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../../users";
import { UserExtSchemaService } from "../user-ext-schema-service";

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The key part of the CREATE INDEX on the `nickname` column, as written. */
function indexKey(
  dialect: "mysql" | "postgresql" | "sqlite",
  field: Record<string, unknown>
): string[] {
  const sql = new UserExtSchemaService(
    dialect,
    undefined,
    silent
  ).generateMigrationSQL([
    { name: "nickname", ...field } as unknown as UserFieldConfig,
  ]);
  const statement =
    /CREATE INDEX (?:IF NOT EXISTS )?["`]idx_user_ext_nickname["`] ON ["`]user_ext["`] ?\((["`]nickname["`](?:\(\d+\))?)\)/g;
  return [...sql.matchAll(statement)].map(match => match[1] ?? "");
}

describe("an indexed custom user field", () => {
  it.each([
    ["an unbounded text", { type: "text", index: true }],
    ["a textarea", { type: "textarea", index: true }],
  ])("%s on MySQL is keyed by its first 191 characters", (_label, field) => {
    expect(indexKey("mysql", field)).toEqual(["`nickname`(191)"]);
  });

  it("a bounded text on MySQL is keyed whole", () => {
    expect(
      indexKey("mysql", { type: "text", maxLength: 100, index: true })
    ).toEqual(["`nickname`"]);
  });

  // A multi-select is stored as JSON. MySQL cannot index a JSON column at all, so the field gets
  // no index there rather than a statement the server refuses; the other dialects index it, as a
  // collection's.
  const multiSelect = {
    type: "select",
    hasMany: true,
    options: [{ label: "A", value: "a" }],
    index: true,
  };

  it("a multi-select on MySQL gets no index", () => {
    expect(indexKey("mysql", multiSelect)).toEqual([]);
  });

  it.each(["postgresql", "sqlite"] as const)(
    "a multi-select on %s is indexed",
    dialect => {
      expect(indexKey(dialect, multiSelect)).toEqual(['"nickname"']);
    }
  );

  it.each(["postgresql", "sqlite"] as const)(
    "an unbounded text on %s is keyed whole",
    dialect => {
      expect(indexKey(dialect, { type: "text", index: true })).toEqual([
        '"nickname"',
      ]);
    }
  );
});
