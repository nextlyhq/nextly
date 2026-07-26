/**
 * A JSON-backed column's DEFAULT clause is not portable text. MySQL rejects a
 * literal default on a JSON column and accepts only an expression default, so
 * an ALTER that reads correctly on PostgreSQL fails outright there. These
 * assertions pin the emitted statement per dialect, since the failure only
 * appears when the migration runs.
 */
import { describe, expect, it } from "vitest";

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

const jsonBackedTypes = ["blocks", "json", "repeater", "group", "chips"];

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

describe("a required blocks column", () => {
  it("defaults to a real document rather than an empty object", () => {
    // The generic `{}` other JSON types fall back to carries no formatVersion,
    // kind, or nodes, so the backfilled rows would hold a value the field's
    // own validator rejects.
    for (const dialect of [
      "mysql",
      "postgresql",
      "sqlite",
    ] as SupportedDialect[]) {
      const sql = alterAdding("blocks", dialect);
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
});
