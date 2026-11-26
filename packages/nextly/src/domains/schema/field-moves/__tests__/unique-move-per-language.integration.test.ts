/**
 * A unique field moved out of a group onto its collection's row, on the storage layout every
 * installation now runs: translatable values kept for each language (`perLanguageStorageSuite`).
 * The field is shared (`localized: false`), as a field kept for each language is not moved with its
 * values yet.
 *
 * Moved, its column is made unique and every value kept; with two entries holding one value, the
 * save is refused naming the field and the count; and a deploy's database holding a repeat stops
 * the migration before anything changes there.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { NO_CONSENT } from "../../migrate/data-loss-consent";

perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const SLUG = "umpl_posts";
const TABLE = "dc_umpl_posts";

type Field = Record<string, unknown>;

const NOTE: Field = { name: "note", type: "text", localized: false };
const CODE: Field = { name: "code", type: "text", localized: false };
const group = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  fields,
});
/** `code` inside the group, then on the row and unique. */
const GROUPED: Field[] = [group("meta", [NOTE, CODE])];
const ON_ROW: Field[] = [{ ...CODE, unique: true }, group("meta", [NOTE])];
const OUT_OF_META = [{ from: ["meta", "code"], to: ["code"] }];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-unique-move-lang-"));
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
  instance = await createTestNextly({
    dialect,
    basePath,
    db: DB,
    localization: LOCALIZATION,
  });
  return instance;
}

const run = <T>(t: TestNextly, statement: string) =>
  (t.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

async function createPosts(t: TestNextly): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: SLUG,
      label: "Post",
      localized: false,
      fields: GROUPED,
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

/** The schema dialog's save of `fields`, with the moves the Builder sends beside them. */
async function save(
  t: TestNextly,
  fields: Field[],
  moves: { from: string[]; to: string[] }[]
): Promise<void> {
  const [row] = await run<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${SLUG}'`
  );
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields,
      confirmed: true,
      schemaVersion: Number(row?.version ?? 1),
      hints: { moves },
    }
  );
  clearRegistryRowCache();
}

/** Entries holding `codes` in their group, one each. */
async function seedCodes(
  t: TestNextly,
  codes: readonly string[]
): Promise<void> {
  for (const [i, value] of codes.entries()) {
    await t.nextly.create({
      collection: SLUG,
      data: { title: `P${i}`, slug: `p${i}`, meta: { note: "n", code: value } },
    });
  }
}

/** How many migration files the saves have written so far. */
async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
}

/** `nextly migrate` on `t`'s database over the folder the first database wrote. */
async function migrateFolder(t: TestNextly, step?: number): Promise<void> {
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
    consent: NO_CONSENT,
    interactive: false,
  } as never);
  clearRegistryRowCache();
}

describe.each(getConfiguredTestDialects())(
  "a unique field moved out of a group on per-language storage (%s)",
  dialect => {
    const q = (id: string) => (dialect === "mysql" ? `\`${id}\`` : `"${id}"`);

    async function columnsOf(t: TestNextly): Promise<string[]> {
      const rows = await run<{ name: string }>(
        t,
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${TABLE}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${TABLE}'`
      );
      return rows.map(row => row.name).sort();
    }

    async function storedGroups(t: TestNextly): Promise<unknown[]> {
      const rows = await run<{ meta: unknown }>(
        t,
        `SELECT ${q("meta")} AS meta FROM ${q(TABLE)} ORDER BY ${q("slug")}`
      );
      return rows.map(row =>
        typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta
      );
    }

    it("is moved, its column unique: every value kept, and a repeat refused", async () => {
      const t = await boot(dialect);
      await createPosts(t);
      await seedCodes(t, ["a", "b"]);

      await save(t, ON_ROW, OUT_OF_META);

      const { items } = await t.nextly.find({ collection: SLUG, limit: 10 });
      expect(
        (items as { code?: unknown }[]).map(item => item.code).sort()
      ).toEqual(["a", "b"]);
      await expect(
        t.nextly.create({
          collection: SLUG,
          data: { title: "Again", slug: "again", code: "a" },
        })
      ).rejects.toThrow();
    });

    it("is refused, nothing changed, while two entries hold one value, naming the field and the count", async () => {
      const t = await boot(dialect);
      await createPosts(t);
      await seedCodes(t, ["a", "a", "b"]);
      const groups = await storedGroups(t);
      const columns = await columnsOf(t);
      const files = await filesWritten();
      const stated = await readFile(join(basePath, "ui-schema.json"), "utf-8");

      await expect(save(t, ON_ROW, OUT_OF_META)).rejects.toThrow(
        expect.objectContaining({
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_MOVE_REFUSED",
                message:
                  "code is unique where it moves to, and 1 of its values is held by more than one entry in the group it moves out of. Give each entry its own value, or clear the repeats, then move it.",
              }),
            ],
          },
        })
      );

      expect(await storedGroups(t)).toEqual(groups);
      expect(await columnsOf(t)).toEqual(columns);
      expect(await filesWritten()).toBe(files);
      expect(await readFile(join(basePath, "ui-schema.json"), "utf-8")).toBe(
        stated
      );
    });

    it("stops a replay on a database whose entries repeat a value, before anything changes", async () => {
      const first = await boot(dialect);
      await createPosts(first);
      const created = await filesWritten();
      await seedCodes(first, ["a", "b"]);
      await save(first, ON_ROW, OUT_OF_META);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await seedCodes(second, ["a", "a"]);
      const groups = await storedGroups(second);
      const columns = await columnsOf(second);

      await expect(migrateFolder(second)).rejects.toThrow(
        /two_entries_hold_one_code/
      );

      expect(await storedGroups(second)).toEqual(groups);
      expect(await columnsOf(second)).toEqual(columns);
    });
  }
);
