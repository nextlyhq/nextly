/**
 * The NOT NULL backfill per field type and dialect, pinned as the literal SQL
 * each dialect receives. Both the collection and the field-group alter paths
 * call this one function, so these values are what either path writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backfillDefaultForType } from "../backfill-default";

const format = (value: unknown): string => `<${String(value)}>`;

function backfill(
  type: string,
  dialect: "postgresql" | "mysql" | "sqlite",
  jsonArrayTypes?: ReadonlySet<string>
): string {
  return backfillDefaultForType({
    type,
    field: { type },
    dialect,
    formatDefaultValue: format,
    ...(jsonArrayTypes ? { jsonArrayTypes } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("backfillDefaultForType", () => {
  it.each([
    ["text", "postgresql", "''"],
    ["select", "mysql", "''"],
    ["radio", "sqlite", "''"],
    ["something-unknown", "postgresql", "''"],
    ["number", "mysql", "0"],
    ["checkbox", "postgresql", "FALSE"],
    ["checkbox", "mysql", "FALSE"],
    ["checkbox", "sqlite", "0"],
    ["date", "postgresql", "NOW()"],
    ["date", "mysql", "NOW()"],
    ["date", "sqlite", String(Date.UTC(2026, 0, 2, 3, 4, 5) / 1000)],
    ["json", "postgresql", "'{}'"],
    ["repeater", "mysql", "(CONVERT(X'7b7d' USING utf8mb4))"],
    ["group", "sqlite", "'{}'"],
    ["relationship", "postgresql", "NULL"],
    ["upload", "sqlite", "NULL"],
  ] as const)("%s on %s is %s", (type, dialect, expected) => {
    expect(backfill(type, dialect)).toBe(expected);
  });

  it("gives a JSON-array type `[]` only where the caller stores one", () => {
    const chips = new Set(["chips"]);
    expect(backfill("chips", "postgresql", chips)).toBe("'[]'");
    expect(backfill("chips", "mysql", chips)).toBe(
      "(CONVERT(X'5b5d' USING utf8mb4))"
    );
    // A caller that stores it as text gets the text empty.
    expect(backfill("chips", "postgresql")).toBe("''");
  });
});
