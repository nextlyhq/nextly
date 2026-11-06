/**
 * `nextly migrate` runs an app file only as it was when its deletions were
 * judged under the lock: the files are read again before they run, and a file
 * edited in between (or one that appeared) would otherwise run unjudged.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { runFileMigrations } from "../migrate";

const FILE = "20260101_000000_000_init.sql";
const UP = "CREATE TABLE judged_posts (id integer)";

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

describe("app files run as they were judged", () => {
  let testDb: TestDb;
  let dir: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    dir = mkdtempSync(join(tmpdir(), "nextly-judged-files-"));
    writeFileSync(join(dir, FILE), `-- UP\n${UP};`);
  });

  afterEach(async () => {
    await testDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function run(judged: ReadonlyMap<string, string>): Promise<number> {
    const quiet = () => {};
    return runFileMigrations({
      adapter: testDb.adapter as unknown as Parameters<
        typeof runFileMigrations
      >[0]["adapter"],
      db: testDb.db,
      dialect: "sqlite",
      migrationsDir: dir,
      logger: {
        info: quiet,
        warn: quiet,
        debug: quiet,
        success: quiet,
        error: quiet,
        newline: quiet,
        keyValue: quiet,
      } as unknown as Parameters<typeof runFileMigrations>[0]["logger"],
      judged,
    });
  }

  it("refuses a file edited after it was judged, naming it, and runs nothing", async () => {
    await expect(
      run(new Map([[FILE, digest("DROP TABLE posts")]]))
    ).rejects.toMatchObject({
      publicMessage: expect.stringContaining(FILE),
    });
    expect(await testDb.adapter.tableExists("judged_posts")).toBe(false);
  });

  it("refuses a file to run that was not judged", async () => {
    await expect(run(new Map())).rejects.toMatchObject({
      publicMessage: expect.stringContaining(FILE),
    });
    expect(await testDb.adapter.tableExists("judged_posts")).toBe(false);
  });
});
