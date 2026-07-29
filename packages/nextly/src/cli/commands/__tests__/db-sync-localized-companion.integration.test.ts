/**
 * `nextly db:sync` must create the companion `_locales` table in the SAME run.
 *
 * The push pipeline deliberately does not manage companion tables
 * (`managed-tables.isCompanionTable`), and `ensureCompanionTable` — written as
 * the db:sync/dev-boot counterpart to migration-owned creation — used to be
 * called only at boot. Because `db:sync` runs in its own CLI process, it flipped
 * the registry's `localized` flag and left companion creation to whenever the app
 * next started. A server already running then read `localized: 1`, registered the
 * companion in its runtime registry, and rendered the whole localization UI over
 * a table that did not exist. Writes in that window overwrote the default
 * language.
 *
 * So the assertion is specifically that the table exists when the sync sequence
 * returns, not that it exists eventually.
 *
 * This drives the real `syncCollections` → `syncSingles` → `syncComponents` →
 * `ensureLocalizedCompanions` sequence against a real SQLite file, because
 * ORDER is the thing that broke: a companion carries a foreign key to its main
 * table, so running the hook before singles and components are pushed creates
 * nothing for them. What it does NOT prove is that `db-sync.ts` and
 * `dev-watcher.ts` still call the hook — that wiring is a single line in each,
 * checked by reading them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { getDialectTables } from "../../../database/index";
import { SchemaRegistry } from "../../../database/schema-registry";
import { createLogger } from "../../utils/logger";
import {
  ensureLocalizedCompanions,
  syncCollections,
  syncComponents,
  syncSingles,
} from "../dev-build";
import { ensureCoreTables } from "../dev-server";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle/types";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { CommandContext } from "../../program";
import type { LoadConfigResult } from "../../utils/config-loader";
import type { ResolvedDevOptions } from "../db-sync";

let dir: string;
let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-companion-"));
  previousDialect = process.env.DB_DIALECT;
});

afterEach(async () => {
  await adapter?.disconnect();
  adapter = undefined;
  // Integration files share one fork, so a dialect left set here would be read
  // by every file that follows.
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/** Physical presence, probed the same way the write path probes it. */
async function tableExists(name: string): Promise<boolean> {
  try {
    await adapter?.executeQuery(`SELECT 1 FROM "${name}" LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

/** The command's own sequence, minus the parts that read from disk. */
async function runSync(config: LoadConfigResult["config"]): Promise<void> {
  process.env.DB_DIALECT = "sqlite";
  adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);

  const logger = createLogger({ quiet: true });
  const options = { cwd: dir, autoSync: true } as ResolvedDevOptions;
  const context = { logger, options: {}, cwd: dir } as CommandContext;
  // The real adapter is a DrizzleAdapter; `CLIDatabaseAdapter` declares only the
  // handful of methods the command signatures need, so the command file converts
  // between them exactly like this.
  const cli = adapter as unknown as CLIDatabaseAdapter;
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;

  // Without a resolver the ORM cannot address `dynamic_collections`, so the sync
  // fails before it reaches anything this test is about.
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  drizzleAdapter.setTableResolver(registry);
  await ensureCoreTables(cli, options, context);

  const configResult = { config } as LoadConfigResult;
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
  await ensureLocalizedCompanions(config, cli, context);
}

describe("db:sync creates localized companion tables in-process (integration)", () => {
  it("creates a localized collection's companion in the same run", async () => {
    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_posts",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    expect(await tableExists("dc_dbsync_posts")).toBe(true);
    // The assertion that fails without the fix: the push pipeline creates the
    // main table and nothing in this process creates the companion.
    expect(await tableExists("dc_dbsync_posts_locales")).toBe(true);
  });

  it("creates a localized single's companion, which needs singles synced first", async () => {
    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        singles: [
          defineSingle({
            slug: "dbsync_homepage",
            localized: true,
            fields: [text({ name: "headline", localized: true })],
          }),
        ],
      })
    );

    // Singles are force-prefixed with `single_` by `resolveSingleTableName`.
    // Asserting the main table too means a prefix change cannot make the companion
    // check vacuously pass against a name nothing ever creates.
    expect(await tableExists("single_dbsync_homepage")).toBe(true);
    expect(await tableExists("single_dbsync_homepage_locales")).toBe(true);
  });

  it("resolves a custom dbName the way the runtime does", async () => {
    // A collection's `dbName` is force-prefixed with `dc_` by the canonical
    // resolver, so `dbName: "dbsync_notes"` lives at `dc_dbsync_notes`. Taking
    // `dbName` verbatim instead builds `dbsync_notes_locales` with a foreign key to
    // a `dbsync_notes` table that does not exist — the create fails, the warning is
    // swallowed, and the entity is left marked localized with nowhere to put
    // translations.
    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_field_notes",
            dbName: "dbsync_notes",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    expect(await tableExists("dc_dbsync_notes")).toBe(true);
    expect(await tableExists("dc_dbsync_notes_locales")).toBe(true);
    expect(await tableExists("dbsync_notes_locales")).toBe(false);
  });

  it("leaves a non-localized collection with no companion", async () => {
    await runSync(
      defineConfig({
        collections: [
          defineCollection({
            slug: "dbsync_logs",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );

    expect(await tableExists("dc_dbsync_logs")).toBe(true);
    // Creating companions unconditionally would strand a dead table in every
    // project that does not use localization.
    expect(await tableExists("dc_dbsync_logs_locales")).toBe(false);
  });
});
