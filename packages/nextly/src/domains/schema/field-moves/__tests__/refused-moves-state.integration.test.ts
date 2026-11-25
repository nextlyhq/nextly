/**
 * The comparison every refused move is held to (`databaseState`) sees each thing a save could have
 * changed: a registry value and one inside its JSON, a row's value and one inside its group, a
 * column, its nullability and default, a check, an index, a migration file and the definition file.
 * One of them changed, the states differ, so a refusal that left one changed could
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
            {
              name: "meta",
              type: "group",
              fields: [{ name: "note", type: "text" }],
            },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      await t.nextly.create({
        collection: SLUG as never,
        data: {
          title: "P",
          slug: "p",
          headline: "H",
          code: "a",
          meta: { note: "n" },
        } as never,
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
          // A key below the row's own: the databases that keep JSON hand it out parsed.
          what: "a value inside a registry row's JSON",
          change: async () => {
            const [row] = await run<{ fields: unknown }>(
              t,
              `SELECT fields FROM dynamic_collections WHERE slug = '${SLUG}'`
            );
            const fields = (
              typeof row.fields === "string"
                ? JSON.parse(row.fields)
                : row.fields
            ) as { name: string; label?: string }[];
            const changed = fields.map(field =>
              field.name === "headline" ? { ...field, label: "Changed" } : field
            );
            await run(
              t,
              `UPDATE dynamic_collections SET fields = '${JSON.stringify(changed)}' WHERE slug = '${SLUG}'`
            );
          },
        },
        {
          what: "a value inside a row's group",
          change: () =>
            run(
              t,
              `UPDATE ${q(TABLE)} SET ${q("meta")} = '{"note":"changed"}'`
            ),
        },
        // SQLite changes no column it has in place.
        ...(dialect === "sqlite"
          ? []
          : [
              {
                what: "a column's default",
                change: () =>
                  run(
                    t,
                    `ALTER TABLE ${q(TABLE)} ALTER COLUMN ${q("code")} SET DEFAULT 'x'`
                  ),
              },
              {
                what: "a check",
                change: () =>
                  run(
                    t,
                    `ALTER TABLE ${q(TABLE)} ADD CONSTRAINT rms_check CHECK (${q("slug")} <> '')`
                  ),
              },
              {
                what: "a column's nullability",
                change: () =>
                  run(
                    t,
                    dialect === "mysql"
                      ? `ALTER TABLE ${q(TABLE)} MODIFY COLUMN ${q("code")} varchar(255) NOT NULL`
                      : `ALTER TABLE ${q(TABLE)} ALTER COLUMN ${q("code")} SET NOT NULL`
                  ),
              },
            ]),
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
      const unseen: string[] = [];
      for (const { what, change } of changes) {
        const held = JSON.stringify(await state(t));
        await change();
        if (JSON.stringify(await state(t)) === held) unseen.push(what);
      }
      expect(unseen).toEqual([]);
    });
  }
);
