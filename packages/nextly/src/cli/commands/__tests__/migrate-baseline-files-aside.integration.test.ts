/**
 * `nextly migrate:baseline` writes its snapshot and its migration file in
 * full under temporary names before either is put in place. Where the second
 * cannot be written, as on a disk with no room left, the first is not left
 * waiting under its temporary name in `meta/`: the folder is as it was, and
 * the run made again adopts the database, on every dialect.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { baselineCore } from "../migrate-baseline";

// The test's seam on the files a writer prepares: while `fails` is set, a
// migration file (not its snapshot) cannot be written aside.
const sqlWrite = vi.hoisted(() => ({ fails: false, asked: 0 }));
vi.mock(
  "../../../domains/schema/migrate-create/writer-hold",
  async original => {
    const actual =
      await original<
        typeof import("../../../domains/schema/migrate-create/writer-hold")
      >();
    return {
      ...actual,
      prepareWhole: (...args: Parameters<typeof actual.prepareWhole>) => {
        if (args[0].endsWith(".sql")) {
          sqlWrite.asked += 1;
          if (sqlWrite.fails)
            return Promise.reject(
              Object.assign(new Error("ENOSPC: no space left on device"), {
                code: "ENOSPC",
              })
            );
        }
        return actual.prepareWhole(...args);
      },
    };
  }
);

const COLLECTION = "mbfa_posts";
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

describe.each(getConfiguredTestDialects())(
  "migrate:baseline, where its migration file cannot be written (%s)",
  dialect => {
    let t: TestNextly | undefined;
    let basePath = "";

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-baseline-aside-"));
      t = await createTestNextly({
        dialect,
        basePath,
        db: DB,
        collections: [
          defineCollection({
            slug: COLLECTION,
            fields: [text({ name: "title" })],
          }),
        ],
      });
    });

    afterEach(async () => {
      sqlWrite.fails = false;
      sqlWrite.asked = 0;
      await t?.destroy();
      t = undefined;
      await rm(basePath, { recursive: true, force: true });
    });

    const migrationsDir = () => join(basePath, "migrations");

    /** Every migration file, snapshot and file left aside, by its path in the folder. */
    const inFolder = () =>
      existsSync(migrationsDir())
        ? (readdirSync(migrationsDir(), { recursive: true }) as string[])
            .filter(name => /\.(sql|json|tmp)$/.test(name))
            .sort()
        : [];

    const baseline = () => {
      const adapter = t!.adapter as unknown as DrizzleAdapter;
      return baselineCore({
        adapter: adapter as never,
        db: adapter.getDrizzle(),
        dialect: adapter.getCapabilities().dialect,
        migrationsDir: migrationsDir(),
        logger: createLogger({ quiet: true }),
      });
    };

    it("leaves no snapshot waiting aside, and the run made again adopts the database", async () => {
      sqlWrite.fails = true;

      const failed = await baseline().then(
        () => undefined,
        (error: unknown) => error
      );

      // The control: the run reached the migration file, and failed there.
      expect(sqlWrite.asked).toBeGreaterThan(0);
      expect(String(failed)).toMatch(/ENOSPC/);
      expect(inFolder()).toEqual([]);

      sqlWrite.fails = false;
      const adopted = await baseline();

      expect(adopted.kind).toBe("baselined");
      const written = inFolder();
      expect(written.filter(name => name.endsWith(".sql"))).toHaveLength(1);
      expect(
        written.filter(name => name.endsWith(".snapshot.json"))
      ).toHaveLength(1);
      expect(written.filter(name => name.endsWith(".tmp"))).toEqual([]);
    }, 120_000);
  }
);
