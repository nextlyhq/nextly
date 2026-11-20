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
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
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
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../migrate/data-loss-consent";

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
      await migrateFolder(second);

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

      await expect(migrateFolder(second)).rejects.toThrow();
      expect(await read(second)).toEqual({ whole: "34", word: "zzz" });

      await migrateFolder(
        second,
        undefined,
        resolveDataLossConsent({ flag: true, env: {} })
      );
      expect(await read(second)).toEqual({ whole: 34, word: null });
    });
  }
);
