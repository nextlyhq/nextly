/**
 * A unique custom user field gets its unique index only where its column can
 * carry one. A plugin type stored as text, with no `maxLength`, is a TEXT
 * column on MySQL, which takes no index without a key length: the index is
 * left out there (with a warning) rather than stop `nextly migrate`, and kept
 * on PostgreSQL and SQLite, where a text column can be indexed.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import type { UserFieldConfig } from "../../../../users";
import { UserExtSchemaService } from "../user-ext-schema-service";

afterEach(() => {
  clearFieldTypes();
});

function registerHandleType(storage: "text" | "longText") {
  registerFieldType({
    type: "handle",
    storage,
    component: "@acme/handles/admin#Handle",
    surfaces: ["users"],
  });
}

const field = {
  name: "handle",
  type: "handle",
  unique: true,
} as unknown as UserFieldConfig;
const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("a unique plugin field stored as text", () => {
  it.each(["text", "longText"] as const)(
    "has no unique index on MySQL when stored as %s",
    storage => {
      registerHandleType(storage);
      const sql = new UserExtSchemaService(
        "mysql",
        undefined,
        silent
      ).generateMigrationSQL([field]);

      expect(sql).toContain("`handle` TEXT");
      expect(sql).not.toContain("uq_user_ext_handle");
    }
  );

  it.each(["postgresql", "sqlite"] as const)(
    "keeps its unique index on %s",
    dialect => {
      registerHandleType("text");
      const sql = new UserExtSchemaService(
        dialect,
        undefined,
        silent
      ).generateMigrationSQL([field]);

      expect(sql).toContain("uq_user_ext_handle");
    }
  );

  it("keeps the unique index on MySQL when a maxLength makes it a varchar", () => {
    registerHandleType("text");
    const withLength = {
      ...field,
      maxLength: 64,
    } as unknown as UserFieldConfig;
    const sql = new UserExtSchemaService(
      "mysql",
      undefined,
      silent
    ).generateMigrationSQL([withLength]);

    expect(sql).toContain("uq_user_ext_handle");
  });
});
