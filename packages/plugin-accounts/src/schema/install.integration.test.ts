/**
 * The schema-version gate on an installed database, made with the commands a
 * deployment runs.
 *
 * A production boot refuses a configured plugin that `nextly plugins install`
 * has not recorded on the database, and only past that does it compare the
 * installed schema with the one the plugin declares (`schemaVersion`). So the
 * gate is reached only by a database that is installed: this installs the
 * accounts plugin on a SQLite file with the real commands, and boots over it
 * in production. With every module applied the boot passes both gates and
 * reaches the plugin's own start; with the newest module rolled back the
 * database is behind the schema the plugin declares, and the gate refuses it.
 *
 * The plugin's start refuses a production boot whose rate limits are not shared
 * across instances (core's `rateLimit` config, which this harness does not set),
 * so a current install's boot ends there, past both gates, and that refusal is
 * what shows the gates let it through.
 *
 * SQLite only: the command and the boot must reach the same database, and a
 * file is the one this test can make and remove without a server. Each
 * module's SQL for the other dialects is what core's own generator wrote and
 * the drift test holds to the declaration.
 *
 * @module schema/install.integration.test
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { NextlyError } from "@nextlyhq/plugin-sdk";
import { createTestNextly } from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { describe, expect, it } from "vitest";

import { accounts } from "../plugin";
import { TEST_ORIGIN } from "../test-support/boot";

import { migrations } from "./migrations";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The plugin's name, as the install command and the install record know it. */
const PLUGIN = "@nextlyhq/plugin-accounts";

/**
 * A scratch project on a SQLite file, with the accounts plugin configured, and
 * the `nextly` command run in it. This process reads its database from the
 * environment too, when it boots: the same file, for this test only, until
 * `close` puts the environment back.
 */
function sqliteProject(): {
  database: string;
  nextly: (...args: string[]) => Promise<{ stdout: string; stderr: string }>;
  close: () => void;
} {
  const scratch = mkdtempSync(join(tmpdir(), "accounts-install-"));
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
      `import { accounts } from ${JSON.stringify(join(packageRoot, "src/plugin.ts"))};`,
      `export default defineConfig({ plugins: [accounts({ origin: ${JSON.stringify(TEST_ORIGIN)} })] });`,
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

/**
 * A production boot over `database` with the accounts plugin: the error it
 * stops with, or `undefined` when it boots.
 */
async function productionBoot(database: string): Promise<unknown> {
  // A throwaway secret for these boots alone, never a real one.
  const production: Record<string, string> = {
    NODE_ENV: "production",
    NEXTLY_SECRET: "test-only-secret-for-the-install-boot-0123456789",
    NEXT_PUBLIC_APP_URL: "http://localhost",
  };
  const previous = Object.fromEntries(
    Object.keys(production).map(key => [key, process.env[key]])
  );
  Object.assign(process.env, production);
  try {
    const adapter = await createAdapter({ type: "sqlite", url: database });
    const booted = await createTestNextly({
      adapter,
      plugins: [accounts({ origin: TEST_ORIGIN })],
    });
    await booted.destroy();
    return undefined;
  } catch (error) {
    return error;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The code a refusal carries, so a failed expectation names it. */
function codeOf(failure: unknown): string | undefined {
  if (failure === undefined) return undefined;
  return NextlyError.is(failure) ? failure.code : String(failure);
}

describe("the accounts plugin's schema gate on an installed database", () => {
  it("lets a production boot over an install with every module applied past both gates", async () => {
    const project = sqliteProject();
    try {
      // A deployment's order: the migrations, then the install.
      await project.nextly("migrate");
      await project.nextly("plugins", "install", PLUGIN);

      // Refused by the plugin's own start, which runs only once the install
      // and schema gates have accepted the database.
      expect(codeOf(await productionBoot(project.database))).toMatch(
        /The accounts plugin needs limit counts every instance shares/
      );
    } finally {
      project.close();
    }
  }, 240_000);

  it("refuses a production boot over an install whose newest module was rolled back", async () => {
    const project = sqliteProject();
    try {
      await project.nextly("migrate");
      await project.nextly("plugins", "install", PLUGIN);
      // The newest module undone: the plugin is installed, and its schema is
      // behind the one it declares.
      const down = await project.nextly(
        "migrate:down",
        "--plugin",
        PLUGIN,
        "--allow-data-loss"
      );
      const newest = migrations[migrations.length - 1];
      if (!newest) throw new Error("the accounts plugin ships no migrations");
      expect(down.stdout).toContain(newest.name);

      expect(codeOf(await productionBoot(project.database))).toBe(
        "PLUGIN_SCHEMA_BEHIND"
      );
    } finally {
      project.close();
    }
  }, 240_000);
});
