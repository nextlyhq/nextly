// Phase 7 Task 5 — the phantom-diff gate (Issue 6.2 family).
//
// Failure class: the pipeline applies a change, then immediately re-detects a
// difference on the very next run — because the runtime table builder's idea
// of a column type doesn't exactly match what v1's introspection reports
// back. Symptom: "N pending changes" forever on an unchanged project, and
// re-applies on every boot.
//
// The gate: runtime-generate a dynamic collection covering EVERY column kind
// the field builder can emit, apply it with v1's kit, run detection again
// with zero edits, and assert v1 proposes NOTHING — per dialect. This is the
// permanent regression pin for the drift-noise issue class and re-runs on
// every future Drizzle pin bump.

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool } from "mysql2";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../../../../../database/drizzle-kit-lazy";
import {
  generateRuntimeSchema,
  type FieldDefinition,
} from "../../../services/runtime-schema-generator";

// Every column-producing field type the descriptor supports (relationship/
// upload produce FK-ish columns; repeater/group/json/chips produce JSON).
const ALL_FIELD_KINDS: FieldDefinition[] = [
  { name: "f_text", type: "text", required: true },
  { name: "f_email", type: "email" },
  { name: "f_password", type: "password" },
  { name: "f_select", type: "select" },
  { name: "f_radio", type: "radio" },
  { name: "f_textarea", type: "textarea" },
  { name: "f_richtext", type: "richText" },
  { name: "f_code", type: "code" },
  { name: "f_number", type: "number" },
  { name: "f_checkbox", type: "checkbox" },
  { name: "f_date", type: "date" },
  { name: "f_json", type: "json" },
  { name: "f_chips", type: "chips" },
  { name: "f_group", type: "group" },
  { name: "f_repeater", type: "repeater" },
];

const TABLE = "dc_phantom_gate";

describe("phantom-diff gate — apply once, re-detect must be silent", () => {
  it("sqlite", async () => {
    const sqlite = new Database(":memory:");
    try {
      const db = drizzleSqlite({ client: sqlite });
      const kit = await getSQLiteDrizzleKit();
      const { schemaRecord } = generateRuntimeSchema(
        TABLE,
        ALL_FIELD_KINDS,
        "sqlite"
      );

      const first = await kit.pushSchema(schemaRecord, db);
      expect(first.sqlStatements.length).toBeGreaterThan(0);
      await first.apply();

      const second = await kit.pushSchema(schemaRecord, db);
      expect(second.sqlStatements).toEqual([]);
      expect(second.hints).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it.skipIf(!process.env.TEST_POSTGRES_URL)("postgres", async () => {
    const pool = new Pool({ connectionString: process.env.TEST_POSTGRES_URL });
    try {
      await pool.query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`);
      const db = drizzlePg({ client: pool });
      const kit = await getPgDrizzleKit();
      const { schemaRecord } = generateRuntimeSchema(
        TABLE,
        ALL_FIELD_KINDS,
        "postgresql"
      );
      const filter = { schemas: ["public"], tables: [TABLE] };

      const first = await kit.pushSchema(schemaRecord, db, filter);
      expect(first.sqlStatements.length).toBeGreaterThan(0);
      await first.apply();

      const second = await kit.pushSchema(schemaRecord, db, filter);
      expect(second.sqlStatements).toEqual([]);
      expect(second.hints).toEqual([]);
    } finally {
      await pool
        .query(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`)
        .catch(() => {});
      await pool.end();
    }
  });

  it.skipIf(!process.env.TEST_MYSQL_URL)("mysql", async () => {
    const bootstrap = createPool({ uri: process.env.TEST_MYSQL_URL });
    await bootstrap.promise().query("DROP DATABASE IF EXISTS nextly_phantom");
    await bootstrap.promise().query("CREATE DATABASE nextly_phantom");
    const url = new URL(process.env.TEST_MYSQL_URL as string);
    url.pathname = "/nextly_phantom";
    const pool = createPool({ uri: url.toString() });
    try {
      const db = drizzleMysql({ client: pool });
      const kit = await getMySQLDrizzleKit();
      const { schemaRecord } = generateRuntimeSchema(
        TABLE,
        ALL_FIELD_KINDS,
        "mysql"
      );

      const first = await kit.pushSchema(schemaRecord, db, "nextly_phantom");
      expect(first.sqlStatements.length).toBeGreaterThan(0);
      await first.apply();

      const second = await kit.pushSchema(schemaRecord, db, "nextly_phantom");
      expect(second.sqlStatements).toEqual([]);
      expect(second.hints).toEqual([]);
    } finally {
      await new Promise<void>(res => pool.end(() => res()));
      await bootstrap
        .promise()
        .query("DROP DATABASE IF EXISTS nextly_phantom")
        .catch(() => {});
      await new Promise<void>(res => bootstrap.end(() => res()));
    }
  });
});
