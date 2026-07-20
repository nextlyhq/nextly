/**
 * i18n: `localized` option tests for DynamicCollectionSchemaService.generateMigrationSQL.
 *
 * Locks the contract that a UI-created localized collection's MAIN table omits its
 * translatable columns (they live in the companion `_locales` table), while shared
 * (value/structural) columns and explicit `localized: false` fields stay on main.
 * Without this, the UI-create path built the main table with the localized columns
 * AND writes routed them to the companion — so every language shared one value.
 */
import { describe, it, expect, beforeEach } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

describe("generateMigrationSQL — localized", () => {
  describe.each(["sqlite", "postgresql", "mysql"] as const)(
    "dialect: %s",
    dialect => {
      let service: DynamicCollectionSchemaService;
      const fields: FieldDefinition[] = [
        { name: "heading", type: "text" }, // text → localized by default
        { name: "views", type: "number" }, // value field → shared
        { name: "meta_title", type: "text", localized: false }, // explicit shared
      ];

      beforeEach(() => {
        service = new DynamicCollectionSchemaService(undefined, dialect);
      });

      it("keeps all columns on the main table when NOT localized", () => {
        const sql = service.generateMigrationSQL("dc_pages", fields);
        expect(sql.toLowerCase()).toContain("heading");
        expect(sql.toLowerCase()).toContain("views");
        expect(sql.toLowerCase()).toContain("meta_title");
      });

      it("omits translatable columns from the main table when localized", () => {
        const sql = service.generateMigrationSQL("dc_pages", fields, {
          localized: true,
        });
        // Translatable text field is relocated to the companion → absent from main.
        expect(sql.toLowerCase()).not.toContain("heading");
        // Shared value field and explicit localized:false field stay on main.
        expect(sql.toLowerCase()).toContain("views");
        expect(sql.toLowerCase()).toContain("meta_title");
      });
    }
  );
});
