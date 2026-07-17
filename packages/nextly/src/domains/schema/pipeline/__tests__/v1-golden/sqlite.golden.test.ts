// Phase 7 Task 1 — SQLite golden fixtures for drizzle-kit v1 pushSchema.
// See golden-harness.ts for why. Runs on every unit pass (in-memory DB).

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { getSQLiteDrizzleKit } from "../../../../../database/drizzle-kit-lazy";

import {
  assertTextConsumers,
  fixturePath,
  serializeCapture,
  type GoldenScenario,
} from "./golden-harness";

const scenarios: GoldenScenario[] = [
  {
    name: "add-table",
    seed: [],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        title: text("title"),
      }),
    }),
    desiredTableNames: ["g1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "add-column",
    seed: ["CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text);"],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        title: text("title"),
        extra: text("extra"),
      }),
    }),
    desiredTableNames: ["g1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "drop-column",
    seed: [
      "CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text, extra text);",
    ],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        title: text("title"),
      }),
    }),
    desiredTableNames: ["g1"],
    // v1 semantic inversion: the destructive DROP COLUMN arrives INSIDE
    // sqlStatements with empty hints — the scanner MUST flag it.
    expectDestructiveOffenders: "some",
    expectFilterBlocks: [],
  },
  {
    name: "type-change-rebuild",
    seed: ["CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, num text);"],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        num: integer("num"),
      }),
    }),
    desiredTableNames: ["g1"],
    // The __new_ rebuild block is data-preserving; the scanner must
    // recognize its internal DROP TABLE as part of the rebuild.
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-add",
    seed: ["CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text);"],
    desired: () => ({
      g1: sqliteTable(
        "g1",
        {
          id: text("id").primaryKey(),
          title: text("title"),
        },
        t => [index("g1_title_idx").on(t.title)]
      ),
    }),
    desiredTableNames: ["g1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-drop",
    seed: [
      "CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text);",
      "CREATE INDEX g1_title_idx ON g1 (title);",
    ],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        title: text("title"),
      }),
    }),
    desiredTableNames: ["g1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "orphan-table-drop",
    seed: [
      "CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text);",
      "CREATE TABLE orphan_tbl (id text PRIMARY KEY NOT NULL);",
    ],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        title: text("title"),
      }),
    }),
    desiredTableNames: ["g1"],
    // The kit emits DROP TABLE orphan_tbl silently (unpaired drop). Both
    // guards must act: scanner flags it, filter strips it.
    expectDestructiveOffenders: "some",
    expectFilterBlocks: ["orphan_tbl"],
  },
  {
    name: "rename-shape-crash",
    seed: ["CREATE TABLE g1 (id text PRIMARY KEY NOT NULL, title text);"],
    desired: () => ({
      g1: sqliteTable("g1", {
        id: text("id").primaryKey(),
        name: text("name"),
      }),
    }),
    desiredTableNames: ["g1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
    // v1's rename resolver has no hints channel on the programmatic path —
    // the ambiguous drop+add pair throws deterministically (the pre-v1
    // behavior was an unanswerable TTY prompt). The pipeline's
    // pre-resolution design keeps this shape away from the kit; this pins
    // the failure mode in case it ever leaks through.
    throws: /HintsHandler/,
  },
];

describe("v1 golden SQL — SQLite", () => {
  for (const scenario of scenarios) {
    it(`captures + classifies: ${scenario.name}`, async () => {
      const sqlite = new Database(":memory:");
      try {
        for (const stmt of scenario.seed) sqlite.exec(stmt);
        const db = drizzle({ client: sqlite });
        const kit = await getSQLiteDrizzleKit();

        if (scenario.throws) {
          await expect(kit.pushSchema(scenario.desired(), db)).rejects.toThrow(
            scenario.throws
          );
          return;
        }

        const result = await kit.pushSchema(scenario.desired(), db);
        const captured = {
          sqlStatements: result.sqlStatements,
          hints: result.hints,
        };

        await expect(serializeCapture(captured)).toMatchFileSnapshot(
          fixturePath("sqlite", scenario.name)
        );
        assertTextConsumers(scenario, captured);
      } finally {
        sqlite.close();
      }
    });
  }
});
