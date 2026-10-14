/**
 * Two instances on one SQLite file are two processes, each with its own
 * connection, serialised only by the file's lock. The rest of the store's
 * suite runs both handles on one connection in one process (two connections
 * in one process stall each other, since better-sqlite3 waits for a locked
 * file synchronously); here the second instance is a real second process, so
 * an update that held only because of one process's transaction queue would
 * lose counts or deadlock.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  createDatabaseLimitStore,
  type DatabaseLimitStore,
} from "../database-limit-store";
import type { StoredLimit } from "../limit-store";

const run = promisify(execFile);
const CHILD = join(__dirname, "helpers", "limit-store-process.ts");

/** Add one to each key's count, for an hour. */
function increment(keys: string[]) {
  return (current: ReadonlyMap<string, StoredLimit>, now: number) => ({
    write: new Map(
      keys.map(key => [
        key,
        {
          value: {
            n:
              ((current.get(key)?.value as { n?: number } | undefined)?.n ??
                0) + 1,
          },
          expiresAt: now + 3_600_000,
        },
      ])
    ),
    result: undefined,
  });
}

/** A count as stored. */
const countOf = (entry: StoredLimit | undefined) =>
  (entry?.value as { n?: number } | undefined)?.n ?? 0;

describe("the database limit store on one SQLite file from two processes", () => {
  let dir: string;
  let file: string;
  let current: TestNextly;
  let store: DatabaseLimitStore;
  const generation = randomUUID().replaceAll("-", "").slice(0, 16);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-limit-processes-"));
    file = join(dir, "site.db");
    const adapter = await createAdapter({
      type: "sqlite",
      url: `file:${file}`,
    });
    current = await createTestNextly({ dialect: "sqlite", adapter });
    store = createDatabaseLimitStore({
      adapter: current.adapter,
      generation,
      sweepIntervalMs: false,
    });
  });

  afterAll(async () => {
    await store.close();
    await current.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The other process: `times` increments of `keys`. */
  const otherProcess = (times: number, keys: string[]) =>
    run(
      process.execPath,
      [
        "--import",
        "tsx",
        CHILD,
        file,
        generation,
        String(times),
        keys.join(","),
      ],
      {
        cwd: join(__dirname, "..", "..", "..", ".."),
        timeout: 120_000,
      }
    );

  it("loses no update of one new key made 50 times over two processes", async () => {
    const key = `shared-${randomUUID()}`;

    const [child] = await Promise.all([
      otherProcess(25, [key]),
      Promise.all(
        Array.from({ length: 25 }, () => store.update([key], increment([key])))
      ),
    ]);

    expect(child.stdout.trim()).toBe("done");
    expect(countOf((await store.read([key])).get(key))).toBe(50);
  }, 150_000);

  it("completes first updates of the same new keys named in opposite orders by two processes", async () => {
    const keys = [`order-${randomUUID()}-a`, `order-${randomUUID()}-b`];

    const [child] = await Promise.all([
      otherProcess(10, [...keys].reverse()),
      Promise.all(
        Array.from({ length: 10 }, () => store.update(keys, increment(keys)))
      ),
    ]);

    expect(child.stdout.trim()).toBe("done");
    const counts = await store.read(keys);
    expect(keys.map(key => countOf(counts.get(key)))).toEqual([20, 20]);
  }, 150_000);
});
