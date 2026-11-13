/**
 * A field-group field renamed in a code-first config keeps its stored values through
 * `nextly migrate:create` and `nextly migrate`, and `nextly migrate:down` puts them back under the
 * old name, on every configured dialect.
 *
 * A field group's values live in the group's own table (`comp_<slug>`), keyed by the parent's table
 * and the FIELD NAME (`_parent_table`, `_parent_field`), so the parent table has no column to
 * rename. A migration that only compares columns writes nothing for the rename, and every stored
 * value stays keyed by the old name, where nothing reads it: the field reads empty after the
 * migration although no row was deleted. What separates a correct generator from that one is the
 * value read back through the new name.
 *
 * Covered: a single field group on a collection, a repeatable dynamic zone (blocks) whose list of
 * groups is reordered in the same change, a field group nested inside another field group, and a
 * Single sharing the renamed field's group table without renaming its own field, whose rows the
 * move must leave alone. Run non-interactively with `--accept-renames`, as CI runs it.
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
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
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
import { runMigrateDown } from "../migrate-down";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

/** The names each field carries before (`v1`) and after (`v2`) the rename. */
type Names = { seo: string; layout: string; cta: string };
const V1: Names = { seo: "seo", layout: "layout", cta: "cta" };
const V2: Names = { seo: "legacySeo", layout: "sections", cta: "button" };

function declarations(names: Names, zoneOrder: string[]) {
  const fieldGroups = [
    defineFieldGroup({ slug: "rk_seo", fields: [text({ name: "metaTitle" })] }),
    defineFieldGroup({ slug: "rk_cta", fields: [text({ name: "label" })] }),
    defineFieldGroup({
      slug: "rk_hero",
      fields: [
        text({ name: "heading" }),
        // Nested: the hero group's own table is the parent of these rows.
        fieldGroup({ name: names.cta, component: "rk_cta" }),
      ],
    }),
  ];
  const collections = [
    defineCollection({
      slug: "rk_posts",
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: names.seo, component: "rk_seo" }),
        fieldGroup({
          name: names.layout,
          components: zoneOrder,
          repeatable: true,
        }),
      ],
    }),
  ];
  // Shares `comp_rk_seo` with the posts and keeps its field's name.
  const singles = [
    defineSingle({
      slug: "rk_home",
      fields: [fieldGroup({ name: "seo", component: "rk_seo" })],
    }),
  ];
  return { fieldGroups, collections, singles };
}

const before = declarations(V1, ["rk_hero", "rk_cta"]);
const after = declarations(V2, ["rk_cta", "rk_hero"]);
const configOf = (d: typeof before) =>
  defineConfig({ ...d, db: { migrationsDir: "./migrations" } });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-renamed-group-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
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
    const scratch = await createScratchDatabase(dialect, "nextly_rk_group");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/**
 * Start the app over the database at `url`, declaring `declared`. Stopping the app before
 * disconnects its adapter, so each start opens one of its own.
 */
async function start(
  dialect: TestDialect,
  url: string,
  declared: Partial<typeof before>
): Promise<{ app: TestNextly; adapter: DrizzleAdapter }> {
  await shutdownServices().catch(() => {});
  clearServices();
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  const app = await createTestNextly({
    adapter: adapter as never,
    ...declared,
  });
  return { app, adapter };
}

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
      },
      options: {},
      cwd: dir,
    } as CommandContext,
    said,
  };
}

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await fn();
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    exit.mockRestore();
  }
}

/** `migrate:create` with `name`, non-interactively, then `migrate`. */
async function createAndApply(
  name: string,
  options: { acceptRenames?: boolean } = {}
): Promise<void> {
  setNonInteractive(true);
  const created = command();
  expect(
    await exiting(() =>
      runMigrateCreate(name, { cwd: dir, ...options }, created.context)
    ),
    created.said.join("\n")
  ).toBeUndefined();
  const applied = command();
  expect(
    await exiting(() => runMigrate({ cwd: dir }, applied.context)),
    applied.said.join("\n")
  ).toBeUndefined();
}

/** The SQL file `migrate:create` wrote for `name`. */
async function migrationFile(name: string): Promise<string> {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  if (file === undefined) throw new Error(`no migration named ${name}`);
  return readFile(join(dir, "migrations", file), "utf-8");
}

/** Each group-table row's parent table and field, sorted, as the database holds them. */
async function keys(adapter: DrizzleAdapter, table: string): Promise<string[]> {
  const rows = (await adapter.executeQuery(
    `SELECT _parent_table AS t, _parent_field AS f FROM ${table}`
  )) as Array<{ t: string; f: string }>;
  return rows.map(row => `${row.t}.${row.f}`).sort();
}

/** The values a post and the Single read back, under the names `names` gives them. */
async function readBack(t: TestNextly, names: Names, id: string) {
  const post = (await t.nextly.findByID({
    collection: "rk_posts" as never,
    id: id as never,
  })) as Record<string, unknown>;
  const home = (await t.nextly.findSingle({
    slug: "rk_home" as never,
    overrideAccess: true,
  })) as Record<string, unknown>;
  const zone = (post[names.layout] ?? []) as Array<Record<string, unknown>>;
  return {
    seo: (post[names.seo] as { metaTitle?: unknown } | null)?.metaTitle,
    zone: zone.map(item => [
      item._componentType,
      item.heading ?? item.label,
      (item[names.cta] as { label?: unknown } | undefined)?.label,
    ]),
    home: (home.seo as { metaTitle?: unknown } | null)?.metaTitle,
  };
}

describe.each(getConfiguredTestDialects())(
  "a field group renamed in code keeps its values through migrate:create (%s)",
  dialect => {
    it("re-keys the stored rows to the new names, and migrate:down keys them back", async () => {
      const url = await openDatabase(dialect);
      // An empty database the app has started on, declaring nothing: the migrations build the rest.
      await start(dialect, url, {});
      loaded.config = configOf(before);
      await createAndApply("create_posts");

      // Content stored under the first names.
      const first = await start(dialect, url, before);
      const created = await first.app.nextly.create({
        collection: "rk_posts" as never,
        data: {
          title: "P",
          seo: { metaTitle: "Kept title" },
          layout: [
            {
              _componentType: "rk_hero",
              heading: "Hero",
              cta: { label: "Go" },
            },
            { _componentType: "rk_cta", label: "Buy" },
          ],
        } as never,
      });
      const id = String((created.item as { id: unknown }).id);
      await first.app.nextly.updateSingle({
        slug: "rk_home" as never,
        data: { seo: { metaTitle: "Home title" }, _overwrite: true } as never,
        overrideAccess: true,
      });
      const stored = await readBack(first.app, V1, id);
      expect(stored).toEqual({
        seo: "Kept title",
        zone: [
          ["rk_hero", "Hero", "Go"],
          ["rk_cta", "Buy", undefined],
        ],
        home: "Home title",
      });

      // The rename, migrated as CI migrates it.
      loaded.config = configOf(after);
      await createAndApply("rename_groups", { acceptRenames: true });

      const renamed = await start(dialect, url, after);
      // The values read back through the new names.
      expect(await readBack(renamed.app, V2, id)).toEqual(stored);
      expect(await keys(renamed.adapter, "comp_rk_seo")).toEqual(
        ["dc_rk_posts.legacySeo", "single_rk_home.seo"].sort()
      );
      expect(await keys(renamed.adapter, "comp_rk_cta")).toEqual(
        ["comp_rk_hero.button", "dc_rk_posts.sections"].sort()
      );

      const { upSql, downSql } = parseSqlSections(
        await migrationFile("rename_groups")
      );
      // Its rows move inside the migration's own statements, both ways.
      expect(upSql).toMatch(/UPDATE\s+\S*comp_rk_seo/);
      expect(downSql).toMatch(/UPDATE\s+\S*comp_rk_seo/);

      // Rolled back, every row is keyed by its first name again.
      await shutdownServices().catch(() => {});
      loaded.config = configOf(before);
      const down = command();
      expect(
        await exiting(() => runMigrateDown({ cwd: dir }, down.context)),
        down.said.join("\n")
      ).toBeUndefined();
      const back = await start(dialect, url, before);
      expect(await keys(back.adapter, "comp_rk_seo")).toEqual(
        ["dc_rk_posts.seo", "single_rk_home.seo"].sort()
      );
      expect(await keys(back.adapter, "comp_rk_cta")).toEqual(
        ["comp_rk_hero.cta", "dc_rk_posts.layout"].sort()
      );
      expect(await readBack(back.app, V1, id)).toEqual(stored);
    });
  }
);
