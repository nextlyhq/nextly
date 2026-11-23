/**
 * A Schema Builder save's field type change converts each value as the new type reads it, and the
 * migration file it writes carries that conversion to every database it deploys to: `nextly
 * migrate`, replaying the files on a second database whose entries differ, converts that database's
 * own values the same way, rather than leaving them to the database's cast. A value there that
 * cannot convert stops the run, nothing changed, until the run is given consent, and is then
 * cleared while the rest convert. Proved on SQLite, PostgreSQL and MySQL, values read back through
 * the Direct API.
 *
 * What separates the right answer from plausible wrong ones:
 * - a deploy that runs only the file's column change leaves a list's JSON where its one item
 *   belongs, or fails on a text that is no number;
 * - one that carries the development database's own readings converts only the rows that database
 *   held, and none of the deploy's own.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore, previewMigrate } from "../../../cli/commands/migrate";
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
import { marksNoTransaction } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { verifyMigrationHash } from "../migrate-create/snapshot-io";
import { withMigrateLock } from "../pipeline/locks";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcf_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-files-"));
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

async function boot(dialect: TestDialect): Promise<TestNextly> {
  instance = await createTestNextly({ dialect, basePath, db: DB });
  return instance;
}

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
 * The migration file whose header marks the columns it converts, with `edit` applied to its text:
 * how a file written before the mark, or under other rules, reads to `nextly migrate`.
 */
async function editMarkedFile(edit: (text: string) => string): Promise<void> {
  const dir = join(basePath, "migrations");
  const files = (await readdir(dir)).filter(f => f.endsWith(".sql"));
  let edited = 0;
  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    if (!text.includes("-- Converts values:")) continue;
    await writeFile(join(dir, file), edit(text));
    edited += 1;
  }
  // The save wrote one marked file: an edit that reached none would test nothing.
  expect(edited).toBe(1);
}

/** What `nextly migrate --dry-run` prints on `t`'s database over the folder. */
async function dryRun(t: TestNextly): Promise<string> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const printed: string[] = [];
  const capture = new Proxy(
    {},
    {
      get:
        () =>
        (...parts: unknown[]) => {
          printed.push(parts.map(String).join(" "));
        },
    }
  ) as Parameters<typeof previewMigrate>[0]["logger"];
  await previewMigrate({
    adapter: adapter as never,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    migrationsDir: join(basePath, "migrations"),
    plugins: [],
    logger: capture,
  });
  return printed.join("\n");
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

/** The run's consent to lose the data of `targets` (`--accept-data-loss=<targets>`). */
function consentTo(targets: string): DataLossConsent {
  return resolveDataLossConsent({ flag: targets, env: {} });
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
  "a type change's migration file converts each value on the database it deploys to (%s)",
  dialect => {
    it("converts a deploy's own lists of one item into that item", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "chips" }]);
      const created = await filesWritten();
      await write(first, "one", { v: ["a"] });
      await save(first, [{ name: "v", type: "text" }]);
      expect(await read(first)).toEqual({ one: "a" });
      expect(await filesWritten()).toBeGreaterThan(created);
      await first.destroy();
      instance = undefined;

      // A deploy's database: the same files, entries the first database never held.
      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "other", { v: ["b"] });
      await write(second, "empty", { v: [] });
      // A file changing a column's type needs consent naming the column, read from its statements
      // whatever its header says: none on SQLite, whose list and text are both its text.
      await migrateFolder(second, undefined, consentTo("dc_tcf_posts.v"));

      expect(await read(second)).toEqual({ other: "b", empty: null });
    });

    it("stops on a deploy's own value that cannot convert, nothing changed, and with consent clears it while the rest convert", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const created = await filesWritten();
      await write(first, "kept", { v: "12" });
      await write(first, "lost", { v: "abc" });
      await save(first, [{ name: "v", type: "number" }], {
        confirmedClears: [{ field: "v", count: 1 }],
      });
      expect(await read(first)).toEqual({ kept: 12, lost: null });
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "word", { v: "zzz" });

      await expect(migrateFolder(second)).rejects.toThrow(
        /--accept-data-loss=dc_tcf_posts\.v/
      );
      expect(await read(second)).toEqual({ whole: "34", word: "zzz" });

      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );
      expect(await read(second)).toEqual({ whole: 34, word: null });
    });

    /** A first database's text field becoming a number, its file written; its folder kept. */
    async function textBecomesNumber(): Promise<number> {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const created = await filesWritten();
      await write(first, "kept", { v: "12" });
      await save(first, [{ name: "v", type: "number" }]);
      expect(await read(first)).toEqual({ kept: 12 });
      await first.destroy();
      instance = undefined;
      return created;
    }

    // `migrate:check` holds each file to the hash its snapshot recorded when it was written: the
    // mark is part of the file that hash was taken of.
    it("writes the mark into the file its snapshot's hash was taken of, which migrate:check accepts", async () => {
      await textBecomesNumber();
      const dir = join(basePath, "migrations");
      const marked: string[] = [];
      for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql"))) {
        const text = await readFile(join(dir, file), "utf8");
        if (!text.includes("-- Converts values: rules 1; dc_tcf_posts.v")) {
          continue;
        }
        marked.push(file);
        expect(
          (await verifyMigrationHash(join(dir, "meta"), file, text)).ok
        ).toBe(true);
      }
      expect(marked).toHaveLength(1);
    });

    // A rollback of the marked change converts that database's values back as the earlier type
    // reads each, before its DOWN's statements: SQLite's cast would write a number back as 12.0.
    it("converts a deploy's own values back when migrate:down rolls the change back", async () => {
      const created = await textBecomesNumber();
      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "part", { v: "7.5" });
      await migrateFolder(second, undefined, consentTo("dc_tcf_posts.v"));
      expect(await read(second)).toEqual({ whole: 34, part: 7.5 });

      await migrateDown(second);

      expect(await read(second)).toEqual({ whole: "34", part: "7.5" });
    });

    // Undoing a list becoming a text makes each text a list again, which no conversion writes:
    // a text no list reads stops the rollback before its statements, naming its row, and the
    // consent the DOWN's type change takes does not clear it.
    it("stops a rollback on a value its earlier type cannot hold, naming the row, and changes nothing", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "chips" }]);
      const created = await filesWritten();
      await write(first, "one", { v: ["a"] });
      await save(first, [{ name: "v", type: "text" }]);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "listed", { v: ["b"] });
      await migrateFolder(second, undefined, consentTo("dc_tcf_posts.v"));
      await write(second, "words", { v: "plain words" });

      await expect(migrateDown(second)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [expect.objectContaining({ path: "fields.v" })],
        },
      });
      expect(await read(second)).toEqual({ listed: "b", words: "plain words" });
    });

    it("lists in a dry run each column a deploy converts and its values that cannot convert, changing nothing", async () => {
      const created = await textBecomesNumber();
      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "word", { v: "zzz" });

      const printed = await dryRun(second);

      expect(printed).toMatch(
        /converts dc_tcf_posts\.v value by value.*1 converted, 1 that cannot convert cleared/
      );
      expect(printed).toContain("--accept-data-loss=dc_tcf_posts.v");
      expect(await read(second)).toEqual({ whole: "34", word: "zzz" });
    });

    it("judges a file without the mark by the cast, as a file written before it was", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "chips" }]);
      const created = await filesWritten();
      await write(first, "one", { v: ["a"] });
      await save(first, [{ name: "v", type: "text" }]);
      await first.destroy();
      instance = undefined;
      await editMarkedFile(text =>
        text.replace(/^-- Converts values:.*\n/m, "")
      );

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "other", { v: ["b"] });

      await expect(
        migrateFolder(second, undefined, consentTo("dc_tcf_posts.v"))
      ).rejects.toMatchObject(refusedSaying("can't be deployed yet"));
      expect(await read(second)).toEqual({ other: ["b"] });
    });

    it("refuses a file marked with conversion rules this version does not know, and changes nothing", async () => {
      const created = await textBecomesNumber();
      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await editMarkedFile(text =>
        text.replace(
          "-- Converts values: rules 1;",
          "-- Converts values: rules 2;"
        )
      );

      await expect(migrateFolder(second)).rejects.toMatchObject(
        refusedSaying("conversion rules 2")
      );
      expect(await read(second)).toEqual({ whole: "34" });
    });
  }
);
