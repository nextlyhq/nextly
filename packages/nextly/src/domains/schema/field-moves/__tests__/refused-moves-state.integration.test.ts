/**
 * The comparison every refused move is held to (`databaseState`) sees each thing a save could have
 * changed: a registry value, a row's value, a column, an index, a migration file and the
 * definition file. One of them changed, the states differ, so a refusal that left one changed could
 * not pass for "nothing changed".
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";

import { databaseState } from "./refused-moves-state";

const SLUG = "rms_posts";
const TABLE = "dc_rms_posts";
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-refused-state-"));
  await mkdir(join(basePath, "migrations"), { recursive: true });
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    await rm(basePath, { recursive: true, force: true });
  }
});

describe.each(getConfiguredTestDialects())(
  "the state a refused move is compared by (%s)",
  (dialect: TestDialect) => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);
    const run = <T>(t: TestNextly, statement: string) =>
      (t.adapter as unknown as DrizzleAdapter).executeQuery(
        statement
      ) as unknown as Promise<T[]>;
    const state = (t: TestNextly) =>
      databaseState({
        run: <T>(statement: string) => run<T>(t, statement),
        dialect,
        tablePrefixes: [TABLE],
        registries: [{ table: "dynamic_collections", slugs: [SLUG] }],
        migrations: join(basePath, "migrations"),
        definitionFile: join(basePath, "ui-schema.json"),
      });

    it("notices each thing a save could have changed, and is unmoved by none of them", async () => {
      instance = await createTestNextly({ dialect, basePath, db: DB });
      const t = instance;
      await t.getService("collectionService").createCollection(
        {
          name: SLUG,
          label: "Post",
          localized: false,
          fields: [
            { name: "headline", type: "text" },
            { name: "code", type: "text", unique: true },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      await t.nextly.create({
        collection: SLUG as never,
        data: { title: "P", slug: "p", headline: "H", code: "a" } as never,
      });
      const before = await state(t);
      // Read again, nothing changed, the state is the same: none of what it compares drifts by itself.
      expect(await state(t)).toEqual(before);

      const changes: { what: string; change: () => Promise<unknown> }[] = [
        {
          what: "a registry value",
          change: () =>
            run(
              t,
              `UPDATE dynamic_collections SET description = 'changed' WHERE slug = '${SLUG}'`
            ),
        },
        {
          what: "a row's value",
          change: () =>
            run(t, `UPDATE ${q(TABLE)} SET ${q("headline")} = 'changed'`),
        },
        {
          what: "a column",
          change: () =>
            run(t, `ALTER TABLE ${q(TABLE)} ADD COLUMN ${q("extra")} TEXT`),
        },
        {
          what: "an index",
          change: () =>
            run(
              t,
              `CREATE INDEX ${q("rms_extra")} ON ${q(TABLE)} (${q("code")})`
            ),
        },
        {
          what: "a migration file",
          change: () =>
            writeFile(join(basePath, "migrations", "x.sql"), "-- changed"),
        },
        {
          what: "the definition file",
          change: () =>
            writeFile(join(basePath, "ui-schema.json"), "{}", { flag: "a" }),
        },
      ];
      for (const { what, change } of changes) {
        const held = await state(t);
        await change();
        expect(await state(t), what).not.toEqual(held);
      }
    });
  }
);
