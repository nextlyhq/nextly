import { describe, it, expect } from "vitest";

import * as schemaExports from "../schema/index";
import type {
  ColumnDefinition,
  IndexDefinition,
  TableConstraint,
  TableDefinition,
  CreateTableOptions,
  DropTableOptions,
  AlterTableOptions,
  AlterTableOperation,
  SqlParam,
} from "../schema/index";

describe("Schema Module", () => {
  describe("Module Metadata", () => {
    it("should export SCHEMA_VERSION constant", () => {
      expect(schemaExports.SCHEMA_VERSION).toBe("0.1.0");
      expect(typeof schemaExports.SCHEMA_VERSION).toBe("string");
    });

    it("should export SCHEMA_BUILDER_AVAILABLE flag", () => {
      expect(schemaExports.SCHEMA_BUILDER_AVAILABLE).toBe(false);
      expect(typeof schemaExports.SCHEMA_BUILDER_AVAILABLE).toBe("boolean");
    });

    it("should have exactly 2 runtime exports (version + flag)", () => {
      const runtimeExports = Object.keys(schemaExports).filter(
        key => !key.startsWith("__")
      );
      expect(runtimeExports).toEqual([
        "SCHEMA_VERSION",
        "SCHEMA_BUILDER_AVAILABLE",
      ]);
    });
  });

  describe("Type Exports", () => {
    it("should export ColumnDefinition type", () => {
      const column: ColumnDefinition = {
        name: "id",
        type: "uuid",
        primaryKey: true,
      };
      expect(column.name).toBe("id");
      expect(column.type).toBe("uuid");
      expect(column.primaryKey).toBe(true);
    });

    it("should export IndexDefinition type", () => {
      const index: IndexDefinition = {
        name: "users_email_idx",
        columns: ["email"],
        unique: true,
      };
      expect(index.name).toBe("users_email_idx");
      expect(index.columns).toEqual(["email"]);
      expect(index.unique).toBe(true);
    });

    it("should export TableConstraint type", () => {
      const constraint: TableConstraint = {
        name: "check_age",
        type: "check",
        expression: "age >= 0",
      };
      expect(constraint.name).toBe("check_age");
      expect(constraint.type).toBe("check");
      expect(constraint.expression).toBe("age >= 0");
    });

    it("should export TableDefinition type", () => {
      const table: TableDefinition = {
        name: "users",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "email", type: "varchar(255)", unique: true },
        ],
        indexes: [{ name: "users_email_idx", columns: ["email"] }],
      };
      expect(table.name).toBe("users");
      expect(table.columns).toHaveLength(2);
      expect(table.indexes).toHaveLength(1);
    });

    it("should export CreateTableOptions type", () => {
      const options: CreateTableOptions = {
        ifNotExists: true,
        temporary: false,
      };
      expect(options.ifNotExists).toBe(true);
      expect(options.temporary).toBe(false);
    });

    it("should export DropTableOptions type", () => {
      const options: DropTableOptions = {
        ifExists: true,
        cascade: true,
      };
      expect(options.ifExists).toBe(true);
      expect(options.cascade).toBe(true);
    });

    it("should export AlterTableOptions type", () => {
      const options: AlterTableOptions = {
        validate: true,
      };
      expect(options.validate).toBe(true);
    });

    it("should export AlterTableOperation type - add_column", () => {
      const operation: AlterTableOperation = {
        kind: "add_column",
        column: { name: "age", type: "int", nullable: true },
      };
      expect(operation.kind).toBe("add_column");
      expect(operation.column.name).toBe("age");
    });

    it("should export AlterTableOperation type - drop_column", () => {
      const operation: AlterTableOperation = {
        kind: "drop_column",
        columnName: "old_field",
        cascade: true,
      };
      expect(operation.kind).toBe("drop_column");
      expect(operation.columnName).toBe("old_field");
    });

    it("should export AlterTableOperation type - rename_column", () => {
      const operation: AlterTableOperation = {
        kind: "rename_column",
        from: "name",
        to: "full_name",
      };
      expect(operation.kind).toBe("rename_column");
      expect(operation.from).toBe("name");
      expect(operation.to).toBe("full_name");
    });

    it("should export SqlParam type", () => {
      const params: SqlParam[] = ["string", 123, true, null, undefined];
      expect(params).toHaveLength(5);
      expect(params[0]).toBe("string");
      expect(params[1]).toBe(123);
      expect(params[2]).toBe(true);
      expect(params[3]).toBe(null);
      expect(params[4]).toBe(undefined);
    });
  });

  describe("Type Usage Examples", () => {
    it("should create a complete table definition", () => {
      const usersTable: TableDefinition = {
        name: "users",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "email", type: "varchar(255)", unique: true },
          { name: "name", type: "varchar(255)", nullable: true },
          {
            name: "created_at",
            type: "timestamp",
            default: { sql: "CURRENT_TIMESTAMP" },
          },
        ],
        indexes: [
          { name: "users_email_idx", columns: ["email"], unique: true },
        ],
      };

      expect(usersTable.name).toBe("users");
      expect(usersTable.columns).toHaveLength(4);
      expect(usersTable.indexes).toHaveLength(1);
      expect(usersTable.columns[0].primaryKey).toBe(true);
      expect(usersTable.columns[1].unique).toBe(true);
      expect(usersTable.columns[2].nullable).toBe(true);
      expect(usersTable.columns[3].default).toEqual({
        sql: "CURRENT_TIMESTAMP",
      });
    });

    it("should create table with foreign key reference", () => {
      const postsTable: TableDefinition = {
        name: "posts",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "title", type: "varchar(255)" },
          {
            name: "author_id",
            type: "uuid",
            references: {
              table: "users",
              column: "id",
              onDelete: "cascade",
            },
          },
        ],
      };

      const authorColumn = postsTable.columns.find(c => c.name === "author_id");
      expect(authorColumn?.references).toBeDefined();
      expect(authorColumn?.references?.table).toBe("users");
      expect(authorColumn?.references?.column).toBe("id");
      expect(authorColumn?.references?.onDelete).toBe("cascade");
    });

    it("should create table with generated column", () => {
      const table: TableDefinition = {
        name: "products",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "price", type: "decimal(10,2)" },
          { name: "tax_rate", type: "decimal(3,2)" },
          {
            name: "total_price",
            type: "decimal(10,2)",
            generated: {
              as: "price * (1 + tax_rate)",
              stored: true,
            },
          },
        ],
      };

      const generatedColumn = table.columns.find(c => c.name === "total_price");
      expect(generatedColumn?.generated).toBeDefined();
      expect(generatedColumn?.generated?.as).toBe("price * (1 + tax_rate)");
      expect(generatedColumn?.generated?.stored).toBe(true);
    });

    it("should create table with check constraint", () => {
      const table: TableDefinition = {
        name: "users",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "age", type: "int", check: "age >= 0 AND age <= 150" },
        ],
      };

      const ageColumn = table.columns.find(c => c.name === "age");
      expect(ageColumn?.check).toBe("age >= 0 AND age <= 150");
    });

    it("should create alter table operations", () => {
      const operations: AlterTableOperation[] = [
        {
          kind: "add_column",
          column: { name: "status", type: "varchar(20)", default: "draft" },
        },
        {
          kind: "drop_column",
          columnName: "old_field",
        },
        {
          kind: "rename_column",
          from: "name",
          to: "full_name",
        },
        {
          kind: "modify_column",
          column: { name: "email", type: "varchar(320)" },
        },
        {
          kind: "add_constraint",
          constraint: {
            name: "check_status",
            type: "check",
            expression: "status IN ('draft', 'published')",
          },
        },
      ];

      expect(operations).toHaveLength(5);
      expect(operations[0].kind).toBe("add_column");
      expect(operations[1].kind).toBe("drop_column");
      expect(operations[2].kind).toBe("rename_column");
      expect(operations[3].kind).toBe("modify_column");
      expect(operations[4].kind).toBe("add_constraint");
    });

    it("should create table with composite primary key", () => {
      const table: TableDefinition = {
        name: "user_roles",
        columns: [
          { name: "user_id", type: "uuid" },
          { name: "role_id", type: "uuid" },
          { name: "assigned_at", type: "timestamp" },
        ],
        primaryKey: ["user_id", "role_id"],
      };

      expect(table.primaryKey).toEqual(["user_id", "role_id"]);
    });

    it("should create table with table-level constraint", () => {
      const table: TableDefinition = {
        name: "posts",
        columns: [
          { name: "id", type: "uuid", primaryKey: true },
          { name: "title", type: "varchar(255)" },
          { name: "slug", type: "varchar(255)" },
        ],
        constraints: [
          {
            name: "posts_title_slug_unique",
            type: "unique",
            columns: ["title", "slug"],
          },
        ],
      };

      expect(table.constraints).toHaveLength(1);
      expect(table.constraints?.[0].type).toBe("unique");
      expect(table.constraints?.[0].columns).toEqual(["title", "slug"]);
    });
  });

  describe("Tree-shaking Verification", () => {
    it("should not export any builder functions yet", () => {
      const exports = Object.keys(schemaExports);
      const builderFunctions = exports.filter(
        key =>
          key.includes("builder") ||
          key.includes("Builder") ||
          key.includes("create") ||
          key.includes("generate")
      );

      expect(builderFunctions).toHaveLength(0);
    });

    it("should only export metadata constants (no utility functions)", () => {
      const exports = Object.keys(schemaExports);
      const constants = exports.filter(key => key === key.toUpperCase());

      // Should only have SCHEMA_VERSION and SCHEMA_BUILDER_AVAILABLE
      expect(constants).toHaveLength(2);
      expect(constants).toContain("SCHEMA_VERSION");
      expect(constants).toContain("SCHEMA_BUILDER_AVAILABLE");
    });
  });
});
