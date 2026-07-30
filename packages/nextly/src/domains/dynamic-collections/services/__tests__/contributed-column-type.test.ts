import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { getColumnDescriptor } from "../../../schema/services/field-column-descriptor";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

/**
 * The reconciliation DDL keeps its own type map, separate from the canonical
 * column descriptor. If the two disagree for a field type, the physical column
 * and the runtime schema describe different things and the diff engine never
 * settles: every boot sees a change it cannot apply away.
 *
 * This asserts they agree for a json-backed contributed type on all three
 * dialects, which is the property that matters rather than the literal token
 * either one returns.
 */
const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

/** What the reconciliation DDL would emit for a column of this type. */
function ddlType(dialect: (typeof DIALECTS)[number]): string {
  return new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).mapFieldTypeToSQL("json");
}

describe("a json-backed contributed type's column", () => {
  beforeEach(() => {
    registerFieldType({
      type: "doc",
      storage: "json",
      component: "@acme/doc/admin#Input",
    });
  });
  afterEach(() => clearFieldTypes());

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
        { name: "content", type: "doc" },
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

  it("emits a JSON default a required column can actually take", () => {
    // `JSONB NOT NULL DEFAULT ''` does not apply, and an object default
    // stringified naively becomes [object Object].
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const generated = service.formatDefaultValue(
        { formatVersion: 1, kind: "page", nodes: [] },
        "json"
      );
      const text =
        dialect === "mysql"
          ? Buffer.from(
              generated.match(/X'([0-9a-f]*)'/)?.[1] ?? "",
              "hex"
            ).toString("utf8")
          : generated;
      expect(text, dialect).toContain('"formatVersion"');
      expect(text, dialect).not.toContain("[object Object]");
    }
  });

  it("escapes quotes in a default so the DDL stays parseable", () => {
    // A heading like O'Reilly would otherwise close the literal early and
    // produce a statement the database rejects.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const generated = service.formatDefaultValue(
        {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              type: "core/heading",
              version: 1,
              props: { text: "O'Reilly" },
            },
          ],
        },
        "json"
      );
      if (dialect === "mysql") {
        // Hex carries no delimiter at all, so there is nothing to escape.
        const hex = generated.match(/X'([0-9a-f]*)'/)?.[1] ?? "";
        expect(Buffer.from(hex, "hex").toString("utf8")).toContain("O'Reilly");
        continue;
      }
      // Every embedded quote is doubled, so the literal opens and closes once.
      expect(generated.startsWith("'"), dialect).toBe(true);
      expect(generated.endsWith("'"), dialect).toBe(true);
      expect(generated.slice(1, -1).includes("''"), dialect).toBe(true);
      expect(
        generated.slice(1, -1).replace(/''/g, "").includes("'"),
        dialect
      ).toBe(false);
    }
  });

  it("maps chips the same way as json", () => {
    // A JSON-backed type that diverged from its siblings would be a bug in
    // this map rather than a deliberate difference.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      expect(service.mapFieldTypeToSQL("chips"), dialect).toBe(
        service.mapFieldTypeToSQL("json")
      );
    }
  });
});
