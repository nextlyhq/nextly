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
  describeClaims,
  integrationWorkers,
  releaseWorker,
  workerDatabaseName,
  workerDatabaseUrl,
  workerPoolId,
  pointAtWorkerDatabases,
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
    for (const name of ["TEST_SQLITE_URL", "TEST_DATABASE_URL"]) {
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

  it("allows more than one worker on PostgreSQL and MySQL, where each gets a database of its own", () => {
    expect(
      integrationWorkers({
        NEXTLY_INTEGRATION_WORKERS: "2",
        TEST_POSTGRES_URL: "postgres://u:p@localhost:5432/nextly_test",
        TEST_MYSQL_URL: "mysql://u:p@localhost:3306/nextly_test",
      })
    ).toBe(2);
    // Still refused beside a URL every worker would share.
    expect(() =>
      integrationWorkers({
        NEXTLY_INTEGRATION_WORKERS: "2",
        TEST_MYSQL_URL: "mysql://u:p@localhost:3306/nextly_test",
        TEST_SQLITE_URL: "file:./one.db",
      })
    ).toThrow("TEST_SQLITE_URL");
  });
});

describe("pointing a test file at its worker's databases", () => {
  const run = {
    NEXTLY_INTEGRATION_WORKERS: "2",
    NEXTLY_INTEGRATION_POSTGRES_URL:
      "postgres://u:p@localhost:5432/nextly_test",
    NEXTLY_INTEGRATION_MYSQL_URL: "mysql://u:p@localhost:3306/nextly_test",
  };

  it("moves each server's URL to the worker's database on it", () => {
    const env: Record<string, string | undefined> = {
      ...run,
      VITEST_POOL_ID: "2",
    };
    pointAtWorkerDatabases(env);
    expect(env.TEST_POSTGRES_URL).toBe(
      "postgres://u:p@localhost:5432/nextly_test_pool2"
    );
    expect(env.TEST_MYSQL_URL).toBe(
      "mysql://u:p@localhost:3306/nextly_test_pool2"
    );
  });

  it("derives from the run's URL, so a second file in the process lands on the same database", () => {
    const env: Record<string, string | undefined> = {
      ...run,
      VITEST_POOL_ID: "1",
    };
    pointAtWorkerDatabases(env);
    pointAtWorkerDatabases(env);
    expect(env.TEST_MYSQL_URL).toBe(
      "mysql://u:p@localhost:3306/nextly_test_pool1"
    );
  });

  it("leaves a run whose setup made no databases as it is", () => {
    const env: Record<string, string | undefined> = {
      TEST_MYSQL_URL: "mysql://u:p@localhost:3306/nextly_test",
      VITEST_POOL_ID: "3",
    };
    pointAtWorkerDatabases(env);
    expect(env.TEST_MYSQL_URL).toBe("mysql://u:p@localhost:3306/nextly_test");
  });

  it("refuses a worker the setup made no database for", () => {
    expect(() =>
      pointAtWorkerDatabases({ ...run, VITEST_POOL_ID: "3" })
    ).toThrow("has no database of its own");
  });
});

describe("a worker's server database", () => {
  it("is the run's database suffixed with the pool id, on the same server", () => {
    expect(workerDatabaseName("nextly_test_w7", 2)).toBe(
      "nextly_test_w7_pool2"
    );
    expect(
      workerDatabaseUrl(
        "postgres://u:p@localhost:5435/nextly_test_w7?sslmode=disable",
        2
      )
    ).toBe(
      "postgres://u:p@localhost:5435/nextly_test_w7_pool2?sslmode=disable"
    );
  });

  it("gives two workers two databases", () => {
    const url = "postgres://u:p@localhost:5432/nextly_test";
    expect(workerDatabaseUrl(url, 1)).not.toBe(workerDatabaseUrl(url, 2));
  });

  it("exists only for the pool ids the run made one for", () => {
    expect(workerPoolId("2", 2)).toBe(2);
    for (const id of ["3", "0", "x", undefined]) {
      expect(() => workerPoolId(id, 2), String(id)).toThrow(
        "has no database of its own"
      );
    }
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

describe("describeClaims", () => {
  it("reports how many workers the files ran on, from what they claimed", () => {
    const log = "1 100\n2 200\n1 101\n1 101\n";
    expect(describeClaims(log, 2)).toBe(
      "[integration workers] NEXTLY_INTEGRATION_WORKERS=2; files ran on 2 worker(s), each on its own database: pool 1: 3 file(s) in 2 process(es); pool 2: 1 file(s) in 1 process(es)"
    );
    expect(describeClaims("", 1)).toMatch(
      /files ran on 0 worker\(s\).*no file claimed a worker/
    );
  });
});
