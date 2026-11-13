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
import {
  dump,
  readCatalog,
  restorablePostgresDump,
  restore,
  sqliteChecks,
} from "./database";

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

  it("leaves a value's text whole, however its lines read", () => {
    const insert = [
      "INSERT INTO public.notes VALUES ('first",
      "-- user content",
      "\\ backslash line",
      "SET x = 1;",
      "",
      "",
      "",
      "last');",
    ].join("\n");
    expect(restorablePostgresDump(`SET a = 0;\n${insert}\n-- end`)).toBe(
      insert
    );
  });

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

describe("the SQLite catalog's indexes", () => {
  /** The operations between two databases built by `before` and `after`. */
  async function operations(before: string, after: string) {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-index-"));
    try {
      const read = async (name: string, ddl: string) => {
        const file = join(scratch, `${name}.sqlite`);
        const db = new Sqlite(file);
        db.exec(ddl);
        db.close();
        return readCatalog("sqlite", `file:${file}`);
      };
      return operationsBetween(
        await read("before", before),
        await read("after", after)
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const table = `CREATE TABLE "t" ("email" text);`;

  it("reads an index rebuilt with another collation as a change", async () => {
    expect(
      await operations(
        `${table} CREATE UNIQUE INDEX "t_email" ON "t" ("email");`,
        `${table} CREATE UNIQUE INDEX "t_email" ON "t" ("email" COLLATE NOCASE);`
      )
    ).toEqual([
      "change index t.t_email: unique (email) -> unique (email collate NOCASE)",
    ]);
  });

  it("reads an index rebuilt over another expression as a change", async () => {
    expect(
      await operations(
        `${table} CREATE INDEX "t_email" ON "t" (lower("email"));`,
        `${table} CREATE INDEX "t_email" ON "t" (upper("email"));`
      )
    ).toEqual(['change index t.t_email: (lower("email")) -> (upper("email"))']);
  });

  it("reads an index whose direction changed as a change, and the same index written another way as none", async () => {
    expect(
      await operations(
        `${table} CREATE INDEX "t_email" ON "t" ("email");`,
        `${table} CREATE INDEX "t_email" ON "t" ("email" DESC);`
      )
    ).toEqual(["change index t.t_email: (email) -> (email desc)"]);
    expect(
      await operations(
        `${table} CREATE INDEX "t_email" ON "t" ("email");`,
        `${table} CREATE INDEX IF NOT EXISTS \`t_email\` ON \`t\` (\`email\` ASC);`
      )
    ).toEqual([]);
  });
});

describe("the SQLite catalog's generated columns", () => {
  async function operations(before: string, after: string) {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-generated-"));
    try {
      const read = async (name: string, ddl: string) => {
        const file = join(scratch, `${name}.sqlite`);
        const db = new Sqlite(file);
        db.exec(ddl);
        db.close();
        return readCatalog("sqlite", `file:${file}`);
      };
      return operationsBetween(
        await read("before", before),
        await read("after", after)
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const table = (total: string) =>
    `CREATE TABLE "t" ("price" integer, "quantity" integer, "total" integer GENERATED ALWAYS AS ${total})`;

  it("reads a generated column whose expression changed as a change", async () => {
    expect(
      await operations(
        table('("price" * "quantity")'),
        table('("price" + "quantity")')
      )
    ).toEqual([
      'change column t.total: integer null as ("price" * "quantity") virtual -> integer null as ("price" + "quantity") virtual',
    ]);
  });

  it("reads a virtual column made stored as a change", async () => {
    expect(
      await operations(
        table('("price" * "quantity") VIRTUAL'),
        table('("price" * "quantity") STORED')
      )
    ).toEqual([
      'change column t.total: integer null as ("price" * "quantity") virtual -> integer null as ("price" * "quantity") stored',
    ]);
  });
});

describe("the SQLite catalog's column collations", () => {
  it("reads a column whose collation changed as a change", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-collate-"));
    try {
      const read = async (name: string, ddl: string) => {
        const file = join(scratch, `${name}.sqlite`);
        const db = new Sqlite(file);
        db.exec(ddl);
        db.close();
        return readCatalog("sqlite", `file:${file}`);
      };
      expect(
        operationsBetween(
          await read("before", `CREATE TABLE "t" ("email" text)`),
          await read("after", `CREATE TABLE "t" ("email" text COLLATE NOCASE)`)
        )
      ).toEqual([
        "change column t.email: text null -> text null collate NOCASE",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("a SQLite dump", () => {
  it("restores a table with a generated column, writing only what is stored", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-sqlite-dump-"));
    try {
      const from = join(scratch, "from.sqlite");
      const db = new Sqlite(from);
      db.exec(
        `CREATE TABLE "t" ("price" integer, "quantity" integer, "total" integer GENERATED ALWAYS AS ("price" * "quantity") STORED);
         INSERT INTO "t" ("price", "quantity") VALUES (2, 3);`
      );
      db.close();
      const to = join(scratch, "to.sqlite");
      await restore(
        "sqlite",
        `file:${to}`,
        await dump("sqlite", `file:${from}`)
      );
      const restored = new Sqlite(to);
      try {
        expect(restored.prepare(`SELECT * FROM "t"`).all()).toEqual([
          { price: 2, quantity: 3, total: 6 },
        ]);
      } finally {
        restored.close();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("whitespace in SQLite definitions", () => {
  it("reads a generated column whose string literal's spacing changed as a change", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-space-"));
    try {
      const read = async (name: string, literal: string) => {
        const file = join(scratch, `${name}.sqlite`);
        const db = new Sqlite(file);
        db.exec(
          `CREATE TABLE "t" ("x" text, "y" text GENERATED ALWAYS AS (${literal} || "x"))`
        );
        db.close();
        return readCatalog("sqlite", `file:${file}`);
      };
      expect(
        operationsBetween(
          await read("one", "'a b'"),
          await read("two", "'a  b'")
        )
      ).toEqual([
        "change column t.y: text null as ('a b' || \"x\") virtual -> text null as ('a  b' || \"x\") virtual",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("a SQLite dump of an AUTOINCREMENT table", () => {
  it("restores the sequence's high-water mark, not one the restored rows imply", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "upgrade-gate-sequence-"));
    try {
      const from = join(scratch, "from.sqlite");
      const db = new Sqlite(from);
      db.exec(
        `CREATE TABLE "t" ("id" integer PRIMARY KEY AUTOINCREMENT, "v" text);
         INSERT INTO "t" ("id", "v") VALUES (1, 'kept'), (10, 'gone');
         DELETE FROM "t" WHERE "id" = 10;`
      );
      db.close();
      const to = join(scratch, "to.sqlite");
      await restore(
        "sqlite",
        `file:${to}`,
        await dump("sqlite", `file:${from}`)
      );
      const restored = new Sqlite(to);
      try {
        restored.exec(`INSERT INTO "t" ("v") VALUES ('next')`);
        expect(
          restored.prepare(`SELECT "id" FROM "t" WHERE "v" = 'next'`).get()
        ).toEqual({ id: 11 });
      } finally {
        restored.close();
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
