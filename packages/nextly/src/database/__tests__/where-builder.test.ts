// Tests for the WhereClause to Drizzle condition translator.
// Verifies all operators, AND/OR combinations, nested clauses, and error cases.
import type { WhereClause } from "@revnixhq/adapter-drizzle/types";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { describe, it, expect } from "vitest";

import { buildDrizzleWhere } from "../where-builder";

// Test table definition
const testTable = pgTable("test_table", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
  is_active: boolean("is_active"),
  created_at: timestamp("created_at"),
});

describe("buildDrizzleWhere", () => {
  it("returns undefined for empty where clause", () => {
    const result = buildDrizzleWhere(testTable, {});
    expect(result).toBeUndefined();
  });

  it("returns undefined for where clause with empty arrays", () => {
    const result = buildDrizzleWhere(testTable, { and: [], or: [] });
    expect(result).toBeUndefined();
  });

  it("builds eq condition for = operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "=", value: "Mobeen" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds ne condition for != operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "!=", value: "test" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds gt condition for > operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: ">", value: 18 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds lt condition for < operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "<", value: 100 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds gte condition for >= operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: ">=", value: 18 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds lte condition for <= operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "<=", value: 65 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds multiple AND conditions", () => {
    const where: WhereClause = {
      and: [
        { column: "name", op: "=", value: "Mobeen" },
        { column: "age", op: ">", value: 18 },
      ],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("builds OR conditions", () => {
    const where: WhereClause = {
      or: [
        { column: "name", op: "=", value: "Alice" },
        { column: "name", op: "=", value: "Bob" },
      ],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles IS NULL operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "IS NULL" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles IS NOT NULL operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "IS NOT NULL" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles IN operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "IN", value: ["Alice", "Bob"] }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles NOT IN operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "NOT IN", value: ["Alice", "Bob"] }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles LIKE operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "LIKE", value: "%test%" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles ILIKE operator", () => {
    const where: WhereClause = {
      and: [{ column: "name", op: "ILIKE", value: "%test%" }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles BETWEEN operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "BETWEEN", value: 18, valueTo: 65 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles NOT BETWEEN operator", () => {
    const where: WhereClause = {
      and: [{ column: "age", op: "NOT BETWEEN", value: 0, valueTo: 10 }],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("throws for unknown column name", () => {
    const where: WhereClause = {
      and: [{ column: "nonexistent", op: "=", value: "test" }],
    };
    expect(() => buildDrizzleWhere(testTable, where)).toThrow(
      /column.*nonexistent.*not found/i
    );
  });

  it("handles combined AND and OR", () => {
    const where: WhereClause = {
      and: [{ column: "is_active", op: "=", value: true }],
      or: [
        { column: "name", op: "=", value: "Alice" },
        { column: "name", op: "=", value: "Bob" },
      ],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });

  it("handles nested WhereClause in and array", () => {
    const where: WhereClause = {
      and: [
        { column: "is_active", op: "=", value: true },
        {
          or: [
            { column: "name", op: "=", value: "Alice" },
            { column: "name", op: "=", value: "Bob" },
          ],
        },
      ],
    };
    const result = buildDrizzleWhere(testTable, where);
    expect(result).toBeDefined();
  });
});
