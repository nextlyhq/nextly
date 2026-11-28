/**
 * A migration history that records no field group says nothing about which field-group names it
 * is on, so a database on either naming can follow it, on every configured dialect.
 *
 * A project whose snapshots hold no field-group table reads as on the legacy names, the default
 * every earlier release wrote. Its database may still be on the current ones: a site that moved
 * its storage and later removed its last field group, or one first set up by a release that starts
 * new sites on the current names. `nextly migrate` applies such a history's next file there, since
 * nothing in it addresses a field-group table, and still refuses a pending file that does address
 * one under the legacy names, naming it. The move to the current names
 * (`migrate:create --field-group-names=current`) is written beside the config's other changes
 * where the history has no field-group table to rename, so a site in the middle of an upgrade is
 * never stuck between the two commands.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { writeLegacyFieldGroupMigration } from "../../../__tests__/helpers/legacy-field-group-history";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { forgetFieldGroupStorageNames } from "../../../domains/field-groups/storage/resolve-storage-names";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const POSTS = "fn_posts";
const posts = (fields: string[]) =>
  defineCollection({ slug: POSTS, fields: fields.map(name => text({ name })) });

/** The project before the upgrade: one collection, no field group. */
const BEFORE = { collections: [posts(["title"])], fieldGroups: [] };
/** The upgrade's own change: a field the collection gains. */
const AFTER = { collections: [posts(["title", "subtitle"])], fieldGroups: [] };
/** A change that adds the project's first field group, placed by the collection. */
const WITH_GROUP = {
  fieldGroups: [
    defineFieldGroup({ slug: "fn_card", fields: [text({ name: "heading" })] }),
  ],
  collections: [
    defineCollection({
      slug: POSTS,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fn_card" }),
      ],
    }),
  ],
};
type Declared = typeof BEFORE | typeof WITH_GROUP;
const configOf = (d: Declared) =>
  defineConfig({ ...d, db: { migrationsDir: "./migrations" } });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-fg-no-group-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  forgetFieldGroupStorageNames();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_fg_no_group");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/**
 * Start the app over the database at `url`, declaring `declared`, from a folder with no
 * migration history: a first start sets an empty database up on the current names, as a new
 * site's is.
 */
async function start(
  dialect: TestDialect,
  url: string,
  declared: Declared
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  forgetFieldGroupStorageNames();
  return createTestNextly({
    adapter: (await connect(dialect, url)) as never,
    ...declared,
  });
}

/**
 * Run `fn`, turning `process.exit` into a thrown `exit <code>`, and say what it said: a refusal
 * the command throws rather than prints is part of what it said.
 */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...SILENT,
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  const logged = vi.spyOn(console, "error").mockImplementation((...parts) => {
    said.push(parts.map(String).join(" "));
  });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    return { exit: -1, said: [...said, String(error)].join("\n") };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
    forgetFieldGroupStorageNames();
  }
}

function create(
  name: string | undefined,
  options: Record<string, unknown> = {}
) {
  setNonInteractive(true);
  return run(context =>
    runMigrateCreate(
      name,
      { cwd: dir, ...options } as Parameters<typeof runMigrateCreate>[1],
      context
    )
  );
}

const migrate = () => run(context => runMigrate({ cwd: dir }, context));

/** The files a run wrote, by name: `<name>.sql` and its snapshot. */
function written(name: string): { sql: string; snapshot: string } {
  const sql = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  if (sql === undefined) throw new Error(`no migration named ${name}`);
  return {
    sql: join(dir, "migrations", sql),
    snapshot: join(
      dir,
      "migrations",
      "meta",
      sql.replace(/\.sql$/, ".snapshot.json")
    ),
  };
}

/** The statements of a file's UP, comments and blank lines left out. */
async function upStatements(path: string): Promise<string[]> {
  return parseSqlSections(await readFile(path, "utf-8"))
    .upSql.split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("--"));
}

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

async function tableNames(adapter: DrizzleAdapter): Promise<string[]> {
  return (
    adapter as unknown as { listTables: () => Promise<string[]> }
  ).listTables();
}

describe.each(getConfiguredTestDialects())(
  "a migration history that records no field group (%s)",
  dialect => {
    /**
     * A site whose database is on the current field-group names, with one post, and whose
     * history, written on the legacy names, records no field group and is applied. Its registry
     * still holds the row of a field group whose table is gone, as one removed by hand leaves it.
     */
    async function movedSiteWithLegacyHistory(): Promise<string> {
      const url = await openDatabase(dialect);
      // The field group a first start registers, and whose table is then dropped.
      const first = await start(dialect, url, {
        collections: BEFORE.collections,
        fieldGroups: [
          defineFieldGroup({
            slug: "fn_meta",
            fields: [text({ name: "keywords" })],
          }),
        ],
      } as never);
      await first.nextly.create({
        collection: POSTS as never,
        data: { title: "Kept" } as never,
      });
      await shutdownServices().catch(() => {});
      const adapter = await connect(dialect, url);
      expect(await tableNames(adapter)).toContain("dynamic_field_groups");
      expect(await tableNames(adapter)).not.toContain("dynamic_components");
      await adapter.executeQuery(`DROP TABLE ${quote(dialect, "fg_fn_meta")}`);

      loaded.config = configOf(BEFORE);
      await writeLegacyFieldGroupMigration({
        config: configOf(BEFORE),
        projectRoot: dir,
        migrationsDir: join(dir, "migrations"),
        dialect,
        name: "init",
      });
      const recorded = JSON.parse(
        await readFile(written("init").snapshot, "utf-8")
      ) as { fieldGroupStorage?: string };
      // The control: the history reads as the legacy names, which every earlier release wrote.
      expect(recorded.fieldGroupStorage).toBeUndefined();
      // The database already holds the collection's table: the history records it as applied.
      const adopted = await run(context => runMigrate({ cwd: dir }, context));
      expect(adopted.exit, adopted.said).toBeUndefined();
      return url;
    }

    it("applies the next file of a history with no field group to a database on the current names", async () => {
      const url = await movedSiteWithLegacyHistory();
      loaded.config = configOf(AFTER);

      const upgrade = await create("upgrade");
      expect(upgrade.exit, upgrade.said).toBeUndefined();
      const applied = await migrate();

      expect(applied.exit, applied.said).toBeUndefined();
      expect(applied.said).not.toMatch(/FIELD_GROUP_HISTORY_BEHIND_STORAGE/);
      const app = await start(dialect, url, AFTER);
      const [post] = (await app.nextly.find({ collection: POSTS as never }))
        .items as Array<{ title?: string; subtitle?: unknown }>;
      expect(post.title).toBe("Kept");
      expect(post).toHaveProperty("subtitle");
    }, 120_000);

    it("reports the registry row whose field group's table is gone, as one the configuration does not declare", async () => {
      await movedSiteWithLegacyHistory();
      loaded.config = configOf(AFTER);
      expect((await create("upgrade")).exit).toBeUndefined();

      const applied = await migrate();

      expect(applied.exit, applied.said).toBeUndefined();
      expect(applied.said).toMatch(
        /field group "fn_meta": its registry row names table "fg_fn_meta", which does not exist, and the configuration does not declare it\./
      );
      // Not sent to `migrate:create`, which plans nothing for an entity no one declares.
      expect(applied.said).not.toMatch(
        /has not been migrated for the tables and columns above/
      );
    }, 120_000);

    it("writes the move to the current names beside the config's other changes, and the next file follows it", async () => {
      const url = await movedSiteWithLegacyHistory();
      loaded.config = configOf(WITH_GROUP);

      const moved = await create(undefined, { fieldGroupNames: "current" });
      expect(moved.exit, moved.said).toBeUndefined();
      const transition = written("field_group_current_names");
      expect(await upStatements(transition.sql)).toEqual([]);
      const snapshot = JSON.parse(
        await readFile(transition.snapshot, "utf-8")
      ) as {
        fieldGroupStorage?: string;
        snapshot: { tables: Array<{ name: string }> };
      };
      expect(snapshot.fieldGroupStorage).toBe("current");
      // The history as it stood, under the current names: the config's change is not in it.
      expect(snapshot.snapshot.tables.map(t => t.name)).not.toContain(
        "fg_fn_card"
      );

      const group = await create("add_card");
      expect(group.exit, group.said).toBeUndefined();
      const sql = await readFile(written("add_card").sql, "utf-8");
      expect(sql).toMatch(/fg_fn_card/);
      expect(sql).not.toMatch(/comp_fn_card/);

      const applied = await migrate();
      expect(applied.exit, applied.said).toBeUndefined();
      const app = await start(dialect, url, WITH_GROUP);
      const made = await app.nextly.create({
        collection: POSTS as never,
        data: { title: "New", card: { heading: "H" } } as never,
      });
      const read = (await app.nextly.findByID({
        collection: POSTS as never,
        id: (made.item as { id: unknown }).id as never,
      })) as { card?: { heading?: string } };
      expect(read.card?.heading).toBe("H");
    }, 120_000);

    it("refuses a pending file that adds a field group under the legacy names, naming it and the way on", async () => {
      await movedSiteWithLegacyHistory();
      loaded.config = configOf(WITH_GROUP);

      const legacy = await create("add_card");
      expect(legacy.exit, legacy.said).toBeUndefined();
      expect(await readFile(written("add_card").sql, "utf-8")).toMatch(
        /comp_fn_card/
      );
      const refused = await migrate();

      expect(refused.exit).not.toBeUndefined();
      expect(refused.said).toContain("FIELD_GROUP_HISTORY_BEHIND_STORAGE");
      expect(refused.said).toMatch(/_add_card\.sql/);
      expect(refused.said).toMatch(
        /nextly migrate:create --field-group-names=current/
      );
    }, 120_000);
  }
);
