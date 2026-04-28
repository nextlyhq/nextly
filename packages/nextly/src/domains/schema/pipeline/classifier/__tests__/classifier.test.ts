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

  it("ignores change_column_nullable no-op ops (fromNullable === toNullable)", async () => {
    // The diff engine should never emit no-op ops, but the classifier
    // must defend against them defensively. Locks down the strict
    // tightening-only check at classifier.ts so a future diff bug
    // can't trigger spurious prompts.
    const trueNoop: Operation = {
      type: "change_column_nullable",
      tableName: "dc_users",
      columnName: "email",
      fromNullable: true,
      toNullable: true,
    };
    const falseNoop: Operation = {
      type: "change_column_nullable",
      tableName: "dc_users",
      columnName: "email",
      fromNullable: false,
      toNullable: false,
    };
    const countNulls = vi.fn();
    const countRows = vi.fn();
    const c = new RealClassifier();
    for (const op of [trueNoop, falseNoop]) {
      const result = await c.classify({
        operations: [op],
        drizzleWarnings: noopWarnings,
        hasDataLoss: false,
        countNulls,
        countRows,
        dialect: "postgresql",
      });
      expect(result.events).toHaveLength(0);
      expect(result.level).toBe("safe");
    }
    expect(countNulls).not.toHaveBeenCalled();
    expect(countRows).not.toHaveBeenCalled();
  });

  it("F6: emits type_change event for text -> int", async () => {
    const op: Operation = {
      type: "change_column_type",
      tableName: "dc_users",
      columnName: "age",
      fromType: "text",
      toType: "int",
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
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe("type_change");
    if (event.kind === "type_change") {
      expect(event.fromType).toBe("text");
      expect(event.toType).toBe("int");
      expect(event.isWidening).toBe(false);
      expect(event.perDialectWarning.pg).toMatch(/postgres/i);
    }
  });

  it("F6: does NOT emit when type change is a widening (safe)", async () => {
    const op: Operation = {
      type: "change_column_type",
      tableName: "dc_users",
      columnName: "name",
      fromType: "varchar(50)",
      toType: "varchar(255)",
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
    expect(result.events).toHaveLength(0);
    expect(result.level).toBe("safe");
  });

  it("F6: classifies as destructive (not interactive) when only type changes are present", async () => {
    // Type changes have no resolutions in v1 — they surface as
    // destructive-warning prompts. Only NOT-NULL events bump level to
    // interactive (since they have resolution kinds).
    const op: Operation = {
      type: "change_column_type",
      tableName: "dc_users",
      columnName: "age",
      fromType: "text",
      toType: "int",
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
    expect(result.level).toBe("destructive");
  });

  it("F5+F6: NOT-NULL event keeps level=interactive even alongside type changes", async () => {
    const ops: Operation[] = [
      {
        type: "change_column_nullable",
        tableName: "dc_users",
        columnName: "email",
        fromNullable: true,
        toNullable: false,
      },
      {
        type: "change_column_type",
        tableName: "dc_users",
        columnName: "age",
        fromType: "text",
        toType: "int",
      },
    ];
    const c = new RealClassifier();
    const result = await c.classify({
      operations: ops,
      drizzleWarnings: noopWarnings,
      hasDataLoss: false,
      countNulls: vi.fn().mockResolvedValue(3),
      countRows: vi.fn().mockResolvedValue(47),
      dialect: "postgresql",
    });
    expect(result.events).toHaveLength(2);
    expect(result.level).toBe("interactive");
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
