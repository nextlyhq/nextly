/**
 * The escape hatch, and what it refuses.
 *
 * The refusals are the point. Payload allows a per-dialect Drizzle hook and
 * loses whatever its codegen cannot express, silently — so a check constraint
 * or a partial index exists on the developer's machine and on no deployment.
 * Each case here would be exactly that loss.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer as pgInteger,
  pgTable,
  text as pgText,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { runAfterDrizzle, type DrizzleSchemaHook } from "../after-drizzle";
import type { SchemaOwner } from "../types";

const OWNERS = new Map<string, SchemaOwner>([
  ["app_notes", { kind: "app" }],
  ["fx__widgets", { kind: "plugin", id: "fx" }],
]);
const PROTECTED = new Set(["users", "dc_posts"]);

async function run(hook: DrizzleSchemaHook) {
  return runAfterDrizzle({
    dialect: "postgresql",
    tables: {},
    hooks: [hook],
    owners: OWNERS,
    protectedTables: PROTECTED,
  });
}

async function refusal(hook: DrizzleSchemaHook): Promise<string> {
  try {
    await run(hook);
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected the hook to be refused, and it was accepted");
}

describe("accepted", () => {
  it("leaves the tables untouched when there are no hooks", async () => {
    const tables = { app_notes: pgTable("app_notes", { id: pgText("id") }) };
    const out = await runAfterDrizzle({
      dialect: "postgresql",
      tables,
      hooks: [],
      owners: OWNERS,
      protectedTables: PROTECTED,
    });
    expect(out).toBe(tables);
  });

  it("accepts an app table with an ordinary index", async () => {
    // The positive control. Every refusal below is only meaningful if the
    // convertible case actually passes.
    const out = await run(() => ({
      app_notes: pgTable(
        "app_notes",
        { id: varchar("id", { length: 36 }), body: pgText("body") },
        t => [index("idx_app_notes_body").on(t.body)]
      ),
    }));
    expect(Object.keys(out)).toEqual(["app_notes"]);
  });

  it("accepts a unique INDEX, which the diff engine can reconcile", async () => {
    const out = await run(() => ({
      app_notes: pgTable(
        "app_notes",
        { id: varchar("id", { length: 36 }) },
        t => [uniqueIndex("uq_app_notes_id").on(t.id)]
      ),
    }));
    expect(Object.keys(out)).toEqual(["app_notes"]);
  });
});

describe("refused: constructs migrations cannot carry", () => {
  it("refuses a partial index, which the converter drops", async () => {
    // Dropped silently, so the index reaches the database covering fewer rows
    // than the spec claims — and drift never reports it.
    expect(
      await refusal(() => ({
        app_notes: pgTable(
          "app_notes",
          { id: pgText("id"), done: boolean("done") },
          t => [
            index("idx_app_notes_done")
              .on(t.done)
              .where(sql`${t.done} = true`),
          ]
        ),
      }))
    ).toMatch(/partial index/);
  });

  it("refuses an expression index, which converts with no columns", async () => {
    // An index-count comparison finds the right NUMBER and the wrong ones.
    expect(
      await refusal(() => ({
        app_notes: pgTable("app_notes", { id: pgText("id") }, t => [
          index("idx_app_notes_lower").on(sql`lower(${t.id})`),
        ]),
      }))
    ).toMatch(/expression index/);
  });

  it("refuses a column-level unique constraint", async () => {
    expect(
      await refusal(() => ({
        app_notes: pgTable("app_notes", {
          id: varchar("id", { length: 36 }).unique(),
        }),
      }))
    ).toMatch(/column-level unique constraint/);
  });

  it("refuses a generated column", async () => {
    expect(
      await refusal(() => ({
        app_notes: pgTable("app_notes", {
          id: pgText("id"),
          shout: pgText("shout").generatedAlwaysAs(sql`upper(id)`),
        }),
      }))
    ).toMatch(/generated column/);
  });

  it("refuses an identity column", async () => {
    expect(
      await refusal(() => ({
        app_notes: pgTable("app_notes", {
          id: pgInteger("id").generatedAlwaysAsIdentity(),
        }),
      }))
    ).toMatch(/identity column|generated column/);
  });
});

describe("refused: tables that are not the app's to shape", () => {
  it("refuses touching a core table", async () => {
    expect(
      await refusal(() => ({ users: pgTable("users", { id: pgText("id") }) }))
    ).toMatch(/core or entity table/);
  });

  it("refuses touching an entity table", async () => {
    expect(
      await refusal(() => ({
        dc_posts: pgTable("dc_posts", { id: pgText("id") }),
      }))
    ).toMatch(/core or entity table/);
  });

  it("refuses touching a plugin's table, naming the plugin", async () => {
    // The plugin's own migrations own that table; an app reshaping it would
    // make those migrations disagree with the table they maintain.
    expect(
      await refusal(() => ({
        fx__widgets: pgTable("fx__widgets", { id: pgText("id") }),
      }))
    ).toMatch(/owned by plugin "fx"/);
  });

  it("refuses a key that disagrees with the table's SQL name", async () => {
    expect(
      await refusal(() => ({
        app_notes: pgTable("something_else", { id: pgText("id") }),
      }))
    ).toMatch(/SQL name is "something_else"/);
  });
});
