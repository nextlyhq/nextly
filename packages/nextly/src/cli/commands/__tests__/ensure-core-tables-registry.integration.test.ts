/**
 * `ensureCoreTables` must leave a database able to register components.
 *
 * Two shapes, and the interesting one is the partially bootstrapped database:
 * `users` present so the existing-database branch is taken, and no field-group
 * registry at all — after a dropped table, or a bootstrap that did not finish.
 * `db:sync` is the documented recovery for exactly that.
 *
 * The raw replay deliberately never emits the registry's `CREATE TABLE`: it is
 * a fixed string, and a migration renaming the table beside it would restore
 * the empty legacy one. Creation is delegated to `SystemTableService`, which
 * resolves the spelling first. That delegation is the thing under test — a
 * check on the statement list cannot see it, and stays green if the call is
 * removed.
 *
 * @module cli/commands/__tests__/ensure-core-tables-registry.integration.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { SchemaRegistry } from "../../../database/schema-registry";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { createLogger } from "../../utils/logger";
import { ensureCoreTables } from "../dev-server";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { CommandContext } from "../../program";
import type { ResolvedDevOptions } from "../db-sync";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-core-tables-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function adapterFor() {
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  drizzleAdapter.setTableResolver(registry);
  return { adapter, drizzleAdapter };
}

async function runEnsureCoreTables(adapter: unknown, autoSync = true) {
  const logger = createLogger({ quiet: true });
  const options = { cwd: dir, autoSync } as ResolvedDevOptions;
  const context = { logger, options: {}, cwd: dir } as CommandContext;
  await ensureCoreTables(adapter as CLIDatabaseAdapter, options, context);
}

describe("ensureCoreTables and the field-group registry", () => {
  it("creates the registry on a database that has none", async () => {
    const { adapter, drizzleAdapter } = await adapterFor();

    // The premise: nothing exists yet, so the assertion below cannot pass by
    // finding a table that was already there.
    expect(await drizzleAdapter.tableExists(STORAGE_FORMAT.registryTable)).toBe(
      false
    );

    await runEnsureCoreTables(adapter);

    expect(await drizzleAdapter.tableExists(STORAGE_FORMAT.registryTable)).toBe(
      true
    );
  });

  /**
   * `--no-auto-sync` promises to leave schema changes to migrations, and the
   * reconcile is schema change — it replays every core CREATE and repairs
   * system tables. So a database run that way is left exactly as it was, even
   * though the credential may well have the privileges to fix it.
   */
  it("leaves an existing database alone when auto-sync is disabled", async () => {
    const { adapter, drizzleAdapter } = await adapterFor();
    await runEnsureCoreTables(adapter);
    await drizzleAdapter.executeQuery(
      `DROP TABLE "${STORAGE_FORMAT.registryTable}"`
    );

    await runEnsureCoreTables(adapter, false);

    expect(
      await drizzleAdapter.tableExists(STORAGE_FORMAT.registryTable),
      "--no-auto-sync must not repair the schema; the option exists to leave " +
        "that to migrations"
    ).toBe(false);
  });

  /**
   * The repaired path. `users` is present so the existing-database branch runs,
   * and the registry has been dropped — which is the shape `db:sync` exists to
   * repair. The replay does not create it; the service call after the replay
   * must.
   */
  it("repairs a dropped registry on a database that already has users", async () => {
    const { adapter, drizzleAdapter } = await adapterFor();
    await runEnsureCoreTables(adapter);

    await drizzleAdapter.executeQuery(
      `DROP TABLE "${STORAGE_FORMAT.registryTable}"`
    );
    expect(await drizzleAdapter.tableExists("users")).toBe(true);
    expect(await drizzleAdapter.tableExists(STORAGE_FORMAT.registryTable)).toBe(
      false
    );

    await runEnsureCoreTables(adapter);

    expect(
      await drizzleAdapter.tableExists(STORAGE_FORMAT.registryTable),
      "the existing-database branch must repair a dropped registry; the raw " +
        "replay never emits its CREATE TABLE, so this can only come from the " +
        "system-table service running after it"
    ).toBe(true);
  });
});
