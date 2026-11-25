/**
 * What `nextly migrate`'s up-front count leaves out ahead of the run (`migrationsAhead`'s
 * `dropped`): every table the run's migrations leave dropped, read in the order the run applies
 * them. A plugin's modules run before the app's files, so a table a pending module drops is among
 * them, as one an app file drops is, and the count does not refuse the run over rows the module
 * deletes. Driven against a real SQLite file, whose migration ledger the plan reads.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PluginMigration } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { createLogger } from "../../utils/logger";
import { migrationsAhead } from "../migrate";

import {
  openSqliteSyncTarget,
  type SqliteSyncTarget,
} from "./helpers/sqlite-sync-target";

let dir: string;
let target: SqliteSyncTarget | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-migrations-ahead-"));
});

afterEach(async () => {
  await target?.adapter.disconnect();
  target = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** A plugin module whose SQLite UP is `up`; the other dialects hold none. */
function moduleDropping(up: string[]): PluginMigration {
  const none = { up: [], down: [] };
  return {
    name: "20260101_000000_remove_things",
    schemaVersion: 2,
    checksum: "0".repeat(64),
    dialects: { sqlite: { up, down: [] }, postgresql: none, mysql: none },
  } as unknown as PluginMigration;
}

describe("the tables a run's migrations leave dropped (integration)", () => {
  // Broken (only the app's files read), the module's table is not among them, and its rows still
  // refuse a run that deletes them.
  it("names a table a pending plugin module drops, with no app file waiting", async () => {
    target = await openSqliteSyncTarget(dir);
    const migrationsDir = join(dir, "migrations");
    mkdirSync(migrationsDir);
    const ahead = await migrationsAhead({
      adapter: target.cli,
      db: target.adapter.getDrizzle(),
      dialect: "sqlite",
      migrationsDir,
      logger: createLogger({ quiet: true }),
      pluginMigrationSets: [
        {
          pluginName: "things",
          pluginVersion: "1.0.0",
          migrations: [moduleDropping(['DROP TABLE "dc_things"'])],
        },
      ],
      step: undefined,
    });

    expect([...ahead.dropped]).toEqual(["dc_things"]);
    expect(ahead.leavesPending).toBe(false);
  });
});
