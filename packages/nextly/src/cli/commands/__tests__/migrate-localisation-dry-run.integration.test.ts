/**
 * `nextly migrate --dry-run`, run as the command runs, over an installation from before the
 * localisation model: its data steps' report prints what will move, what conflicts and what an
 * editor should check, under their headings; and it writes nothing, every table holding as many
 * rows afterwards as before.
 *
 * The plausible broken commands: one that prints the counts alone, and a dry run that writes.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { defineConfig } from "../../../config";
import {
  bootSite,
  seedLegacyStates,
  SITE,
  type UpgradeDatabase,
} from "../../../domains/i18n/__tests__/helpers/localisation-upgrade-fixture";
import { _resetPerLanguageStorage } from "../../../domains/i18n/per-language-storage";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateBaseline } from "../migrate-baseline";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

// Written for per-language storage as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];

/** The project the command runs in, set before the run. */
const project = vi.hoisted(() => ({ dir: "" }));

// `migrate` reads the app's entities, so it refuses a project with no configuration: the command
// loads the fixture's site, the configuration the installation was booted from.
vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = defineConfig({
        collections: [...SITE.collections],
        singles: [...SITE.singles],
        localization: {
          locales: [...SITE.localization.locales],
          defaultLocale: SITE.localization.defaultLocale,
        },
      }) as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: project.dir,
        dependencies: [],
      };
    },
  };
});

let dir: string | undefined;
let database: UpgradeDatabase | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await database?.close();
  database = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  _resetPerLanguageStorage();
  vi.unstubAllEnvs();
});

/** The rows of the tables the upgrade would change, by table. */
async function rowCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of [
    "dc_articles",
    "dc_articles_locales",
    "dc_notes",
    "single_footer",
    "nextly_versions",
  ]) {
    const [row] = await database!.adapter.queryStatement<{ n: unknown }>(
      sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(table)}`
    );
    counts[table] = Number(row?.n ?? 0);
  }
  return counts;
}

/** A command's context in `cwd`, its messages captured into `said`. */
function contextIn(cwd: string, said: string[]): CommandContext {
  const capture = (message: string) => {
    said.push(stripVTControlCharacters(message));
  };
  const base = createLogger({ quiet: true });
  return {
    logger: {
      ...base,
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
    },
    options: {},
    cwd,
  } as CommandContext;
}

/** Run `nextly migrate --dry-run` from `cwd`, and what it said. */
async function migrateDryRun(cwd: string): Promise<string[]> {
  const said: string[] = [];
  await runMigrate(
    { cwd, dryRun: true, throwOnFailure: true },
    contextIn(cwd, said)
  );
  return said;
}

it("prints what moves, what conflicts and what to check, and writes nothing", async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-upgrade-dry-run-"));
  project.dir = dir;
  const url = `file:${join(dir, "site.db")}`;
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: "sqlite",
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  database = { dialect: "sqlite", adapter, close: () => adapter.disconnect() };
  const t = await bootSite(database, "legacy");
  await seedLegacyStates(t, database);
  // The installation adopts migrations as a site whose tables a sync made does: `migrate` refuses
  // a configuration no migration records, a dry run too.
  await runMigrateBaseline({ cwd: dir }, contextIn(dir, []));
  const before = await rowCounts();

  const text = (await migrateDryRun(dir)).join("\n");
  expect(text).toMatch(/Would move:/);
  expect(text).toMatch(/notes[^\n]*title[^\n]*per-language table/);
  expect(text).toMatch(/Conflicts, and how a real run settles them:/);
  expect(text).toMatch(/articles[^\n]*code changed in es and fr/);
  expect(text).toMatch(/An editor should check:/);

  expect(await rowCounts()).toEqual(before);
});
