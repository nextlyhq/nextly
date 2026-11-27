/**
 * A run decides once whether its database is on this machine, and every
 * reader of that answer gets the same one: the line the run prints and each
 * rule that depends on where the database is.
 *
 * What would separate one decision from a reading per caller: the
 * environment changing under the run between two reads. A second reading
 * would follow the change, so the line and a later rule could disagree
 * about one run; the run's answer does not. A new run decides again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadCliEnvironment, modeLine, runDatabasePlace } from "../environment";

const LOCAL = "postgresql://app:pw@127.0.0.1:5432/shop";
const REMOTE = "postgresql://app:pw@db.example.com:5432/shop";

let folder: string;
beforeEach(() => {
  // A project with no environment files: the URL is the process's own.
  folder = mkdtempSync(join(tmpdir(), "nextly-place-run-"));
  vi.stubEnv("DB_DIALECT", undefined);
  vi.stubEnv("NODE_ENV", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

describe("where a run's database is", () => {
  it("is decided once a run, so every caller reads the same answer", () => {
    vi.stubEnv("DATABASE_URL", LOCAL);
    loadCliEnvironment(undefined, folder);
    const first = runDatabasePlace();
    expect(first).toBe("local");
    expect(modeLine()).toMatch(/^● local · 127\.0\.0\.1:5432\/shop · /);

    // The URL changes under the run; its answer does not.
    vi.stubEnv("DATABASE_URL", REMOTE);
    expect(runDatabasePlace()).toBe(first);
    expect(modeLine()).toMatch(/^● local · 127\.0\.0\.1:5432\/shop · /);
  });

  it("is decided again by the next run", () => {
    vi.stubEnv("DATABASE_URL", LOCAL);
    loadCliEnvironment(undefined, folder);
    expect(runDatabasePlace()).toBe("local");

    vi.stubEnv("DATABASE_URL", REMOTE);
    loadCliEnvironment(undefined, folder);
    expect(runDatabasePlace()).toBe("live");
    expect(modeLine()).toMatch(
      /^● LIVE database db\.example\.com:5432\/shop · /
    );
  });

  it.each(["development", "production", "test"])(
    "is never chosen by the mode: --mode %s with a remote URL is live",
    mode => {
      vi.stubEnv("DATABASE_URL", REMOTE);
      loadCliEnvironment(mode, folder);
      expect(runDatabasePlace()).toBe("live");
      expect(modeLine()).toBe(
        `● LIVE database db.example.com:5432/shop · PostgreSQL (${mode}; DATABASE_URL from the process environment)`
      );
    }
  );
});
