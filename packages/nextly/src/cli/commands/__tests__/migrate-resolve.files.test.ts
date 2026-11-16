/**
 * Which file `migrate:resolve` reads for a migration: the one `nextly migrate`
 * reads on the dialect, its variant before the base file. Recording the base
 * file's checksum where the run reads a variant would make every later run
 * refuse the migration as edited.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrationFileIn } from "../migrate-resolve";

describe("migrationFileIn", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-resolve-files-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string): void {
    writeFileSync(join(dir, name), `-- ${name}\n`, "utf8");
  }

  it("reads the dialect's variant before the base file, by bare or .sql name", async () => {
    write("0001_x.sql");
    write("0001_x.postgresql.sql");
    expect(await migrationFileIn(dir, "0001_x.sql", "postgresql")).toBe(
      join(dir, "0001_x.postgresql.sql")
    );
    expect(await migrationFileIn(dir, "0001_x", "postgresql")).toBe(
      join(dir, "0001_x.postgresql.sql")
    );
    expect(await migrationFileIn(dir, "0001_x.sql", "mysql")).toBe(
      join(dir, "0001_x.sql")
    );
  });

  it("finds a migration shipped only as a variant, and nothing for one the folder lacks", async () => {
    write("0002_y.sqlite.sql");
    expect(await migrationFileIn(dir, "0002_y.sql", "sqlite")).toBe(
      join(dir, "0002_y.sqlite.sql")
    );
    expect(await migrationFileIn(dir, "0003_z.sql", "sqlite")).toBeUndefined();
  });
});
