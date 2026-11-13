/**
 * The parts of the gate's database handling that need no server: what a
 * PostgreSQL dump keeps for its restore, and the CHECK constraints read from a
 * SQLite table's statement.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Sqlite from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { operationsBetween } from "./catalog";
import { readCatalog, restorablePostgresDump, sqliteChecks } from "./database";

describe("restorablePostgresDump", () => {
  const dumped = [
    "\\restrict abc",
    "-- PostgreSQL database dump",
    "SET statement_timeout = 0;",
    "SET transaction_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "CREATE TABLE public.users (",
    "    id text NOT NULL",
    ");",
    "\\unrestrict abc",
  ].join("\n");

  it("keeps the statements and drops psql commands, comments and session settings", () => {
    const kept = restorablePostgresDump(dumped);
    // A setting a newer server knows (transaction_timeout is PostgreSQL 17's)
    // would stop the restore on an older one, and none of them changes what
    // the restore builds.
    expect(kept).not.toMatch(/^SET /m);
    expect(kept).not.toMatch(/^\\/m);
    expect(kept).not.toMatch(/^--/m);
    expect(kept).toContain("CREATE TABLE public.users (");
    expect(kept).toContain(
      "SELECT pg_catalog.set_config('search_path', '', false);"
    );
  });
});

describe("sqliteChecks", () => {
  it("names each CHECK, by its constraint name or else by its expression", () => {
    expect(
      sqliteChecks(
        `CREATE TABLE "t" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL CHECK ("email" <> ''),
  "kind" text,
  CONSTRAINT "t_kind_check" CHECK ("kind" IN ('a', 'b') AND length("kind") > 0)
)`
      )
    ).toEqual({
      "check (\"email\" <> '')": "check (\"email\" <> '')",
      t_kind_check: "check (\"kind\" IN ('a', 'b') AND length(\"kind\") > 0)",
    });
  });

  it("finds none in a table without one, and ignores the word inside a string", () => {
    expect(
      sqliteChecks(`CREATE TABLE "t" ("note" text DEFAULT 'CHECK (x)')`)
    ).toEqual({});
  });
});

describe("the SQLite catalog", () => {
  it("reads a CHECK added to an existing table as an operation", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-check-"));
    try {
      const read = async (ddl: string) => {
        const file = join(
          scratch,
          `${Math.random().toString(36).slice(2)}.sqlite`
        );
        const db = new Sqlite(file);
        db.exec(ddl);
        db.close();
        return readCatalog("sqlite", `file:${file}`);
      };
      const before = await read(`CREATE TABLE "t" ("kind" text)`);
      const after = await read(
        `CREATE TABLE "t" ("kind" text, CONSTRAINT "t_kind_check" CHECK ("kind" IN ('a', 'b')))`
      );
      expect(operationsBetween(before, after)).toEqual([
        "add constraint t.t_kind_check: check (\"kind\" IN ('a', 'b'))",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
