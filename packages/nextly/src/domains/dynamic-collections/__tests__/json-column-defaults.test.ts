/**
 * A JSON-backed column's DEFAULT clause is not portable text. MySQL rejects a
 * literal default on a JSON column and accepts only an expression default, so
 * an ALTER that reads correctly on PostgreSQL fails outright there. These
 * assertions pin the emitted statement per dialect, since the failure only
 * appears when the migration runs.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../schema/field-types/field-type-registry";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../services/dynamic-collection-schema-service";

function alterAdding(type: string, dialect: SupportedDialect): string {
  const service = new DynamicCollectionSchemaService(undefined, dialect);
  const before = [
    { name: "title", type: "text", required: true },
  ] as unknown as FieldDefinition[];
  const after = [
    { name: "title", type: "text", required: true },
    { name: "content", type, required: true },
  ] as unknown as FieldDefinition[];
  return service.generateAlterTableMigration("dc_probe", before, after);
}

const jsonBackedTypes = ["json", "repeater", "group", "chips"];

describe.each(jsonBackedTypes)("adding a required %s column", type => {
  it("uses a mode-independent expression default for mysql", () => {
    const sql = alterAdding(type, "mysql");
    expect(sql).toMatch(/DEFAULT \(CONVERT\(X'[0-9a-f]*' USING utf8mb4\)\)/);
  });

  it("uses a bare literal default for postgresql", () => {
    const sql = alterAdding(type, "postgresql");
    expect(sql).toContain("DEFAULT '");
    expect(sql).not.toContain("CONVERT(");
  });

  it("uses a bare literal default for sqlite", () => {
    const sql = alterAdding(type, "sqlite");
    expect(sql).toContain("DEFAULT '");
    expect(sql).not.toContain("CONVERT(");
  });
});

describe("a required column of a type that declares an empty value", () => {
  afterEach(() => clearFieldTypes());

  it("backfills with the declared value rather than the primitive's", () => {
    // The generic `{}` a json-backed type falls back to is right for a bag and
    // wrong for a structured document: it satisfies the column and then fails
    // every read that expects the structure. A type states its own value, and
    // the DDL quotes it per dialect rather than the type writing SQL.
    registerFieldType({
      type: "doc",
      storage: "json",
      component: "@acme/doc/admin#Input",
      emptyValue: () =>
        JSON.stringify({ formatVersion: 1, kind: "page", nodes: [] }),
    });

    for (const dialect of [
      "mysql",
      "postgresql",
      "sqlite",
    ] as SupportedDialect[]) {
      const sql = alterAdding("doc", dialect);
      const hex = sql.match(/X'([0-9a-f]*)'/)?.[1];
      const literal =
        hex !== undefined
          ? Buffer.from(hex, "hex").toString("utf8")
          : sql.match(/DEFAULT '(.*?)';/)?.[1];
      expect(literal, dialect).toBeDefined();
      expect(JSON.parse(String(literal))).toEqual({
        formatVersion: 1,
        kind: "page",
        nodes: [],
      });
    }
  });

  it("leaves a type that declares none to the existing fallback", () => {
    // Only a declared value is substituted. A type that states nothing keeps
    // whatever this path already produced for it, so adding the seam changed
    // no column that did not ask for it.
    registerFieldType({
      type: "bag",
      storage: "json",
      component: "@acme/bag/admin#Input",
    });

    const sql = alterAdding("bag", "postgresql");

    expect(sql).not.toContain("formatVersion");
  });
});
