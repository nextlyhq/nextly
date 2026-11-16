/**
 * `nextly migrate:resolve --dry-run` runs the same checks as a real resolve and
 * names the ledger rows it would write, writing none, on every dialect. The
 * same resolve run for real then writes them, which shows the fixture reaches
 * the writes the dry run skips. Run as a shell runs it.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/** This file's own collection, so its tables are its own. */
const COLLECTION = "mrd_posts";
const LEDGER = "nextly_schema_events";

const CONFIG = `
export default {
  collections: [{ slug: "${COLLECTION}", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

describe.each(getConfiguredTestDialects())(
  "migrate:resolve --dry-run (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let instance: TestNextly | undefined;
    let databaseUrl: string | undefined;
    let databaseDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-resolve-dry-"));
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

    const nextly = (args: string[]) =>
      runNextly(args, project, {
        NODE_ENV: undefined,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });

    /** Every row of the migration ledger. */
    const ledger = async () =>
      instance!.adapter.executeQuery(`SELECT * FROM ${LEDGER} ORDER BY id`);

    it(
      "names the ledger row --rolled-back would record and writes none",
      async () => {
        for (const command of [["migrate:create", "init"], ["migrate"]]) {
          const run = await nextly([...command, "--quiet"]);
          expect(run.status, run.stderr).toBe(0);
        }
        const file = readdirSync(join(project, "migrations")).find(name =>
          name.endsWith(".sql")
        )!;
        const before = await ledger();

        const dry = await nextly([
          "migrate:resolve",
          "--rolled-back",
          file,
          "--dry-run",
        ]);
        expect(dry.status, dry.stdout + dry.stderr).toBe(0);
        expect(dry.stdout).toMatch(/Would record .*rolled.back/i);
        expect(dry.stdout).toContain("Dry run: nothing was changed.");
        expect(await ledger()).toEqual(before);

        const real = await nextly(["migrate:resolve", "--rolled-back", file]);
        expect(real.status, real.stdout + real.stderr).toBe(0);
        expect((await ledger()).length).toBeGreaterThan(before.length);
      },
      4 * NEXTLY_RUN_TIMEOUT
    );
  }
);
