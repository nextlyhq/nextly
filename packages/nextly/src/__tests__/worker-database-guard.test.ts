/**
 * The integration suite's worker count, and the guard that no two workers
 * share a database (`./worker-database-guard`).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimWorker,
  integrationWorkers,
  releaseWorker,
} from "./worker-database-guard";

describe("integrationWorkers", () => {
  it("runs one worker unless asked for more", () => {
    expect(integrationWorkers({})).toBe(1);
    expect(integrationWorkers({ NEXTLY_INTEGRATION_WORKERS: "" })).toBe(1);
    expect(integrationWorkers({ NEXTLY_INTEGRATION_WORKERS: "2" })).toBe(2);
  });

  it("refuses a count that is not a whole number of at least one", () => {
    for (const asked of ["0", "-1", "1.5", "two"]) {
      expect(
        () => integrationWorkers({ NEXTLY_INTEGRATION_WORKERS: asked }),
        asked
      ).toThrow(/whole number/);
    }
  });

  it("refuses more than one worker on a database a URL names, which every worker would share", () => {
    for (const name of [
      "TEST_POSTGRES_URL",
      "TEST_MYSQL_URL",
      "TEST_SQLITE_URL",
    ]) {
      expect(
        () =>
          integrationWorkers({ NEXTLY_INTEGRATION_WORKERS: "2", [name]: "x" }),
        name
      ).toThrow(name);
    }
    // One worker on such a database is today's run, and stays allowed.
    expect(
      integrationWorkers({
        NEXTLY_INTEGRATION_WORKERS: "1",
        TEST_POSTGRES_URL: "x",
      })
    ).toBe(1);
  });
});

describe("claimWorker", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worker-guard-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lets each pool id be held by one process, and the same process claim it again", () => {
    claimWorker(dir, "1", 100, () => true);
    claimWorker(dir, "2", 200, () => true);
    claimWorker(dir, "1", 100, () => true);
    expect(readFileSync(join(dir, "pool-1"), "utf8")).toBe("100");
    expect(readFileSync(join(dir, "pool-2"), "utf8")).toBe("200");
  });

  it("fails when a second live process claims a pool id, naming both", () => {
    claimWorker(dir, "1", 100, () => true);
    expect(() => claimWorker(dir, "1", 200, () => true)).toThrow(
      /workers 100 and 200 both have VITEST_POOL_ID 1/
    );
  });

  it("lets a replacement take over the id of a worker that has ended", () => {
    claimWorker(dir, "1", 100, () => true);
    claimWorker(dir, "1", 200, pid => pid !== 100);
    expect(readFileSync(join(dir, "pool-1"), "utf8")).toBe("200");
  });

  it("gives a claim back only for its holder, and finds an already-removed one harmless", () => {
    claimWorker(dir, "1", 100, () => true);
    releaseWorker(dir, "1", 200);
    expect(readFileSync(join(dir, "pool-1"), "utf8")).toBe("100");
    releaseWorker(dir, "1", 100);
    expect(existsSync(join(dir, "pool-1"))).toBe(false);
    releaseWorker(dir, "1", 100);
    // The id is free for the next process in the slot.
    claimWorker(dir, "1", 300, () => true);
    expect(readFileSync(join(dir, "pool-1"), "utf8")).toBe("300");
  });
});
