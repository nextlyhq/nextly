/**
 * Reading the migration headers, against real files on disk.
 *
 * 🔴 The sweep's own tests replace this reader through a seam, so everything it
 * decides — which variant to open, which slugs a header names, and which files
 * name nothing at all — is unexercised there by construction. This is the only
 * place those answers are checked against files rather than against a stub.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readPendingEntities } from "../pending-entities";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-entities-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function migration(file: string, headerLines: string[]): void {
  writeFileSync(
    join(dir, file),
    [`-- Migration: ${file}`, ...headerLines, "", "-- UP", "SELECT 1;"].join(
      "\n"
    )
  );
}

const silent = { warn: () => {}, debug: () => {} };

describe("readPendingEntities", () => {
  it("collects slugs from unapplied migrations, by kind", async () => {
    migration("0001_a.sql", ["-- Collections: posts"]);
    migration("0002_b.sql", ["-- Singles: home"]);
    migration("0003_c.sql", ["-- Field groups: hero"]);

    const pending = await readPendingEntities({
      migrationsDir: dir,
      isApplied: async () => false,
      logger: silent,
    });

    expect([...pending.collections]).toEqual(["posts"]);
    expect([...pending.singles]).toEqual(["home"]);
    expect([...pending.components]).toEqual(["hero"]);
  });

  it("ignores a migration the ledger says has been applied", async () => {
    // The control for the case above. Without it, a reader that ignored the
    // ledger entirely would satisfy it.
    migration("0001_a.sql", ["-- Collections: posts"]);

    const pending = await readPendingEntities({
      migrationsDir: dir,
      isApplied: async () => true,
      logger: silent,
    });

    expect([...pending.collections]).toEqual([]);
  });

  /*
   * 🔴 A blank migration carries arbitrary hand-written SQL and no entity
   * header, so its scope is UNKNOWN rather than empty. Recorded by name so the
   * run can say so: promoting silently is what leaves an operator with rows
   * marked migrated by a rule that could not see the migration changing them.
   */
  it("records an unapplied migration that names nothing, rather than dropping it", async () => {
    migration("0001_blank.sql", []);
    migration("0002_named.sql", ["-- Collections: posts"]);

    const pending = await readPendingEntities({
      migrationsDir: dir,
      isApplied: async () => false,
      logger: silent,
    });

    expect(pending.unscoped).toEqual(["0001_blank.sql"]);
    // And it does not contaminate the named sets.
    expect([...pending.collections]).toEqual(["posts"]);
  });

  it("does not record an APPLIED headerless migration as unscoped", async () => {
    // It cannot be holding anything back, so naming it would send an operator
    // to annotate a file that has already run.
    migration("0001_blank.sql", []);

    const pending = await readPendingEntities({
      migrationsDir: dir,
      isApplied: async () => true,
      logger: silent,
    });

    expect(pending.unscoped).toEqual([]);
  });

  /*
   * 🔴 Reads the variant the apply path will run. A group holding a base file
   * beside a dialect override can carry different headers, and reading the
   * wrong one names no slug — promoting a row while the file that will really
   * execute is still outstanding.
   */
  it("reads the dialect variant's header, not the base file's", async () => {
    migration("0001_x.sql", []);
    migration("0001_x.mysql.sql", ["-- Collections: posts"]);

    const forMysql = await readPendingEntities({
      migrationsDir: dir,
      dialect: "mysql",
      isApplied: async () => false,
      logger: silent,
    });
    expect([...forMysql.collections]).toEqual(["posts"]);

    // The control: without a dialect the base file is read, which names
    // nothing — so the assertion above is about variant selection rather than
    // about the reader finding the slug wherever it happens to be.
    const noDialect = await readPendingEntities({
      migrationsDir: dir,
      isApplied: async () => false,
      logger: silent,
    });
    expect([...noDialect.collections]).toEqual([]);
    expect(noDialect.unscoped).toEqual(["0001_x.sql"]);
  });

  it("asks the ledger for the group's base name, not a variant's", async () => {
    // `runFileMigrations` records `0001_x.sql` whether it executed the base or
    // the `.mysql.sql`; asking about the variant would report a migration that
    // ran as outstanding and hold its entities back forever.
    migration("0001_x.sql", ["-- Collections: posts"]);
    migration("0001_x.mysql.sql", ["-- Collections: posts"]);
    const asked: string[] = [];

    await readPendingEntities({
      migrationsDir: dir,
      dialect: "mysql",
      isApplied: async name => {
        asked.push(name);
        return false;
      },
      logger: silent,
    });

    expect(asked).toEqual(["0001_x.sql"]);
  });

  it("returns nothing for a directory that does not exist", async () => {
    const pending = await readPendingEntities({
      migrationsDir: join(dir, "absent"),
      isApplied: async () => false,
      logger: silent,
    });

    expect([...pending.collections]).toEqual([]);
    expect(pending.unscoped).toEqual([]);
  });
});
