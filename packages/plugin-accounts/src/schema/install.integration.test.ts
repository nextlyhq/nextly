/**
 * A production boot over an installed accounts database whose schema is
 * behind the one the plugin declares.
 *
 * A production install gets accounts' tables only from its migration modules,
 * applied by the commands a deployment runs: `nextly migrate`, then
 * `nextly plugins install`, which records the install. Rolling the newest
 * module back leaves accounts installed with a schema behind its declared
 * `schemaVersion`, and a production boot refuses that database before the
 * first request meets a table it lacks.
 *
 * Made with the real commands rather than by writing ledger rows, so the
 * install record and the applied modules are the ones a deployment has.
 * SQLite only: the command and the boot must reach the same database, and a
 * file is the one this test can make and remove without a server. A database
 * accounts was never installed on is refused on every dialect, in
 * `tables.integration.test.ts`.
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

import { PLUGIN_NAME } from "../admin-contract";
import { accounts } from "../plugin";
import { TEST_ORIGIN } from "../test-support/boot";

import { migrations } from "./migrations";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("accounts at a production boot, once installed", () => {
  it("refuses an install whose newest module was rolled back", async () => {
    const newest = migrations[migrations.length - 1];
    if (!newest) throw new Error("accounts ships no migrations");

    const scratch = mkdtempSync(join(tmpdir(), "accounts-install-"));
    const database = `file:${join(scratch, "accounts.sqlite")}`;
    const commandEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: database,
    };
    delete commandEnvironment["DB_DIALECT"];
    const nextly = (...args: string[]) =>
      run(join(packageRoot, "node_modules/.bin/nextly"), args, {
        cwd: scratch,
        env: commandEnvironment,
        timeout: 120_000,
      });

    // This process boots over the same file, reading it from the environment
    // as the command does, and a production boot needs a secret and an origin.
    // A throwaway secret for this boot alone, never a real one.
    const boot: Record<string, string> = {
      DATABASE_URL: database,
      DB_DIALECT: "sqlite",
      NODE_ENV: "production",
      NEXTLY_SECRET: "test-only-secret-for-the-install-boot-0123456789",
      NEXT_PUBLIC_APP_URL: "http://localhost",
    };
    const previous = Object.fromEntries(
      Object.keys(boot).map(key => [key, process.env[key]])
    );

    let failure: unknown;
    try {
      symlinkSync(
        join(packageRoot, "node_modules"),
        join(scratch, "node_modules")
      );
      writeFileSync(
        join(scratch, "nextly.config.ts"),
        [
          'import { defineConfig } from "nextly/config";',
          `import { accounts } from ${JSON.stringify(join(packageRoot, "src/plugin.ts"))};`,
          `export default defineConfig({ plugins: [accounts({ origin: ${JSON.stringify(TEST_ORIGIN)} })] });`,
          "",
        ].join("\n")
      );

      // A deployment's order: the migrations, then the install.
      await nextly("migrate");
      const installed = await nextly("plugins", "install", PLUGIN_NAME);
      expect(installed.stdout).toContain(`${PLUGIN_NAME} installed`);
      // The newest module undone: accounts is installed, and its schema is
      // behind the one it declares.
      const down = await nextly(
        "migrate:down",
        "--plugin",
        PLUGIN_NAME,
        "--allow-data-loss"
      );
      expect(down.stdout).toContain(newest.name);

      Object.assign(process.env, boot);
      const adapter = await createAdapter({ type: "sqlite", url: database });
      try {
        const booted = await createTestNextly({
          adapter,
          plugins: [accounts({ origin: TEST_ORIGIN })],
        });
        await booted.destroy();
      } catch (error) {
        failure = error;
        // A refused boot may already have closed it; the refusal is the
        // result here, not a second error about the connection.
        await adapter.disconnect().catch(() => {});
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    }

    expect(NextlyError.is(failure) ? failure.code : String(failure)).toBe(
      "PLUGIN_SCHEMA_BEHIND"
    );
  }, 240_000);
});
