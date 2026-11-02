/**
 * The mode a run chooses is the mode its configuration is evaluated in, on
 * every configured dialect.
 *
 * The project's `nextly.config.ts` declares one collection always and another
 * only when `NODE_ENV` is `production`, as a configuration that branches on
 * the environment does. With `NODE_ENV` unset, `nextly migrate:create` and
 * `nextly migrate` run with `--mode production`; the production-only
 * collection's table exists afterwards, and the same commands in development
 * mode leave it out. The collection declared always is the control: its table
 * shows the commands ran at all.
 *
 * And `migrate:status --json` keeps its standard output one JSON document,
 * the mode line going to standard error.
 *
 * Each command is the CLI's own entry point run in a process of its own, as a
 * shell runs it: the mode has to be chosen before the configuration is
 * evaluated, and the configuration is bundled and imported as only a real
 * process can.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";

/** Collection slugs of this file's own, so its tables are its own. */
const ALWAYS = "mdc_always";
const PRODUCTION_ONLY = "mdc_production_only";

const CONFIG = `
const title = { name: "title", type: "text" };
export default {
  collections: [
    { slug: "${ALWAYS}", fields: [title] },
    ...(process.env.NODE_ENV === "production"
      ? [{ slug: "${PRODUCTION_ONLY}", fields: [title] }]
      : []),
  ],
  db: { migrationsDir: "./migrations" },
};
`;

describe.each(getConfiguredTestDialects())(
  "a configuration that branches on NODE_ENV (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let instance: TestNextly | undefined;
    let databaseUrl: string | undefined;
    let databaseDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-mode-config-"));
      writeFileSync(join(project, "nextly.config.ts"), CONFIG);
      databaseUrl = process.env.DATABASE_URL;
      databaseDialect = process.env.DB_DIALECT;
      if (dialect === "sqlite") {
        // A file the commands' own connections open, which in-memory is not.
        const url = `file:${join(project, "test.db")}`;
        process.env.DB_DIALECT = "sqlite";
        process.env.DATABASE_URL = url;
        _resetEnvCache();
        instance = await createTestNextly({
          adapter: await createAdapter({ type: "sqlite", url } as Parameters<
            typeof createAdapter
          >[0]),
        });
      } else {
        // Points DATABASE_URL at a database of its own for this test.
        instance = await createTestNextly({ dialect });
      }
    });

    afterEach(async () => {
      await instance?.destroy();
      instance = undefined;
      if (databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = databaseUrl;
      if (databaseDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = databaseDialect;
      _resetEnvCache();
      rmSync(project, { recursive: true, force: true });
    });

    /**
     * `nextly <args>` in the project, with `NODE_ENV` unset and the database
     * this test booted. A production run's environment check needs a secret
     * and the app's URL, as a production build has them.
     */
    const nextly = (args: string[]) =>
      runNextly(args, project, {
        NODE_ENV: undefined,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });

    /** `nextly migrate:create` and `nextly migrate`, with `flags`. */
    async function createAndMigrate(flags: string[]): Promise<void> {
      for (const command of [["migrate:create", "init"], ["migrate"]]) {
        const run = await nextly([...command, "--quiet", ...flags]);
        expect(run.status, run.stderr).toBe(0);
      }
    }

    const exists = (slug: string) =>
      instance!.adapter.tableExists(`dc_${slug}`);

    it(
      "--mode production migrates the collection a production-only configuration declares",
      async () => {
        await createAndMigrate(["--mode", "production"]);
        expect(await exists(ALWAYS)).toBe(true);
        expect(await exists(PRODUCTION_ONLY)).toBe(true);
      },
      2 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "development mode does not",
      async () => {
        await createAndMigrate([]);
        expect(await exists(ALWAYS)).toBe(true);
        expect(await exists(PRODUCTION_ONLY)).toBe(false);
      },
      2 * NEXTLY_RUN_TIMEOUT
    );

    it(
      "keeps migrate:status --json one JSON document, with the mode line on stderr",
      async () => {
        const run = await nextly([
          "migrate:status",
          "--json",
          "--mode",
          "production",
        ]);
        expect(run.status, run.stderr).toBe(0);
        expect(() => JSON.parse(run.stdout)).not.toThrow();
        expect(run.stdout).not.toContain("Mode:");
        expect(run.stderr).toContain(
          "Mode: production (DATABASE_URL from the process environment)\n"
        );
      },
      NEXTLY_RUN_TIMEOUT
    );
  }
);
