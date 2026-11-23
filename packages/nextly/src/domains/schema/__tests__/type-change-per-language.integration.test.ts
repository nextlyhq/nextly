/**
 * A field type change on per-language storage, the layout every installation runs: a text field's
 * values live in each language's row of the entity's translations table, so the Schema Builder
 * save converts them there, its migration file carries the conversion, `nextly migrate` converts a
 * second database's own values in that table alike, and `migrate:down` converts them back. Proved
 * on SQLite, PostgreSQL and MySQL, values read back through the Direct API.
 *
 * What separates the right answer from plausible wrong ones: a conversion that reaches only the
 * entity's own table converts nothing here, as the values are not there; one that runs only the
 * file's cast refuses a text no cast reads the same way on every database.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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
import { marksNoTransaction } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { withMigrateLock } from "../pipeline/locks";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

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
    it("converts a text field's whole numbers into a number in its translations table, and keeps an empty one empty", async () => {
      const t = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      await write(t, "a", { v: "12" });
      await write(t, "b", {});

      await save(t, [{ name: "v", type: "number" }]);

      expect(await read(t)).toEqual({ a: 12, b: null });
    });

    it("clears a value that cannot convert once the clear is confirmed with its count, and converts the rest", async () => {
      const t = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      await save(t, [{ name: "v", type: "number" }], {
        confirmedClears: [{ field: "v", count: 1 }],
      });

      expect(await read(t)).toEqual({ kept: 12, lost: null });
    });

    it("refuses a change that would lose a value when no clear is confirmed, and changes nothing", async () => {
      const t = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      await write(t, "kept", { v: "12" });
      await write(t, "lost", { v: "abc" });

      await expect(
        save(t, [{ name: "v", type: "number" }])
      ).rejects.toMatchObject(
        refusedSaying("Confirm clearing the values that cannot convert")
      );

      expect(await read(t)).toEqual({ kept: "12", lost: "abc" });
    });

    it("converts a deploy's own values when nextly migrate replays the file, clearing one that cannot convert only with consent", async () => {
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const created = await filesWritten();
      await write(first, "kept", { v: "12" });
      await save(first, [{ name: "v", type: "number" }]);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "word", { v: "zzz" });

      await expect(migrateFolder(second)).rejects.toThrow();
      expect(await read(second)).toEqual({ whole: "34", word: "zzz" });

      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );
      expect(await read(second)).toEqual({ whole: 34, word: null });
    });

    it("converts a deploy's own values back when migrate:down rolls the change back", async () => {
      const float = { name: "v", type: "number", options: { format: "float" } };
      const first = await boot(dialect);
      await createPosts([{ name: "v", type: "text" }]);
      const created = await filesWritten();
      await write(first, "kept", { v: "12" });
      await save(first, [float]);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await write(second, "whole", { v: "34" });
      await write(second, "part", { v: "7.5" });
      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );
      expect(await read(second)).toEqual({ whole: 34, part: 7.5 });

      await migrateDown(second);

      expect(await read(second)).toEqual({ whole: "34", part: "7.5" });
    });
  }
);
