/**
 * A field type change on per-language storage, the layout every installation runs: a text field's
 * values live in each language's row of the entity's translations table, so the Schema Builder
 * save converts them there, a value that cannot convert cleared only on a confirmed count, its
 * migration file carries the conversion, `nextly migrate` converts a second database's own values
 * in that table alike under its consent, and `migrate:down` takes them back. Proved on SQLite,
 * PostgreSQL and MySQL, values read back through the Direct API.
 *
 * What separates the right answer from plausible wrong ones: a conversion that reaches only the
 * entity's own table converts nothing here, as the values are not there; a save left to the
 * database's cast cannot clear a value it keeps, so it refuses one no address reads.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import {
  downDatabaseDeps,
  migrateDownCore,
} from "../../../cli/commands/migrate-down";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { readConvertsMark } from "../migrate/converts-header";
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../migrate/data-loss-consent";
import {
  marksNoTransaction,
  NO_TRANSACTION_MARKER,
} from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { withMigrateLock } from "../pipeline/locks";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { textsOf } from "./helpers/document-texts";

perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcp_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-per-language-"));
  // The schema dialog applies its change, and writes its migration, in development only.
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

async function boot(
  dialect: TestDialect,
  options: { localization?: { locales: string[]; defaultLocale: string } } = {}
): Promise<TestNextly> {
  instance = await createTestNextly({ dialect, basePath, db: DB, ...options });
  return instance;
}

/** Two languages, English the default. */
const LANGUAGES = {
  localization: { locales: ["en", "es"], defaultLocale: "en" },
};

async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
}

/** `nextly migrate` on `t`'s database over the folder the first database wrote. */
async function migrateFolder(
  t: TestNextly,
  step?: number,
  consent: DataLossConsent = NO_CONSENT
): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  await migrateCore({
    ...(step === undefined ? {} : { step }),
    extensionSchema: undefined,
    dialect: adapter.getCapabilities().dialect,
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: join(basePath, "migrations"),
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast",
    consent,
    interactive: false,
    throwOnFailure: true,
  } as never);
  clearRegistryRowCache();
}

/**
 * `nextly migrate:down` of the newest migration on `t`'s database, reading the files of the folder
 * as the command reads them: each DOWN with its migration's mark.
 */
async function migrateDown(
  t: TestNextly,
  consent: DataLossConsent = resolveDataLossConsent({ flag: true, env: {} })
): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const migrationsDir = join(basePath, "migrations");
  await migrateDownCore({
    ...(await downDatabaseDeps({
      adapter,
      dialect: adapter.getCapabilities().dialect,
      migrationsDir,
    })),
    nodeEnv: "test",
    logger: createLogger({ quiet: true }),
    options: { step: 1, consent, yes: true, dryRun: false },
    fileExists: () => Promise.resolve(true),
    readDownSql: async (filename: string) => {
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(join(migrationsDir, name), "utf-8");
      const converts = readConvertsMark(content, name);
      return {
        sql: parseSqlSections(content).downSql,
        transaction: !marksNoTransaction(content),
        ...(converts === null ? {} : { converts }),
      };
    },
    withLock: withMigrateLock,
  } as Parameters<typeof migrateDownCore>[0]);
  clearRegistryRowCache();
}

/** A run refused before its first statement, one of whose issues says `why`. */
function refusedSaying(why: string) {
  return {
    code: "VALIDATION_ERROR",
    publicData: {
      errors: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining(why) }),
      ]),
    },
  };
}

async function createPosts(fields: Record<string, unknown>[]): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    { name: SLUG, label: "Post", fields }
  );
}

async function save(
  t: TestNextly,
  fields: Record<string, unknown>[],
  extra: Record<string, unknown> = {}
): Promise<void> {
  const [row] = await (
    t.adapter as unknown as { executeQuery<R>(s: string): Promise<R[]> }
  ).executeQuery<{ v: number | string | null }>(
    `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: Number(row?.v ?? 1),
      ...extra,
    }
  );
  clearRegistryRowCache();
}

async function write(
  t: TestNextly,
  title: string,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.create({
    collection: SLUG,
    data: { title, ...data },
  } as never);
}

const TRANSLATED_S = { name: "s", type: "text", localized: true };
const JOINED_V = { name: "v", type: "email", localized: true };

/** A collection with a shared `v`, and `translated`: with one, its translations table is there. */
async function createTranslated(
  translated: Record<string, unknown>[] = [TRANSLATED_S]
): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "createCollection",
    {},
    {
      name: SLUG,
      label: "Post",
      localized: true,
      fields: [...translated, { name: "v", type: "text", localized: false }],
    }
  );
}

/** `createTranslated`'s fields with `v` translated and an email. */
const JOINED = [TRANSLATED_S, JOINED_V];

/** The migration files written, in the order they run. */
async function filesNamed(): Promise<string[]> {
  return (await readdir(join(basePath, "migrations")))
    .filter(f => f.endsWith(".sql"))
    .sort();
}

/** A statement on `t`'s database, outside any save. */
async function exec<R>(t: TestNextly, statement: string): Promise<R[]> {
  return (
    t.adapter as unknown as { executeQuery<T>(s: string): Promise<T[]> }
  ).executeQuery<R>(statement);
}

/** The columns of `table`, as the database names them. */
async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
  const { dialect } = (
    t.adapter as unknown as DrizzleAdapter
  ).getCapabilities();
  const columns = await exec<{ name: string }>(
    t,
    dialect === "sqlite"
      ? `SELECT name FROM pragma_table_info('${table}')`
      : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`
  );
  // An absent table would read as one with no column.
  expect(columns.length).toBeGreaterThan(0);
  return columns.map(column => column.name);
}

/** `v` of each entry, by title, as the entries' table or their translations table stores it. */
async function storedIn(
  t: TestNextly,
  where: "main" | "locales"
): Promise<Record<string, unknown>> {
  const rows = await exec<{ title: string; v: unknown }>(
    t,
    where === "main"
      ? `SELECT title, v FROM dc_${SLUG}`
      : `SELECT m.title AS title, l.v AS v FROM dc_${SLUG}_locales l JOIN dc_${SLUG} m ON m.id = l._parent WHERE l._locale = 'en'`
  );
  return Object.fromEntries(rows.map(row => [row.title, row.v]));
}

/** `v` of each entry, by title, read through the Direct API. */
async function read(t: TestNextly): Promise<Record<string, unknown>> {
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Array<Record<string, unknown>> };
  return Object.fromEntries(
    found.items.map(item => [String(item.title), item.v ?? null])
  );
}

describe.each(getConfiguredTestDialects())(
  "a type change on per-language storage converts each language's value, saved and deployed alike (%s)",
  dialect => {
    // A text becoming an email stays translatable, so its values stay in the translations table:
    // the type change a translatable field makes there. A number is not translatable, so a text
    // becoming one also leaves translation, which a save refuses until the two are made apart.
    const email = { name: "v", type: "email" };
    /** A case that rewrites or clears a value, which no road does on MySQL (`rewritesValuesOn`). */
    const converts = it.skipIf(!rewritesValuesOn(dialect));
    const refuses = it.runIf(!rewritesValuesOn(dialect));

    it("converts a text field into an email in its translations table, and keeps an empty one empty", async () => {
      const t = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      await write(t, "a", { v: "a@b.co" });
      await write(t, "b", {});

      await save(t, [email]);

      expect(await read(t)).toEqual({ a: "a@b.co", b: null });
    });

    converts(
      "clears a value that cannot convert once the clear is confirmed with its count, and converts the rest",
      async () => {
        const t = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "a@b.co" });
        await write(t, "lost", { v: "not an address" });

        await save(t, [email], {
          confirmedTypeChanges: [{ field: "v", kept: 1, changed: 0, lost: 1 }],
        });

        expect(await read(t)).toEqual({ kept: "a@b.co", lost: null });
      }
    );

    converts(
      "refuses a change that would lose a value when no clear is confirmed, and changes nothing",
      async () => {
        const t = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "a@b.co" });
        await write(t, "lost", { v: "not an address" });

        await expect(save(t, [email])).rejects.toMatchObject(
          refusedSaying(
            "Change the values that cannot convert, then save again"
          )
        );

        expect(await read(t)).toEqual({
          kept: "a@b.co",
          lost: "not an address",
        });
      }
    );

    converts(
      "converts a deploy's own values when nextly migrate replays the file, clearing one that cannot convert only with consent",
      async () => {
        const first = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        const created = await filesWritten();
        await write(first, "kept", { v: "a@b.co" });
        await save(first, [email]);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await write(second, "address", { v: "c@d.co" });
        await write(second, "word", { v: "zzz" });

        await expect(migrateFolder(second)).rejects.toThrow();
        expect(await read(second)).toEqual({ address: "c@d.co", word: "zzz" });

        await migrateFolder(
          second,
          undefined,
          resolveDataLossConsent({ flag: true, env: {} })
        );
        expect(await read(second)).toEqual({ address: "c@d.co", word: null });
      }
    );

    it("takes a deploy's own values back when migrate:down rolls the change back", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const created = await filesWritten();
      await write(first, "kept", { v: "a@b.co" });
      await save(first, [email]);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "address", { v: "c@d.co" });
      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );

      await migrateDown(second);

      expect(await read(second)).toEqual({ address: "c@d.co" });
    });

    // A text becoming a rich text stays translatable too: each language's text becomes a document
    // of its lines in the translations table, a form the database's cast does not write.
    converts(
      "converts a text field into a rich text in its translations table, a document of its lines",
      async () => {
        const t = await boot(dialect);
        await createPosts([{ name: "v", type: "code" }]);
        await write(t, "a", { v: "one\ntwo" });

        await save(t, [{ name: "v", type: "richText" }]);

        expect(textsOf((await read(t)).a)).toEqual(["one", "two"]);
      }
    );

    converts(
      "converts a deploy's own texts into rich texts when nextly migrate replays the file",
      async () => {
        const first = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        const created = await filesWritten();
        await write(first, "a", { v: "one" });
        await save(first, [{ name: "v", type: "richText" }]);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await write(second, "b", { v: "three" });
        await migrateFolder(second);

        expect(textsOf((await read(second)).b)).toEqual(["three"]);
      }
    );

    // The change's files are the main one, whose column the conversion writes, and the one adding a
    // translated column to the other table: refused before the first of them, whichever it is, so
    // neither has run.
    converts(
      "refuses a deploy over an update trigger before any file of the change runs",
      async () => {
        const number = { name: "n", type: "number" };
        const first = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }, number]);
        const created = await filesWritten();
        await save(first, [
          { name: "v", type: "text" },
          { name: "n", type: "checkbox" },
          { name: "w", type: "text" },
        ]);
        // The fixture's control: the save wrote a file for each table.
        expect((await filesWritten()) - created).toBeGreaterThan(1);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await second.nextly.create({
          collection: SLUG,
          data: { title: "a", v: "x", n: 1 },
        } as never);
        const exec = <R>(statement: string) =>
          (
            second.adapter as unknown as {
              executeQuery<T>(s: string): Promise<T[]>;
            }
          ).executeQuery<R>(statement);
        if (dialect === "postgresql") {
          await exec(
            `CREATE FUNCTION tcpl_touch_fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql`
          );
        }
        await exec(
          dialect === "postgresql"
            ? `CREATE TRIGGER tcpl_touch AFTER UPDATE ON dc_${SLUG} FOR EACH ROW EXECUTE FUNCTION tcpl_touch_fn()`
            : `CREATE TRIGGER tcpl_touch AFTER UPDATE ON dc_${SLUG} BEGIN SELECT 1; END`
        );

        await expect(
          migrateFolder(
            second,
            undefined,
            resolveDataLossConsent({ flag: true, env: {} })
          )
        ).rejects.toMatchObject(refusedSaying("tcpl_touch"));

        const columns = await exec<{ name: string }>(
          dialect === "postgresql"
            ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'dc_${SLUG}_locales'`
            : `SELECT name FROM pragma_table_info('dc_${SLUG}_locales')`
        );
        // The fixture's control: the translations table is there, with the column it had.
        expect(columns.map(c => c.name)).toContain("v");
        expect(columns.map(c => c.name)).not.toContain("w");
      }
    );

    // A required field's value in one language goes as a shared field's does: the fill is written into
    // that language's lost value, and a language with none keeps none, as its column may.
    converts(
      "writes a fill into each language's lost value, and into none a language does not hold",
      async () => {
        const t = await boot(dialect, LANGUAGES);
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: SLUG,
            label: "Post",
            localized: true,
            fields: [
              { name: "v", type: "text", localized: true, required: true },
            ],
          }
        );
        for (const [title, en, es] of [
          ["kept", "a@b.co", undefined],
          ["en", "zzz", "c@d.co"],
          ["es", "e@f.co", "yyy"],
        ] as const) {
          const made = (await t.nextly.create({
            collection: SLUG,
            data: { title, v: en },
            locale: "en",
          } as never)) as { item?: { id?: string }; id?: string };
          if (es === undefined) continue;
          await t.nextly.update({
            collection: SLUG,
            id: made.item?.id ?? made.id,
            data: { v: es, _overwrite: true },
            locale: "es",
          } as never);
        }
        const next = [
          { name: "v", type: "email", localized: true, required: true },
        ];

        await expect(save(t, next, { localized: true })).rejects.toMatchObject(
          refusedSaying("2 rows would be left with no value")
        );
        await save(t, next, {
          localized: true,
          confirmedTypeChanges: [
            { field: "v", kept: 3, changed: 0, lost: 2, fill: "x@y.co" },
          ],
        });

        const rows = await exec<{ title: string; l: string; v: unknown }>(
          t,
          `SELECT m.title AS title, l._locale AS l, l.v AS v FROM dc_${SLUG}_locales l JOIN dc_${SLUG} m ON m.id = l._parent ORDER BY m.title, l._locale`
        );
        expect(rows.map(row => [row.title, row.l, row.v])).toEqual([
          ["en", "en", "x@y.co"],
          ["en", "es", "c@d.co"],
          ["es", "en", "e@f.co"],
          ["es", "es", "x@y.co"],
          ["kept", "en", "a@b.co"],
        ]);
      }
    );

    // The file that moves a field into the translations table copies its values there before the
    // change's own file, which would convert them in a column it then drops: what could not convert
    // would stay in the translations table as it was. Refused unless every value is one the new type
    // keeps as it is, on a save and on a deploy, naming the two saves.
    converts(
      "refuses a value to convert or clear in a field that becomes translated in the same save, and changes nothing",
      async () => {
        const t = await boot(dialect, LANGUAGES);
        await createTranslated();
        await write(t, "kept", { v: "a@b.co" });
        await write(t, "lost", { v: "zzz" });
        const written = await filesWritten();

        for (const extra of [
          {},
          {
            confirmedTypeChanges: [
              { field: "v", kept: 1, changed: 0, lost: 1 },
            ],
          },
        ]) {
          await expect(
            save(t, JOINED, { localized: true, ...extra })
          ).rejects.toMatchObject(
            refusedSaying("becomes translated in the same save")
          );
        }

        expect(await filesWritten()).toBe(written);
        expect(await storedIn(t, "main")).toEqual({
          kept: "a@b.co",
          lost: "zzz",
        });
        expect(await columnsOf(t, `dc_${SLUG}_locales`)).not.toContain("v");
      }
    );

    converts(
      "refuses to deploy a value to convert or clear in a field that becomes translated in the same change, and changes nothing",
      async () => {
        const first = await boot(dialect, LANGUAGES);
        await createTranslated();
        const created = await filesWritten();
        await write(first, "kept", { v: "a@b.co" });
        // Every value is one an email keeps: the save goes ahead, and each stands in its language.
        await save(first, JOINED, { localized: true });
        expect(await storedIn(first, "locales")).toEqual({ kept: "a@b.co" });
        // The control: the file that copies the values was written ahead of the change's own.
        const [copies, own] = (await filesNamed()).slice(created);
        expect([copies, own]).toEqual([
          expect.stringContaining("joins_localization"),
          expect.stringContaining("update"),
        ]);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect, LANGUAGES);
        await migrateFolder(second, created);
        await write(second, "address", { v: "c@d.co" });
        await write(second, "word", { v: "zzz" });

        await expect(
          migrateFolder(
            second,
            undefined,
            resolveDataLossConsent({ flag: true, env: {} })
          )
        ).rejects.toMatchObject(
          refusedSaying("becomes translated in the same save")
        );

        expect(await storedIn(second, "main")).toEqual({
          address: "c@d.co",
          word: "zzz",
        });
        expect(await columnsOf(second, `dc_${SLUG}_locales`)).not.toContain(
          "v"
        );
      }
    );

    // A conversion runs in the first of the change's files that changes its table, so the mark to run
    // outside a transaction on any of them stops the change before the first.
    converts(
      "refuses a deploy whose change has another file marked to run outside a transaction, and runs none of it",
      async () => {
        const number = { name: "n", type: "text", localized: false };
        const first = await boot(dialect, LANGUAGES);
        await createTranslated([TRANSLATED_S, number]);
        const created = await filesWritten();
        await save(
          first,
          [
            TRANSLATED_S,
            { ...number, type: "number" },
            { name: "v", type: "text", localized: true },
          ],
          { localized: true }
        );
        const [joins] = (await filesNamed()).slice(created);
        expect(joins).toContain("joins_localization");
        const path = join(basePath, "migrations", joins ?? "");
        await writeFile(
          path,
          `${NO_TRANSACTION_MARKER}\n${await readFile(path, "utf8")}`
        );
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect, LANGUAGES);
        await migrateFolder(second, created);
        await write(second, "a", { v: "x", n: "012" });

        await expect(
          migrateFolder(
            second,
            undefined,
            resolveDataLossConsent({ flag: true, env: {} })
          )
        ).rejects.toMatchObject(refusedSaying(joins ?? ""));

        expect(await exec(second, `SELECT v, n FROM dc_${SLUG}`)).toEqual([
          { v: "x", n: "012" },
        ]);
        expect(await columnsOf(second, `dc_${SLUG}_locales`)).not.toContain(
          "v"
        );
      }
    );

    // A translations table the change itself makes is filled after the change's own file, from values
    // that file has converted: the order the join above does not have, so nothing is refused.
    converts(
      "converts a deploy's own values before the file that makes the translations table copies them",
      async () => {
        const first = await boot(dialect, LANGUAGES);
        await createTranslated([]);
        const created = await filesWritten();
        await write(first, "kept", { v: "a@b.co" });
        await save(first, [JOINED_V], { localized: true });
        // The control: the file that copies the values was written after the change's own.
        expect((await filesNamed()).slice(created)).toEqual([
          expect.stringContaining("update"),
          expect.stringContaining("enable_localization"),
        ]);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect, LANGUAGES);
        await migrateFolder(second, created);
        await write(second, "address", { v: "c@d.co" });
        await write(second, "word", { v: "zzz" });
        await migrateFolder(
          second,
          undefined,
          resolveDataLossConsent({ flag: true, env: {} })
        );

        expect(await storedIn(second, "locales")).toEqual({
          address: "c@d.co",
          word: null,
        });
      }
    );

    // Where no road rewrites values, each change above that would rewrite or clear one is judged by
    // the database's cast and refused, its counts confirmed or not: the values stay as they were.
    refuses(
      "refuses to clear a value where no road rewrites values, its counts confirmed or not",
      async () => {
        const t = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        await write(t, "kept", { v: "a@b.co" });
        await write(t, "lost", { v: "not an address" });

        for (const extra of [
          {},
          {
            confirmedTypeChanges: [
              { field: "v", kept: 1, changed: 0, lost: 1 },
            ],
          },
        ]) {
          await expect(save(t, [email], extra)).rejects.toMatchObject(
            refusedSaying("can't be deployed yet")
          );
        }

        expect(await read(t)).toEqual({
          kept: "a@b.co",
          lost: "not an address",
        });
      }
    );

    refuses(
      "refuses a text becoming a rich text where no road rewrites values",
      async () => {
        const t = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        await write(t, "a", { v: "one" });

        await expect(
          save(t, [{ name: "v", type: "richText" }])
        ).rejects.toMatchObject(refusedSaying("can't be deployed yet"));

        expect(await read(t)).toEqual({ a: "one" });
      }
    );

    refuses(
      "refuses a deploy's own value that cannot convert, given consent to clear it, where no road rewrites values",
      async () => {
        const first = await boot(dialect);
        await createPosts([{ name: "v", type: "text" }]);
        const created = await filesWritten();
        await write(first, "kept", { v: "a@b.co" });
        await save(first, [email]);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await write(second, "address", { v: "c@d.co" });
        await write(second, "word", { v: "zzz" });

        await expect(
          migrateFolder(
            second,
            undefined,
            resolveDataLossConsent({ flag: true, env: {} })
          )
        ).rejects.toMatchObject(refusedSaying("can't be deployed yet"));
        expect(await read(second)).toEqual({ address: "c@d.co", word: "zzz" });
      }
    );
  }
);
