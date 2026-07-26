import { describe, expect, it } from "vitest";

import { getColumnDescriptor } from "../../../schema/services/field-column-descriptor";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

/**
 * The reconciliation DDL keeps its own type map, separate from the canonical
 * column descriptor. If the two disagree for a field type, the physical column
 * and the runtime schema describe different things and the diff engine never
 * settles: every boot sees a change it cannot apply away.
 *
 * This asserts they agree for `blocks` on all three dialects, which is the
 * property that matters rather than the literal token either one returns.
 */
const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** What the reconciliation DDL would emit for a column of this type. */
function ddlType(dialect: (typeof DIALECTS)[number]): string {
  return new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).mapFieldTypeToSQL("blocks");
}

describe("blocks column type", () => {
  it("is a JSON column in the reconciliation DDL on every dialect", () => {
    // SQLite has no JSON type; text is how every other JSON-backed field is
    // stored there, which is what the descriptor expects to read back.
    expect(ddlType("postgresql")).toBe("jsonb");
    expect(ddlType("mysql")).toBe("json");
    expect(ddlType("sqlite")).toBe("text");
  });

  it("agrees with the canonical descriptor", () => {
    for (const dialect of DIALECTS) {
      const descriptor = getColumnDescriptor(
        { name: "content", type: "blocks" },
        dialect
      );
      expect(descriptor?.kind, dialect).toBe("json");
      // The DDL emits the dialect's own JSON token for the same field.
      expect(ddlType(dialect), dialect).toBe(
        dialect === "postgresql"
          ? "jsonb"
          : dialect === "mysql"
            ? "json"
            : "text"
      );
    }
  });

  it("matches how json and chips are already mapped", () => {
    // A new JSON-backed type that diverged from its siblings would be a bug in
    // this map rather than a deliberate difference.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      expect(service.mapFieldTypeToSQL("blocks"), dialect).toBe(
        service.mapFieldTypeToSQL("json")
      );
    }
  });
});
