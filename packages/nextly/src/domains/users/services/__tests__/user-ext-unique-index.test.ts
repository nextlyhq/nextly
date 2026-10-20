/**
 * A unique custom user field gets its unique index on every dialect. A plugin
 * type stored as text, with no `maxLength`, would be a TEXT column on MySQL,
 * which takes no index without a key length, so there it is a varchar, as a
 * built-in text field is. A type stored as long text cannot be unique
 * (validation refuses it); a definition stored before that is left without
 * the index, with a warning, rather than stop `nextly migrate`.
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
  it("is a varchar carrying its unique index on MySQL", () => {
    registerHandleType("text");
    const sql = new UserExtSchemaService(
      "mysql",
      undefined,
      silent
    ).generateMigrationSQL([field]);

    expect(sql).toContain("`handle` VARCHAR(255)");
    expect(sql).toContain("uq_user_ext_handle");
  });

  it("has no unique index on MySQL when stored as long text", () => {
    registerHandleType("longText");
    const sql = new UserExtSchemaService(
      "mysql",
      undefined,
      silent
    ).generateMigrationSQL([field]);

    expect(sql).toContain("`handle` TEXT");
    expect(sql).not.toContain("uq_user_ext_handle");
  });

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

describe("textColumnLength", () => {
  it("is 255 for a unique plugin text field with no maxLength on MySQL, and unbounded elsewhere", () => {
    registerHandleType("text");
    const length = (dialect: "mysql" | "postgresql" | "sqlite") =>
      new UserExtSchemaService(dialect, undefined, silent).textColumnLength(
        field
      );

    expect(length("mysql")).toBe(255);
    expect(length("postgresql")).toBeNull();
    expect(length("sqlite")).toBeNull();
  });

  it("is the field's maxLength wherever one is set", () => {
    registerHandleType("text");
    const withLength = {
      ...field,
      maxLength: 64,
    } as unknown as UserFieldConfig;

    expect(
      new UserExtSchemaService(
        "postgresql",
        undefined,
        silent
      ).textColumnLength(withLength)
    ).toBe(64);
  });

  it("is unbounded for a column that is not text", () => {
    registerHandleType("longText");

    expect(
      new UserExtSchemaService("mysql", undefined, silent).textColumnLength(
        field
      )
    ).toBeNull();
  });
});
