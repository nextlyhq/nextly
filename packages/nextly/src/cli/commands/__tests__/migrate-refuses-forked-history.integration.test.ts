/**
 * A project's migration history is one line: each migration's snapshot names
 * the one it was written from, and migrations written without each other
 * are refused where the migrations are used, with the files named, until a
 * migration records the merge, on every configured dialect.
 *
 * A fork is made here as it is made in a project: a migration is written,
 * set aside, another is written from the same starting point, and the first
 * is put back, which is what two branches merged leave, and what a writer
 * stopped past its hold on the migration files leaves beside its successor.
 * The commands are driven themselves against a project directory and a
 * database of the test's own.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  writeCollectionSave,
  type CollectionSaveDeps,
} from "../../../domains/schema/builder-save/collection-save";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import { withSchemaChangeExcluded } from "../../../domains/schema/services/schema-change-exclusion";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { _resetEnvCache } from "../../../shared/lib/env";
import { toCliError } from "../../errors/from-thrown";
import { formatCliError } from "../../errors/render";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

/** The configs the commands load, in the order they are started. */
const loaded = vi.hoisted(() => ({ configs: [] as unknown[] }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.configs.shift(),
    dependencies: [],
  }),
}));

/**
 * A step taken once `nextly migrate` has made its checks before the lock,
 * the last of which is of the configuration against the migrations, and
 * before it takes the lock: where the folder can change under a waiting run.
 */
const stops = vi.hoisted(() => ({
  beforeLock: undefined as (() => void) | undefined,
}));
vi.mock(
  "../../../domains/schema/migrate/refuse-unwritten-changes",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/migrate/refuse-unwritten-changes")
      >();
    return {
      ...original,
      refuseUnwrittenChanges: async (
        ...args: Parameters<typeof original.refuseUnwrittenChanges>
      ) => {
        await original.refuseUnwrittenChanges(...args);
        const step = stops.beforeLock;
        stops.beforeLock = undefined;
        step?.();
      },
    };
  }
);

// This file's own tables.
const POSTS = "fh_posts";
const TAGS = "fh_tags";
const PRICES = "fh_prices";
const NOTES = "fh_notes";
const table = (slug: string) => `dc_${slug}`;

const configOf = (slugs: string[]) =>
  defineConfig({
    collections: slugs.map(slug =>
      defineCollection({ slug, fields: [text({ name: "title" })] })
    ),
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);
const BASE = configOf([POSTS]);
/** The project with `fields` added to its one collection, beside its title. */
const postsWith = (fields: string[]) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: POSTS,
        fields: ["title", ...fields].map(name => text({ name })),
      }),
    ],
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
/** What the commands printed as errors: a refusal a command exits on. */
let printed: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-forked-history-"));
  mkdirSync(join(dir, "migrations"));
  mkdirSync(join(dir, "aside"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  loaded.configs.length = 0;
});

afterEach(async () => {
  stops.beforeLock = undefined;
  await instance?.destroy();
  instance = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A booted instance the commands reach through `DATABASE_URL`. SQLite runs on
 * a file in the test's directory, since an in-memory database is unreachable
 * from the commands' connection.
 */
async function boot(dialect: TestDialect): Promise<TestNextly> {
  if (dialect !== "sqlite") return createTestNextly({ dialect });
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  return createTestNextly({ adapter });
}

/** A command's context, with everything it says captured. */
function command(): { context: CommandContext; said: string[] } {
  const said: string[] = [];
  const base = createLogger({ quiet: true });
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...base,
        info: capture,
        warn: capture,
        success: capture,
        error: capture,
        item: capture,
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** How a command ended: whether it was refused, and all it said and printed. */
interface Ended {
  refused: boolean;
  said: string;
}

/** Runs a command over `config`, with its refusal as the CLI prints it. */
async function run(
  config: unknown,
  work: (context: CommandContext) => Promise<void>
): Promise<Ended> {
  loaded.configs.push(config);
  printed = [];
  const { context, said } = command();
  const all = () => [...said, ...printed].join("\n");
  try {
    await work(context);
    return { refused: false, said: all() };
  } catch (error) {
    if (!/^exit \d+$/.test((error as Error).message)) {
      said.push(formatCliError(toCliError(error)));
    }
    return {
      refused: (error as Error).message !== "exit 0",
      said: all(),
    };
  }
}

const migrateCreate = (config: unknown, name: string) =>
  run(config, context => runMigrateCreate(name, { cwd: dir }, context));
const migrateCreateBlank = (config: unknown, name: string) =>
  run(config, context =>
    runMigrateCreate(name, { cwd: dir, blank: true }, context)
  );
const migrate = (config: unknown) =>
  run(config, context =>
    runMigrate({ cwd: dir, throwOnFailure: true }, context)
  );
const migrateCheck = (config: unknown) =>
  run(config, context => runMigrateCheck({ cwd: dir }, context));

/** The migration files in the folder, in run order. */
const sqlFiles = () =>
  readdirSync(join(dir, "migrations"))
    .filter(f => f.endsWith(".sql"))
    .sort();

/** The migration whose name ends `_<name>.sql`. */
const fileOf = (name: string) =>
  sqlFiles().find(file => file.endsWith(`_${name}.sql`)) ?? `no ${name}`;

/** The parent the snapshot of `file` records. */
function parentOf(file: string): unknown {
  const path = join(
    dir,
    "migrations",
    "meta",
    file.replace(/\.sql$/, ".snapshot.json")
  );
  return (JSON.parse(readFileSync(path, "utf-8")) as { parent?: unknown })
    .parent;
}

/** Moves a migration and its snapshot between the folder and a place aside. */
function move(
  file: string,
  to: "aside" | "back",
  kind: "generated" | "blank" = "generated"
): void {
  const snapshot = file.replace(/\.sql$/, ".snapshot.json");
  // A blank migration is its file alone.
  const inFolder = [
    join(dir, "migrations", file),
    ...(kind === "blank" ? [] : [join(dir, "migrations", "meta", snapshot)]),
  ];
  const aside = [
    join(dir, "aside", file),
    ...(kind === "blank" ? [] : [join(dir, "aside", snapshot)]),
  ];
  const [from, into] = to === "aside" ? [inFolder, aside] : [aside, inFolder];
  from.forEach((path, index) => renameSync(path, into[index]));
}

/**
 * Writes a migration adding each of `slugs` in turn, every one from the
 * folder as it stood before the first: a fork of that many. Answers their
 * files in the order written.
 */
function writtenBesideEachOther(slugs: string[]): Promise<string[]> {
  return eachFromTheSameStart(
    slugs.map(slug => ({
      name: `add_${slug}`,
      config: configOf([POSTS, slug]),
    }))
  );
}

/**
 * Writes each of `changes` as a migration from the folder as it stood before
 * the first, and answers their files in the order written.
 */
async function eachFromTheSameStart(
  changes: { name: string; config: unknown }[]
): Promise<string[]> {
  const files: string[] = [];
  for (const { name, config } of changes) {
    const created = await migrateCreate(config, name);
    expect(created.refused, created.said).toBe(false);
    const file = fileOf(name);
    files.push(file);
    move(file, "aside");
    // A later file is named for a later millisecond.
    await pause(5);
  }
  for (const file of files) move(file, "back");
  return files;
}

describe.each(getConfiguredTestDialects())(
  "migrations written without each other are refused until the merge is recorded (%s)",
  dialect => {
    let adapter: DrizzleAdapter;
    let base: string;

    beforeEach(async () => {
      setNonInteractive(true);
      vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      printed = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
      });
      instance = await boot(dialect);
      adapter = instance.adapter as unknown as DrizzleAdapter;
      const created = await migrateCreate(BASE, "base");
      expect(created.refused, created.said).toBe(false);
      const applied = await migrate(BASE);
      expect(applied.refused, applied.said).toBe(false);
      base = fileOf("base");
      await pause(5);
    });

    afterEach(() => {
      setNonInteractive(false);
      vi.restoreAllMocks();
    });

    it("each migration names the one it was written from, the first naming none", async () => {
      const created = await migrateCreate(configOf([POSTS, TAGS]), "add_tags");
      expect(created.refused, created.said).toBe(false);

      expect(parentOf(base)).toBeNull();
      expect(parentOf(fileOf("add_tags"))).toBe(base.replace(/\.sql$/, ""));
      // A line: applied as before.
      const applied = await migrate(configOf([POSTS, TAGS]));
      expect(applied.refused, applied.said).toBe(false);
      expect(await adapter.tableExists(table(TAGS))).toBe(true);
    }, 120_000);

    it("after a merge of two branches: migrate applies neither, migrate:create records the merge, and migrate then applies all", async () => {
      // Sara's branch added a color to posts, main added a size, and she
      // merged main.
      const [color, size] = await eachFromTheSameStart([
        { name: "add_color", config: postsWith(["color"]) },
        { name: "add_size", config: postsWith(["size"]) },
      ]);
      const both = postsWith(["color", "size"]);
      const columns = async () =>
        (
          await introspectLiveSnapshot(
            adapter.getDrizzle(),
            dialect === "postgresql" ? "postgresql" : dialect,
            [table(POSTS)]
          )
        ).tables[0].columns.map(column => column.name);

      const refused = await migrate(both);

      expect(refused.refused).toBe(true);
      expect(refused.said).toContain("MIGRATION_HISTORY_FORKED");
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${color} and ${size}.`
      );
      expect(refused.said).toContain(
        "Run `nextly migrate:create --name record_merge` to record the merge"
      );
      expect(await columns()).not.toContain("color");
      expect(await columns()).not.toContain("size");

      // The fix it names. The record is written from the newest of the two.
      await pause(5);
      const recorded = await migrateCreate(both, "record_merge");
      expect(recorded.refused, recorded.said).toBe(false);
      const record = fileOf("record_merge");
      expect(sqlFiles().at(-1)).toBe(record);
      expect(parentOf(record)).toBe(size.replace(/\.sql$/, ""));

      const applied = await migrate(both);
      expect(applied.refused, applied.said).toBe(false);
      expect(await columns()).toEqual(
        expect.arrayContaining(["title", "color", "size"])
      );
      // One line again: the check passes, and a run has nothing left to do.
      const checked = await migrateCheck(both);
      expect(checked.refused, checked.said).toBe(false);
      const again = await migrate(both);
      expect(again.refused, again.said).toBe(false);
    }, 120_000);

    it("after a merge where each branch added a collection: the merge is recorded and migrate applies all", async () => {
      const [tags, prices] = await writtenBesideEachOther([TAGS, PRICES]);
      const both = configOf([POSTS, TAGS, PRICES]);

      const refused = await migrate(both);
      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${tags} and ${prices}.`
      );
      expect(await adapter.tableExists(table(TAGS))).toBe(false);
      expect(await adapter.tableExists(table(PRICES))).toBe(false);

      // The record creates the table the newest snapshot lacks, which the
      // other branch's migration has made by the time the record is reached:
      // it is recorded as applied, its table and indexes being there already.
      await pause(5);
      const recorded = await migrateCreate(both, "record_merge");
      expect(recorded.refused, recorded.said).toBe(false);

      const applied = await migrate(both);
      expect(applied.refused, applied.said).toBe(false);
      expect(await adapter.tableExists(table(TAGS))).toBe(true);
      expect(await adapter.tableExists(table(PRICES))).toBe(true);
      const checked = await migrateCheck(both);
      expect(checked.refused, checked.said).toBe(false);
      const again = await migrate(both);
      expect(again.refused, again.said).toBe(false);
    }, 120_000);

    it("with one of the two applied on this database, names the other as the one not applied and leaves the applied one", async () => {
      const [tags, prices] = await writtenBesideEachOther([TAGS, PRICES]);
      // As the database of the developer whose branch had the first: applied
      // there before the other arrived.
      move(prices, "aside");
      const first = await migrate(configOf([POSTS, TAGS]));
      expect(first.refused, first.said).toBe(false);
      move(prices, "back");

      const refused = await migrate(configOf([POSTS, TAGS, PRICES]));

      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `${tags} is applied on this database, and ${prices} was written without its changes, so it was not applied.`
      );
      expect(await adapter.tableExists(table(TAGS))).toBe(true);
      expect(await adapter.tableExists(table(PRICES))).toBe(false);
    }, 120_000);

    it("names all three where three were written from one parent", async () => {
      const files = await writtenBesideEachOther([TAGS, PRICES, NOTES]);

      const refused = await migrate(configOf([POSTS, TAGS, PRICES, NOTES]));

      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Three migrations were written from ${base}: ${files[0]}, ${files[1]} and ${files[2]}.`
      );
      for (const slug of [TAGS, PRICES, NOTES]) {
        expect(await adapter.tableExists(table(slug))).toBe(false);
      }
    }, 120_000);

    it("two migrations that make the same change are not recorded as a merge: one is deleted", async () => {
      // As a writer stopped past its hold leaves the folder beside the one
      // that took its place: the same change, written twice.
      const withTags = configOf([POSTS, TAGS]);
      const files = await eachFromTheSameStart([
        { name: "first", config: withTags },
        { name: "second", config: withTags },
      ]);
      const both = `They both change ${table(TAGS)}, so they cannot be applied one after the other`;

      const refused = await migrate(withTags);
      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${files[0]} and ${files[1]}.`
      );
      expect(refused.said).toContain(both);
      expect(refused.said).not.toContain("record_merge");
      expect(await adapter.tableExists(table(TAGS))).toBe(false);

      // `migrate:create` writes no record on top of the two.
      const unrecorded = await migrateCreate(withTags, "record_merge");
      expect(unrecorded.refused).toBe(true);
      expect(unrecorded.said).toContain(both);
      expect(sqlFiles()).toHaveLength(3);

      rmSync(join(dir, "migrations", files[0]));
      rmSync(
        join(
          dir,
          "migrations",
          "meta",
          files[0].replace(/\.sql$/, ".snapshot.json")
        )
      );
      const applied = await migrate(withTags);
      expect(applied.refused, applied.said).toBe(false);
      expect(await adapter.tableExists(table(TAGS))).toBe(true);
    }, 120_000);

    it("where the merged configuration keeps only the newest branch's change, migrate:create names the other to delete", async () => {
      const [color, size] = await eachFromTheSameStart([
        { name: "add_color", config: postsWith(["color"]) },
        { name: "add_size", config: postsWith(["size"]) },
      ]);

      const nothing = await migrateCreate(postsWith(["size"]), "record_merge");

      expect(nothing.refused, nothing.said).toBe(false);
      expect(nothing.said).toContain(
        `The configuration is what ${size} records, so there is no merge to write. ${color} was written without it`
      );
      expect(sqlFiles()).toHaveLength(3);
    }, 120_000);

    it("two blank migrations written from the same history are refused until a blank one records them", async () => {
      // Hand-written SQL has no snapshot to compare, so each blank file
      // states the migration it was written after.
      const files: string[] = [];
      for (const name of ["seed_posts", "backfill_posts"]) {
        const created = await migrateCreateBlank(BASE, name);
        expect(created.refused, created.said).toBe(false);
        files.push(fileOf(name));
        move(fileOf(name), "aside", "blank");
        await pause(5);
      }
      for (const file of files) move(file, "back", "blank");

      const refused = await migrate(BASE);
      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${files[0]} and ${files[1]}.`
      );
      expect(refused.said).toContain(
        "Run `nextly migrate:create --blank --name record_merge` to record that they apply in this order"
      );

      await pause(5);
      const recorded = await migrateCreateBlank(BASE, "record_merge");
      expect(recorded.refused, recorded.said).toBe(false);
      const applied = await migrate(BASE);
      expect(applied.refused, applied.said).toBe(false);
      // A run after it has nothing left to do, and nothing to refuse.
      const again = await migrate(BASE);
      expect(again.refused, again.said).toBe(false);
    }, 120_000);

    it("refuses a migration written beside another while the run waited for the lock, before its first write", async () => {
      const [tags, prices] = await writtenBesideEachOther([TAGS, PRICES]);
      // The folder holds one of the two when the run starts and makes its
      // first checks; the other arrives before the run takes the lock.
      move(prices, "aside");
      stops.beforeLock = () => move(prices, "back");

      const refused = await migrate(configOf([POSTS, TAGS]));

      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${tags} and ${prices}.`
      );
      // Read again under the lock, so neither was applied.
      expect(await adapter.tableExists(table(TAGS))).toBe(false);
      expect(await adapter.tableExists(table(PRICES))).toBe(false);
    }, 120_000);

    it("is not settled by a migration that only follows one of the branches", async () => {
      const [tags, prices] = await writtenBesideEachOther([TAGS, PRICES]);
      // Written on the second branch, with the first not in the folder.
      move(tags, "aside");
      await pause(5);
      const followed = await migrateCreate(
        configOf([POSTS, PRICES, NOTES]),
        "add_notes"
      );
      expect(followed.refused, followed.said).toBe(false);
      move(tags, "back");

      const refused = await migrate(configOf([POSTS, TAGS, PRICES, NOTES]));

      expect(refused.refused).toBe(true);
      expect(refused.said).toContain(
        `Two migrations were written from ${base}: ${tags} and ${prices}.`
      );
      expect(await adapter.tableExists(table(TAGS))).toBe(false);
      expect(await adapter.tableExists(table(NOTES))).toBe(false);
    }, 120_000);

    it("migrate:check fails and a Builder save adds nothing, until the merge is recorded", async () => {
      const [tags, prices] = await writtenBesideEachOther([TAGS, PRICES]);
      const both = configOf([POSTS, TAGS, PRICES]);
      const named = `Two migrations were written from ${base}: ${tags} and ${prices}.`;
      const before = sqlFiles();

      const checked = await migrateCheck(both);
      expect(checked.refused).toBe(true);
      expect(checked.said).toContain(named);

      const deps: CollectionSaveDeps = {
        adapter,
        config: both,
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        applies: false,
        logger: quiet,
      };
      const save = () =>
        withSchemaChangeExcluded(
          {
            adapter,
            logger: quiet as never,
            label: `create collection "${NOTES}"`,
            issuesDdl: false,
            migrationsDir: deps.migrationsDir,
          },
          () =>
            writeCollectionSave(deps, {
              slug: NOTES,
              previous: null,
              entity: {
                slug: NOTES,
                labels: { singular: "Note", plural: "Notes" },
                fields: [{ name: "title", type: "text" }],
              } as UiSchemaEntity,
              change: "create",
            })
        ).then(
          () => "saved",
          (error: unknown) =>
            (error as { publicMessage?: string }).publicMessage
        );
      expect(await save()).toContain(named);
      expect(sqlFiles()).toEqual(before);

      // Recorded, the check passes and the save is written after it.
      await pause(5);
      const recorded = await migrateCreate(both, "record_merge");
      expect(recorded.refused, recorded.said).toBe(false);
      const passed = await migrateCheck(both);
      expect(passed.refused, passed.said).toBe(false);
      await pause(5);
      expect(await save()).toBe("saved");
      expect(sqlFiles()).toHaveLength(before.length + 2);
    }, 120_000);
  }
);
