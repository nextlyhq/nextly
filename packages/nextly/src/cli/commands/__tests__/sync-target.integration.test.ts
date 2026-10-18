// The sync-target helper gives each server-dialect test a database of its own.
// A test that fails while that database is being prepared has no handle to
// close it with, so the helper must drop it itself, or every failed run leaves
// one behind on the shared test server.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { openSyncTarget } from "./helpers/sync-target";

// The helper sets DATABASE_URL to the database it made just before preparing
// it, so the failure can say which database that was.
vi.mock("../dev-server", () => ({
  ensureCoreTables: () =>
    Promise.reject(new Error(`prepare failed: ${process.env.DATABASE_URL}`)),
}));

const serverDialects = getConfiguredTestDialects().filter(
  (dialect): dialect is "postgresql" | "mysql" => dialect !== "sqlite"
);

async function databaseExists(
  dialect: "postgresql" | "mysql",
  name: string
): Promise<boolean> {
  const base =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  const admin = await createAdapter({ type: dialect, url: base } as Parameters<
    typeof createAdapter
  >[0]);
  try {
    const rows = await admin.executeQuery<Record<string, unknown>>(
      dialect === "postgresql"
        ? `SELECT datname FROM pg_database WHERE datname = '${name}'`
        : `SHOW DATABASES LIKE '${name}'`
    );
    return rows.length > 0;
  } finally {
    await admin.disconnect();
  }
}

let dir: string;
let savedUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-sync-target-"));
  savedUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(serverDialects.length === 0).each(serverDialects)(
  "openSyncTarget on %s",
  dialect => {
    it("drops the database it made when preparing it fails", async () => {
      const failure = await openSyncTarget(dir, dialect).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(failure).toBeInstanceOf(Error);
      const url = /prepare failed: (\S+)/.exec(String(failure))?.[1];
      expect(url).toBeDefined();
      const name = new URL(url ?? "").pathname.slice(1);
      // The name is the helper's own, not the slot's database.
      expect(name).toMatch(/^nextly_sync_[a-z0-9]{10}$/);
      expect(await databaseExists(dialect, name)).toBe(false);
    });
  }
);
