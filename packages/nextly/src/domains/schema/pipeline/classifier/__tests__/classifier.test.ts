// Unit tests for RealClassifier — F5 NOT NULL detection from typed Operation[].

import { describe, it, expect, vi } from "vitest";

import type { Operation } from "../../diff/types.js";
import { RealClassifier } from "../classifier.js";

const noopWarnings: string[] = [];

describe("RealClassifier — NOT NULL detection (F5)", () => {
  it("emits add_not_null_with_nulls when nullable->NOT NULL with NULL rows", async () => {
    const op: Operation = {
      type: "change_column_nullable",
      tableName: "dc_users",
      columnName: "email",
      fromNullable: true,
      toNullable: false,
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn().mockResolvedValue(3),
      countRows: vi.fn().mockResolvedValue(47),
      dialect: "postgresql",
    });
    expect(result.level).toBe("interactive");
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe("add_not_null_with_nulls");
    if (event.kind === "add_not_null_with_nulls") {
      expect(event.tableName).toBe("dc_users");
      expect(event.columnName).toBe("email");
      expect(event.nullCount).toBe(3);
      expect(event.tableRowCount).toBe(47);
      expect(event.applicableResolutions).toEqual([
        "provide_default",
        "make_optional",
        "delete_nonconforming",
        "abort",
      ]);
    }
  });

  it("does NOT emit event when nullable->NOT NULL with zero NULL rows", async () => {
    const op: Operation = {
      type: "change_column_nullable",
      tableName: "dc_users",
      columnName: "email",
      fromNullable: true,
      toNullable: false,
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn().mockResolvedValue(0),
      countRows: vi.fn().mockResolvedValue(47),
      dialect: "postgresql",
    });
    expect(result.level).toBe("safe");
    expect(result.events).toHaveLength(0);
  });

  it("does NOT emit event for NOT NULL->nullable (loosening change)", async () => {
    const op: Operation = {
      type: "change_column_nullable",
      tableName: "dc_users",
      columnName: "email",
      fromNullable: false,
      toNullable: true,
    };
    const countNulls = vi.fn();
    const countRows = vi.fn();
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls,
      countRows,
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(0);
    expect(countNulls).not.toHaveBeenCalled();
    expect(countRows).not.toHaveBeenCalled();
  });

  it("emits add_required_field_no_default for new required field on non-empty table", async () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: { name: "phone", type: "text", nullable: false },
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn(),
      countRows: vi.fn().mockResolvedValue(50),
      dialect: "postgresql",
    });
    expect(result.level).toBe("interactive");
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe("add_required_field_no_default");
    if (event.kind === "add_required_field_no_default") {
      expect(event.applicableResolutions).toEqual([
        "provide_default",
        "make_optional",
        "abort",
      ]);
    }
  });

  it("does NOT emit add_required_field_no_default when table is empty", async () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: { name: "phone", type: "text", nullable: false },
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn(),
      countRows: vi.fn().mockResolvedValue(0),
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(0);
  });

  it("does NOT emit when new required field has a default", async () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: {
        name: "phone",
        type: "text",
        nullable: false,
        default: "''",
      },
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn(),
      countRows: vi.fn().mockResolvedValue(50),
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(0);
  });

  it("does NOT emit when new field is nullable", async () => {
    const op: Operation = {
      type: "add_column",
      tableName: "dc_users",
      column: { name: "phone", type: "text", nullable: true },
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn(),
      countRows: vi.fn().mockResolvedValue(50),
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(0);
  });

  it("emits multiple events from a multi-op apply", async () => {
    const ops: Operation[] = [
      {
        type: "change_column_nullable",
        tableName: "dc_users",
        columnName: "email",
        fromNullable: true,
        toNullable: false,
      },
      {
        type: "add_column",
        tableName: "dc_posts",
        column: { name: "summary", type: "text", nullable: false },
      },
    ];
    const c = new RealClassifier();
    const result = await c.classify({
      operations: ops,
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn().mockResolvedValue(3),
      countRows: vi.fn().mockResolvedValueOnce(47).mockResolvedValueOnce(50),
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(2);
    expect(result.events.map(e => e.kind).sort()).toEqual([
      "add_not_null_with_nulls",
      "add_required_field_no_default",
    ]);
  });

  it("returns level=safe when no operations need user input", async () => {
    const op: Operation = {
      type: "add_table",
      table: { name: "dc_new", columns: [] },
    };
    const c = new RealClassifier();
    const result = await c.classify({
      operations: [op],
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn(),
      countRows: vi.fn(),
      dialect: "postgresql",
    });
    expect(result.level).toBe("safe");
    expect(result.events).toHaveLength(0);
  });
});
