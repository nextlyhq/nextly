/**
 * An install upgrades: the previous migration set, then the current one, and
 * a production boot over the result.
 *
 * A production install gets commerce's tables only from its migration
 * modules, so this drives the commands a deployment runs, against a SQLite
 * file: first `nextly migrate --step 1`, which applies the first module and
 * stops, as an install made before the second module existed; then a cart
 * stored as that install stores one; then the upgrade. A production boot
 * refuses a configured plugin that `nextly plugins install` has not recorded
 * on the database, and a database made before installs were recorded has no
 * record, so the upgrade runs the install, as an upgrade of such a database
 * must: it records commerce and applies the modules still to apply. A
 * production boot then accepts the database, and the cart stored before the
 * upgrade is still served.
 *
 * The same commands make the other side of the schema gate: an install whose
 * newest module is rolled back is behind the schema commerce declares
 * (`schemaVersion`), and a production boot refuses it.
 *
 * SQLite only: the command and the boot must reach the same database, and a
 * file is the one this test can make and remove without a server. Each
 * module's SQL for the other dialects is what core's own generator wrote and
 * the drift test holds to the declaration.
 *
 * @module schema/upgrade.integration.test
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { createTestNextly } from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { describe, expect, it } from "vitest";

import { createCartService } from "../cart/cart-service";
import { cartDeadline } from "../cart/lifetime";
import { hashCartToken, newCartToken } from "../cart/token";
import { money } from "../money/money";
import { commerce } from "../plugin";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

import { migrations } from "./migrations";
import { referenceKey } from "./reference-key";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The plugin's name, as the install command and the install record know it. */
const PLUGIN = "@nextlyhq/plugin-commerce";

/**
 * A scratch project on a SQLite file, with commerce configured, and the
 * `nextly` command run in it. This process reads its database from the
 * environment too, when it opens the file and when it boots: the same file,
 * for this test only, until `close` puts the environment back.
 */
function sqliteProject(): {
  database: string;
  nextly: (...args: string[]) => Promise<{ stdout: string; stderr: string }>;
  close: () => void;
} {
  const scratch = mkdtempSync(join(tmpdir(), "commerce-upgrade-"));
  const database = `file:${join(scratch, "shop.sqlite")}`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: database,
  };
  delete environment["DB_DIALECT"];
  const ownDatabase = {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_DIALECT: process.env.DB_DIALECT,
  };
  process.env.DATABASE_URL = database;
  process.env.DB_DIALECT = "sqlite";
  symlinkSync(join(packageRoot, "node_modules"), join(scratch, "node_modules"));
  writeFileSync(
    join(scratch, "nextly.config.ts"),
    [
      'import { defineConfig } from "nextly/config";',
      `import { commerce } from ${JSON.stringify(join(packageRoot, "src/plugin.ts"))};`,
      'export default defineConfig({ plugins: [commerce({ currency: "USD" })] });',
      "",
    ].join("\n")
  );
  return {
    database,
    nextly: (...args: string[]) =>
      run(join(packageRoot, "node_modules/.bin/nextly"), args, {
        cwd: scratch,
        env: environment,
        timeout: 120_000,
      }),
    close: () => {
      for (const [key, value] of Object.entries(ownDatabase)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

/** Runs `work` with the environment a production boot requires. */
async function asProduction<T>(work: () => Promise<T>): Promise<T> {
  // A throwaway secret for these boots alone, never a real one.
  const production: Record<string, string> = {
    NODE_ENV: "production",
    NEXTLY_SECRET: "test-only-secret-for-the-upgrade-boot-0123456789",
    NEXT_PUBLIC_APP_URL: "http://localhost",
  };
  const previous = Object.fromEntries(
    Object.keys(production).map(key => [key, process.env[key]])
  );
  Object.assign(process.env, production);
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("commerce's migrations on an existing install", () => {
  it("apply the previous set, then the current one, and a production boot serves the cart stored before", async () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const project = sqliteProject();
    const { database, nextly } = project;

    let booted: Awaited<ReturnType<typeof createTestNextly>> | undefined;
    try {
      // The install as it was: commerce's first module applied, and only it.
      const first = await nextly("migrate", "--step", "1");
      expect(first.stdout).toContain("Plugin migrations: 1 applied");

      // A cart that install stored, its token known to the test.
      const token = newCartToken();
      const stored = new Date();
      const adapter = await createAdapter({ type: "sqlite", url: database });
      await adapter.executeQuery(
        "INSERT INTO commerce__carts (id, token_hash, currency, version, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          "01a1394a-0000-7000-8000-000000000001",
          hashCartToken(token),
          "USD",
          0,
          Math.floor(cartDeadline(stored, 30).getTime() / 1000),
          Math.floor(stored.getTime() / 1000),
          Math.floor(stored.getTime() / 1000),
        ]
      );
      await adapter.executeQuery(
        "INSERT INTO commerce__cart_lines (id, cart_id, reference, reference_key, quantity, seen_unit_price_amount, seen_unit_price_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          "01a1394a-0000-7000-8000-000000000002",
          "01a1394a-0000-7000-8000-000000000001",
          "bolt",
          referenceKey("bolt"),
          3,
          25,
          "USD",
          Math.floor(stored.getTime() / 1000),
          Math.floor(stored.getTime() / 1000),
        ]
      );

      // The upgrade. The database has no install record, so it is installed,
      // as an upgrade of such a database must be: the install records commerce
      // and applies every module still to apply.
      await nextly("plugins", "install", PLUGIN);

      const source = createInMemoryCatalogueSource({
        currency: "USD",
        items: [
          {
            reference: "bolt",
            name: "Bolt",
            price: { kind: "listed", unitPrice: money(25, "USD") },
            stock: { kind: "untracked" },
          },
        ],
      }).source;
      const plugin = commerce({ currency: "USD", catalogue: source });
      const init = plugin.init;
      let captured: PluginContext | undefined;
      // A production boot refuses a database behind the plugin's schema, so
      // booting at all shows the upgrade reached it.
      booted = await asProduction(() =>
        createTestNextly({
          adapter,
          plugins: [
            {
              ...plugin,
              init: async ctx => {
                captured = ctx;
                await init?.(ctx);
              },
            },
          ],
        })
      );
      if (!captured) throw new Error("commerce's init did not run");

      const cart = createCartService({
        db: captured.db,
        source,
        currency: "USD",
        lifetimeDays: 30,
      });
      const read = await cart.get({ token });
      expect(read.cart.lines.map(l => [l.reference, l.quantity])).toEqual([
        ["bolt", 3],
      ]);
    } finally {
      await booted?.destroy();
      project.close();
    }
  }, 240_000);

  it("refuses a production boot over an install whose newest module was rolled back", async () => {
    const project = sqliteProject();
    try {
      // A deployment's order: the migrations, then the install.
      await project.nextly("migrate");
      await project.nextly("plugins", "install", PLUGIN);
      // The newest module undone: commerce is installed, and its schema is
      // behind the one it declares.
      const down = await project.nextly(
        "migrate:down",
        "--plugin",
        PLUGIN,
        "--allow-data-loss"
      );
      const newest = migrations[migrations.length - 1];
      if (!newest) throw new Error("commerce ships no migrations");
      expect(down.stdout).toContain(newest.name);

      const adapter = await createAdapter({
        type: "sqlite",
        url: project.database,
      });
      const failure = await asProduction(() =>
        createTestNextly({
          adapter,
          plugins: [commerce({ currency: "USD" })],
        })
      ).then(
        async booted => {
          await booted.destroy();
          return undefined;
        },
        (error: unknown) => error
      );

      expect(NextlyError.is(failure) ? failure.code : String(failure)).toBe(
        "PLUGIN_SCHEMA_BEHIND"
      );
    } finally {
      project.close();
    }
  }, 240_000);
});
