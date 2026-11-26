/**
 * `nextly migrate`, run as a command over a project whose Schema Builder saved a repeater and a
 * group translatable as a whole: it refuses the definition file, naming each field and what to
 * edit, and changes nothing. Once the marks are out of the file, `migrate:create` and `migrate`
 * keep every language's values.
 *
 * The collection is made through the Schema Builder's own entry point, which writes the definition
 * file; its entry holds each language's whole value on its own row, as an earlier release stored
 * it; and each command is a process of its own, reading the project's files from disk.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { createAdapter } from "../../../database/factory";
import { shutdownServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
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

// As every installation runs now, each command's own process included (`storage-layout`).
perLanguageStorageSuite();

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SECRET = "test-secret-must-be-at-least-32-characters-long!!";

/** The fields as the Builder sends them, two of them translatable as a whole. */
const FIELDS = [
  { name: "heading", type: "text" },
  {
    name: "slides",
    type: "repeater",
    localized: true,
    fields: [
      { name: "caption", type: "text" },
      { name: "rank", type: "number" },
    ],
  },
  {
    name: "seo",
    type: "group",
    localized: true,
    fields: [
      { name: "headline", type: "text" },
      { name: "weight", type: "number" },
    ],
  },
];

const whole = (captions: [string, string], headline: string) => ({
  slides: [
    { id: "r1", caption: captions[0], rank: 1 },
    { id: "r2", caption: captions[1], rank: 2 },
  ],
  seo: { headline, weight: 5 },
});
const STORED = {
  en: whole(["first", "second"], "Read"),
  es: whole(["primero", "segundo"], "Lee"),
};

describe.each(getConfiguredTestDialects())(
  "nextly migrate over a Builder collection translated in whole containers (%s)",
  (dialect: TestDialect) => {
    let dir: string;
    let url: string;
    let drop: () => Promise<void>;
    let t: TestNextly | undefined;

    const adapterFor = () =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;
    const boot = async (): Promise<TestNextly> => {
      t = await createTestNextly({
        adapter: (await adapterFor()) as never,
        basePath: dir,
        localization: LOCALIZATION,
        db: DB,
      } as never);
      return t;
    };
    const shut = async () => {
      await t?.destroy();
      t = undefined;
      await shutdownServices();
    };
    const run = (...args: string[]) =>
      runNextly(args, dir, {
        DB_DIALECT: dialect,
        DATABASE_URL: url,
        NEXTLY_SECRET: SECRET,
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NO_COLOR: "1",
      });

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "nextly-migrate-containers-"));
      mkdirSync(join(dir, "migrations"));
      if (dialect === "sqlite") {
        url = `file:${join(dir, "app.db")}`;
        drop = async () => undefined;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_whole");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NODE_ENV", "development");
      _resetEnvCache();
    }, 120_000);

    afterEach(async () => {
      await shut();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      await rm(dir, { recursive: true, force: true, maxRetries: 10 });
    });

    /** The site as the Builder left it, and the entry's id. */
    async function site(): Promise<string> {
      const nextly = await boot();
      await dispatchCollections(
        {} as Parameters<typeof dispatchCollections>[0],
        "createCollection",
        {},
        { name: "shows", label: "Shows", fields: FIELDS, localized: true }
      );
      const created = await nextly.nextly.create({
        collection: "shows",
        locale: "en",
        data: { title: "Show", heading: "Read" },
      });
      const id = (created.item as { id: string }).id;
      await nextly.nextly.update({
        collection: "shows",
        id,
        locale: "es",
        data: { heading: "Lee", _overwrite: true },
      });
      const adapter = nextly.adapter as unknown as DrizzleAdapter;
      for (const [locale, value] of Object.entries(STORED)) {
        await adapter.update(
          "dc_shows_locales",
          {
            slides: JSON.stringify(value.slides),
            seo: JSON.stringify(value.seo),
          },
          {
            and: [
              { column: "_parent", op: "=", value: id },
              { column: "_locale", op: "=", value: locale },
            ],
          }
        );
      }
      await shut();
      writeFileSync(
        join(dir, "nextly.config.ts"),
        `export default ${JSON.stringify({ localization: LOCALIZATION, db: DB })};\n`
      );
      return id;
    }

    /** Every table with its rows, and every project file with what it holds. */
    async function everything(): Promise<unknown> {
      const adapter = await adapterFor();
      const tables = (await adapter.listTables()).sort();
      const quote = dialect === "mysql" ? "`" : '"';
      const rows: Record<string, string[]> = {};
      for (const table of tables) {
        const found = await adapter.executeQuery(
          `SELECT * FROM ${quote}${table}${quote}`
        );
        rows[table] = found.map(row => JSON.stringify(row)).sort();
      }
      await adapter.disconnect();
      const files: Record<string, string> = {};
      for (const entry of readdirSync(dir, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile() || entry.name.startsWith("app.db")) continue;
        const path = join(entry.parentPath, entry.name);
        files[path] = readFileSync(path, "utf8");
      }
      return { rows, files };
    }

    it(
      "refuses the marked fields by name, with what to edit, and changes nothing",
      async () => {
        await site();
        const before = await everything();
        // The snapshot holds the values it must not lose sight of.
        expect(JSON.stringify(before)).toContain("primero");

        for (const args of [
          ["migrate", "--backup-confirmed"],
          ["migrate:create", "--name", "later", "--non-interactive"],
        ]) {
          const ran = await run(...args);
          const said = ran.stderr.replace(/\s+/g, " ");
          const name = args.join(" ");

          expect(ran.status, `${name}\n${ran.stdout}${ran.stderr}`).toBe(1);
          expect(said, name).toContain("CONFIG_INVALID");
          for (const [at, field] of [
            [1, "slides"],
            [2, "seo"],
          ] as const) {
            expect(said, name).toContain(
              `ui-schema.json collections[0].fields[${at}].localized`
            );
            expect(said, name).toContain(`Field "${field}"`);
          }
          expect(said, name).toContain("remove `localized: true`");
          expect(said, name).toContain(
            "Edit it in ui-schema.json, then run `nextly migrate:create` and `nextly migrate`."
          );
          expect(await everything(), name).toEqual(before);
        }
      },
      NEXTLY_RUN_TIMEOUT * 4
    );

    it(
      "keeps each language's values once the marks are out of the file",
      async () => {
        const id = await site();
        const file = join(dir, "ui-schema.json");
        const definition = JSON.parse(readFileSync(file, "utf8")) as {
          collections: Array<{ fields: Array<{ localized?: boolean }> }>;
        };
        for (const field of definition.collections[0]?.fields ?? []) {
          delete field.localized;
        }
        writeFileSync(file, JSON.stringify(definition, null, 2));

        for (const args of [
          ["migrate:create", "--name", "whole", "--non-interactive"],
          ["migrate", "--backup-confirmed"],
        ]) {
          const ran = await run(...args);
          expect(
            ran.status,
            `${args.join(" ")}\n${ran.stdout}${ran.stderr}`
          ).toBe(0);
        }
        expect(
          readdirSync(join(dir, "migrations")).some(name =>
            name.endsWith("_whole.sql")
          )
        ).toBe(true);
        expect(existsSync(file)).toBe(true);

        const after = await boot();
        for (const [locale, value] of Object.entries(STORED)) {
          const item = (await after.nextly.findByID({
            collection: "shows",
            id,
            locale,
          })) as ReturnType<typeof whole>;
          expect(
            item.slides.map(({ id: row, caption, rank }) => ({
              id: row,
              caption,
              rank,
            })),
            locale
          ).toEqual(value.slides);
          expect(item.seo, locale).toMatchObject(value.seo);
        }
        await shut();

        // Nothing is left to do.
        const again = await run("migrate", "--backup-confirmed");
        expect(again.status, again.stderr).toBe(0);
        expect(again.stdout).not.toContain("keep one structure");
      },
      NEXTLY_RUN_TIMEOUT * 4
    );
  }
);
