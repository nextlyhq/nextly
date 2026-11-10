/**
 * `nextly webhooks:prune --dry-run` opens the database read-only and changes
 * nothing in it, on every dialect: run as a shell runs it against a migrated
 * database, it exits 0 with what a pass would remove, and every table and the
 * webhook queue's rows are as they were.
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

/** This file's own collection, so its tables are its own. */
const COLLECTION = "wpd_posts";

const CONFIG = `
export default {
  collections: [{ slug: "${COLLECTION}", fields: [{ name: "title", type: "text" }] }],
  db: { migrationsDir: "./migrations" },
};
`;

describe.each(getConfiguredTestDialects())(
  "webhooks:prune --dry-run (%s)",
  (dialect: TestDialect) => {
    let project: string;
    let instance: TestNextly | undefined;
    let databaseUrl: string | undefined;
    let databaseDialect: string | undefined;

    beforeEach(async () => {
      project = mkdtempSync(join(tmpdir(), "nextly-webhooks-dry-"));
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
        NEXTLY_ACCEPT_DATA_LOSS: undefined,
        NEXTLY_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });

    /** Every table, and the rows of the webhook queue's two tables. */
    async function state() {
      const adapter = instance!.adapter;
      const tables = (await adapter.listTables()).sort();
      const rows = async (table: string) =>
        tables.includes(table)
          ? adapter.executeQuery(`SELECT * FROM ${table}`)
          : [];
      return {
        tables,
        events: await rows("nextly_events"),
        deliveries: await rows("nextly_webhook_deliveries"),
      };
    }

    it(
      "names what a pass would remove and changes nothing",
      async () => {
        for (const command of [["migrate:create", "init"], ["migrate"]]) {
          const run = await nextly([...command, "--quiet"]);
          expect(run.status, run.stderr).toBe(0);
        }
        const before = await state();

        const dry = await nextly(["webhooks:prune", "--dry-run"]);
        expect(dry.status, dry.stdout + dry.stderr).toBe(0);
        expect(dry.stdout).toMatch(/Would remove \d+ webhook event/);
        expect(await state()).toEqual(before);
      },
      3 * NEXTLY_RUN_TIMEOUT
    );
  }
);
