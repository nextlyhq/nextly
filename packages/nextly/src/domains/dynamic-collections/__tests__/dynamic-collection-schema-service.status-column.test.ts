/**
 * DDL `hasStatus` option tests for DynamicCollectionSchemaService.
 *
 * Locks the contract that:
 *  - generateMigrationSQL emits a `status` column in CREATE TABLE when
 *    `options.hasStatus` is true, and omits it otherwise.
 *  - generateAlterTableMigration emits ADD COLUMN status / DROP COLUMN
 *    status as the lifecycle flag flips.
 *
 * Without this, PR #249's status persistence on `dynamic_collections.status`
 * would create rows the data table can't accept — the entry insert path
 * fails with "table dc_X has no column named status".
 */
import { describe, it, expect, beforeEach } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

describe("generateMigrationSQL — hasStatus", () => {
  describe.each(["sqlite", "postgresql", "mysql"] as const)(
    "dialect: %s",
    (dialect) => {
      let service: DynamicCollectionSchemaService;

      beforeEach(() => {
        service = new DynamicCollectionSchemaService(undefined, dialect);
      });

      it("does NOT include a status column by default", () => {
        const sql = service.generateMigrationSQL("dc_posts", [
          { name: "body", type: "text" },
        ]);
        expect(sql).not.toMatch(/["`]?status["`]?\s+(text|varchar)/i);
      });

      it("includes a status column with default 'draft' when hasStatus is true", () => {
        const sql = service.generateMigrationSQL(
          "dc_posts",
          [{ name: "body", type: "text" }],
          { hasStatus: true }
        );
        // Column appears
        expect(sql.toLowerCase()).toMatch(/["`]?status["`]?/);
        // Defaulted to 'draft' so existing rows backfill on enable
        expect(sql).toMatch(/DEFAULT\s+'draft'/i);
        // NOT NULL — every row has a lifecycle state
        expect(sql.toLowerCase()).toMatch(/not null/);
      });

      it("does NOT include a status column when hasStatus is false", () => {
        const sql = service.generateMigrationSQL(
          "dc_posts",
          [{ name: "body", type: "text" }],
          { hasStatus: false }
        );
        expect(sql).not.toMatch(/["`]?status["`]?\s+(text|varchar)/i);
      });
    }
  );
});

describe("generateAlterTableMigration — status flip", () => {
  let service: DynamicCollectionSchemaService;

  beforeEach(() => {
    service = new DynamicCollectionSchemaService(undefined, "sqlite");
  });

  it("emits ADD COLUMN status when flipping wasStatus=false → hasStatus=true", () => {
    const fields: FieldDefinition[] = [{ name: "body", type: "text" }];
    const sql = service.generateAlterTableMigration(
      "dc_posts",
      fields,
      fields,
      { wasStatus: false, hasStatus: true }
    );
    expect(sql).toMatch(/ADD COLUMN[^;]*status/i);
    expect(sql).toMatch(/DEFAULT\s+'draft'/i);
  });

  it("emits DROP COLUMN status when flipping wasStatus=true → hasStatus=false", () => {
    const fields: FieldDefinition[] = [{ name: "body", type: "text" }];
    const sql = service.generateAlterTableMigration(
      "dc_posts",
      fields,
      fields,
      { wasStatus: true, hasStatus: false }
    );
    expect(sql).toMatch(/DROP COLUMN[^;]*status/i);
  });

  it("does NOT touch status when wasStatus === hasStatus (no flip)", () => {
    const fields: FieldDefinition[] = [{ name: "body", type: "text" }];

    const onSql = service.generateAlterTableMigration(
      "dc_posts",
      fields,
      fields,
      { wasStatus: true, hasStatus: true }
    );
    expect(onSql).not.toMatch(/(ADD|DROP) COLUMN[^;]*status/i);

    const offSql = service.generateAlterTableMigration(
      "dc_posts",
      fields,
      fields,
      { wasStatus: false, hasStatus: false }
    );
    expect(offSql).not.toMatch(/(ADD|DROP) COLUMN[^;]*status/i);
  });

  it("defaults to no status touch when options is omitted (legacy callers safe)", () => {
    const fields: FieldDefinition[] = [{ name: "body", type: "text" }];
    const sql = service.generateAlterTableMigration("dc_posts", fields, fields);
    expect(sql).not.toMatch(/(ADD|DROP) COLUMN[^;]*status/i);
  });
});
