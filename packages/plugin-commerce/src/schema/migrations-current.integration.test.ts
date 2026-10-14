/**
 * The migration modules commerce ships carry exactly the schema it declares,
 * as core's own generator judges it.
 *
 * A production install gets commerce's tables only from these modules, never
 * from the development push, so a column, type, default, index, foreign key
 * or check declared without a regenerated module would exist in every
 * development database and in no production one. The generator is the one
 * thing that knows how a declaration compiles on each dialect, so it is asked
 * rather than imitated: given the shipped modules and the declaration, it
 * must find nothing left to generate.
 *
 * It runs on a copy of the schema in a scratch directory, linked to the
 * package's own dependencies, so a drift it finds writes its module there and
 * never into the source tree.
 *
 * @module schema/migrations-current.integration.test
 */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("commerce's migration modules against its declaration", () => {
  it("leave the generator nothing to generate", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "commerce-migration-drift-"));
    try {
      cpSync(join(packageRoot, "src/schema"), join(scratch, "src/schema"), {
        recursive: true,
        filter: source => !source.includes("node_modules"),
      });
      cpSync(join(packageRoot, "package.json"), join(scratch, "package.json"));
      symlinkSync(
        join(packageRoot, "node_modules"),
        join(scratch, "node_modules")
      );
      const shipped = readdirSync(join(scratch, "src/schema/migrations"));

      // The generator exits 2 when it finds nothing to generate, 0 when it
      // wrote a module (the drift this test exists to catch), and anything
      // else when it failed; only 2 passes.
      const outcome = await run(
        join(packageRoot, "node_modules/.bin/nextly"),
        [
          "migrate:create",
          "--plugin",
          "./src/schema/definition.ts",
          "--name",
          "drift_check",
          "--non-interactive",
        ],
        { cwd: scratch, timeout: 60_000 }
      ).then(
        ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          code: error.code ?? -1,
          stdout: error.stdout ?? "",
          stderr: error.stderr ?? "",
        })
      );

      expect(outcome, `${outcome.stdout}\n${outcome.stderr}`).toMatchObject({
        code: 2,
      });
      expect(outcome.stdout).toContain("No schema changes detected");
      expect(
        readdirSync(join(scratch, "src/schema/migrations")).filter(
          name => name !== "node_modules"
        )
      ).toEqual(shipped.filter(name => name !== "node_modules"));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});
