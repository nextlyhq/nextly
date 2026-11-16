/**
 * A field group's text column follows the rule of whoever owns its table: unbounded for a Schema
 * Builder field group, 255 wide for a code-first one, as the schema a migration is written from
 * describes each. The table's CREATE and the Drizzle table handed to drizzle-kit both read it, so a
 * push never proposes narrowing a Builder field group's TEXT, nor leaves a code-first one's legacy
 * TEXT unnarrowed.
 */
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { getComponentRowColumnDescriptor } from "../../../schema/services/field-column-descriptor";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const META_TITLE = { name: "meta_title", type: "text" };

describe.each(["postgresql", "mysql", "sqlite"] as const)("%s", dialect => {
  it.each(["fieldGroup", "codeFirst"] as const)(
    "creates a %s field group's text column as the descriptor's rule for it says",
    builtBy => {
      const sql = new FieldGroupSchemaService(
        dialect,
        builtBy
      ).generateMigrationSQL("comp_seo", [
        META_TITLE as unknown as FieldConfig,
      ]);
      const expected = getComponentRowColumnDescriptor(
        META_TITLE as unknown as FieldDefinition,
        dialect,
        builtBy
      )?.dialectType;

      const line = sql
        .split("\n")
        .find(l => /["`]meta_title["`]/.test(l) && !/INDEX/i.test(l));
      expect(expected).toBeDefined();
      expect(line?.toLowerCase()).toContain(String(expected).toLowerCase());
    }
  );
});

describe("the Drizzle table drizzle-kit reads, on MySQL", () => {
  const columnType = (builtBy: "fieldGroup" | "codeFirst") => {
    const table = new FieldGroupSchemaService(
      "mysql",
      builtBy
    ).generateRuntimeSchema(
      "comp_seo",
      [META_TITLE as unknown as FieldConfig],
      {
        typeColumn: STORAGE_FORMAT.columns.type,
      }
    );
    return mysqlTableConfig(table as never)
      .columns.find(c => c.name === "meta_title")
      ?.getSQLType();
  };

  it("declares a Builder field group's text unbounded", () => {
    expect(columnType("fieldGroup")).toBe("text");
  });

  it("declares a code-first field group's text 255 wide", () => {
    expect(columnType("codeFirst")).toBe("varchar(255)");
  });
});
