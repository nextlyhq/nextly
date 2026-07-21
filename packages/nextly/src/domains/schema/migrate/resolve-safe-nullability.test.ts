/**
 * Which nullability changes count as destructive.
 *
 * Requiring a column fails only on rows that already hold NULL, so the
 * question is about the data, not the schema flag. Answering it from the flag
 * alone refuses every column that merely looks newly-required — and on SQLite
 * that is every primary key, because a TEXT PRIMARY KEY reports as nullable
 * there while the desired side treats a primary key as required.
 */
import { describe, expect, it, vi } from "vitest";

import type { Operation } from "../pipeline/diff/types";

import { resolveSafeNullabilityOps } from "./resolve-safe-nullability";

function requireOp(column: string): Operation {
  return {
    type: "change_column_nullable",
    tableName: "nextly_events",
    columnName: column,
    toNullable: false,
  } as Operation;
}

function relaxOp(column: string): Operation {
  return {
    type: "change_column_nullable",
    tableName: "nextly_events",
    columnName: column,
    toNullable: true,
  } as Operation;
}

describe("resolveSafeNullabilityOps", () => {
  it("drops a require-op when the column holds no NULL", async () => {
    // The false refusal: every SQLite primary key looked newly-required.
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    expect(await resolveSafeNullabilityOps(db, [requireOp("id")])).toEqual([]);
  });

  it("keeps a require-op when the column does hold NULL", async () => {
    // Genuinely destructive: the change would fail on an existing row.
    const db = { execute: vi.fn(async () => ({ rows: [{ one: 1 }] })) };
    expect(await resolveSafeNullabilityOps(db, [requireOp("id")])).toHaveLength(
      1
    );
  });

  it("never probes a relax-op, which cannot fail on existing rows", async () => {
    // Probing it would drop it on the usual no-NULLs answer, so relaxing a
    // column would be classified away and the constraint never lifted.
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    const out = await resolveSafeNullabilityOps(db, [relaxOp("actor_id")]);

    expect(out).toHaveLength(1);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("passes every other op through untouched", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    const other = {
      type: "add_column",
      tableName: "t",
    } as unknown as Operation;
    expect(await resolveSafeNullabilityOps(db, [other])).toEqual([other]);
  });

  it("treats an unreadable column as holding NULL", async () => {
    // An unknown must stay destructive; assuming safe is how a real
    // data-losing change slips through.
    const db = {
      execute: vi.fn(async () => {
        throw new Error("no such table");
      }),
    };
    expect(await resolveSafeNullabilityOps(db, [requireOp("id")])).toHaveLength(
      1
    );
  });
});
