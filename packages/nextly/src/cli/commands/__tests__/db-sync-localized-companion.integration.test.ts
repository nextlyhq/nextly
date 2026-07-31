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
import {
  beginI18nTransition,
  forgetI18nTransition,
  readI18nTransitionState,
} from "../../../domains/i18n/migration/transition-state";
import { MetaService } from "../../../domains/meta/services/meta-service";
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
  // Mirrors `runDbSync`: the transition copy runs BEFORE the pushes, while an entity gaining
  // localization still has the translatable columns on its main table for the copy to read.
  await ensureLocalizedCompanions(config, cli, context, "beforeApply");
  await syncCollections(configResult, cli, options, context);
  await syncSingles(configResult, cli, options, context);
  await syncComponents(configResult, cli, options, context);
  await ensureLocalizedCompanions(config, cli, context);
}

/** The production store, so tests act on the same rows the runtime does. */
async function transitionStore(): Promise<
  Parameters<typeof readI18nTransitionState>[0]
> {
  const noop = () => {};
  const meta = new MetaService(adapter as unknown as DrizzleAdapter, {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  });
  return {
    getEntry: key => meta.getEntry(key),
    set: (key, v) => meta.set(key, v),
    delete: key => meta.delete(key),
  };
}

/**
 * The recorded transition for an entity, read through the production reader.
 *
 * Reading it any other way would let the test agree with a key layout the runtime
 * does not use.
 */
async function readTransition(
  kind: Parameters<typeof readI18nTransitionState>[1],
  slug: string
): Promise<Awaited<ReturnType<typeof readI18nTransitionState>>> {
  return readI18nTransitionState(await transitionStore(), kind, slug);
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

  it("records the language the content was written in when it creates the companion", async () => {
    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "de" },
        collections: [
          defineCollection({
            slug: "dbsync_marked",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    // Nothing on disk can say this afterwards: the main table's values were written
    // under whatever default was in force, and the default can change.
    // Settled, because the copy completed in the same run. What has to survive is the language:
    // it is the one in force at the transition, not whatever the default becomes later.
    await expect(
      readTransition("collection", "dbsync_marked")
    ).resolves.toEqual({
      status: "seeded",
      sourceLocale: "de",
    });
  });

  it("does not re-record a transition for a companion that already existed", async () => {
    // The hazard this closes: recording on every sync would attach the CURRENT
    // default to content written under an earlier one, and a confident wrong
    // language is worse than no record at all. The second run changes the default,
    // so a re-record would either overwrite `de` with `en` or be refused outright.
    const config = (defaultLocale: string) =>
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale },
        collections: [
          defineCollection({
            slug: "dbsync_once",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      });

    await runSync(config("de"));
    await runSync(config("en"));

    await expect(readTransition("collection", "dbsync_once")).resolves.toEqual({
      status: "seeded",
      sourceLocale: "de",
    });
  });

  it("copies content that predates localization into the companion", async () => {
    // The defect this closes: enabling localization in `nextly.config.ts` on an entity that
    // already has content used to CREATE an empty companion, after which every localized read
    // resolved through it and returned null over data still sitting on the main table. The admin
    // Builder path never had this problem — it has always seeded — so the same product hid content
    // or preserved it depending on which way you turned localization on.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_seeded",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    await runSync(unlocalized);

    // Content written while the entity was NOT localized, so it lives on the main table.
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_seeded" ("id", "slug", "title") VALUES ('row1', 'r1', 'Written before')`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_seeded",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    const rows = await adapter?.executeQuery<{
      _parent: string;
      title: string;
    }>(
      `SELECT "_parent", "title" FROM "dc_dbsync_seeded_locales" WHERE "_locale" = 'en'`
    );
    expect(rows).toEqual([{ _parent: "row1", title: "Written before" }]);
  });

  it("leaves the main table's columns in place when it seeds", async () => {
    // Unattended provisioning is additive-only. The Builder toggle drops the columns it copied
    // from, which is right for an explicit transition and wrong here: a dropped column is not
    // something the next boot can put back.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_kept",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_kept" ("id", "slug", "title") VALUES ('row1', 'r1', 'Still here')`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_kept",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_kept" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Still here" }]);
  });

  it("refuses to create the companion when the caller cannot name the language", async () => {
    // Boot-time provisioning has no localization config to draw a locale from. Creating the
    // companion there would win the race against the path that does know, and because reads
    // resolve through the companion once it exists, the existing content would be hidden by
    // whichever caller happened to be first. So a locale-less caller defers instead.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_noloc",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_noloc" ("id", "slug", "title") VALUES ('row1', 'r1', 'Content')`
    );

    const { ensureCompanionTable } = await import(
      "../../../domains/i18n/runtime/companion-io"
    );
    const reported: unknown[] = [];
    const created = await ensureCompanionTable(
      adapter as unknown as DrizzleAdapter,
      {
        slug: "dbsync_noloc",
        tableName: "dc_dbsync_noloc",
        fields: [{ name: "title", type: "text", localized: true }],
        dialect: "sqlite",
      },
      error => reported.push(error)
    );

    expect(created).toBe(false);
    expect(await tableExists("dc_dbsync_noloc_locales")).toBe(false);
    // Silence would leave an operator with an entity marked localized and no table, and no clue
    // why, so the refusal is reported rather than swallowed.
    expect(reported).toHaveLength(1);
  });

  it("finishes a copy an earlier run started and abandoned", async () => {
    // `CREATE TABLE` and the copy are separate statements, and MySQL commits DDL implicitly, so a
    // failure between them leaves a real companion holding none of the entity's content. Without a
    // resume every later run returns early because the table exists, and the content stays hidden
    // permanently — the marker is written before the DDL precisely so this is recoverable.
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_resume",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(
      defineConfig({
        collections: [
          defineCollection({
            slug: "dbsync_resume",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_resume" ("id", "slug", "title") VALUES ('row1', 'r1', 'Survives')`
    );
    await runSync(localized);

    // Reproduce the interrupted state faithfully: a run that created the companion and died before
    // finishing the copy leaves the table present, the rows absent, and the record still owed.
    await adapter?.executeQuery(`DELETE FROM "dc_dbsync_resume_locales"`);
    const store = await transitionStore();
    await forgetI18nTransition(store, "collection", "dbsync_resume");
    await beginI18nTransition(store, {
      kind: "collection",
      slug: "dbsync_resume",
      sourceLocale: "en",
    });
    expect(
      await adapter?.executeQuery(`SELECT * FROM "dc_dbsync_resume_locales"`)
    ).toEqual([]);

    await runSync(localized);

    const rows = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_resume_locales" WHERE "_locale" = 'en'`
    );
    expect(rows).toEqual([{ title: "Survives" }]);
  });

  it("forgets the transition when the entity is deleted", async () => {
    // The record lives in `nextly_meta`, not in any table the teardown drops, and it is keyed by
    // kind and slug — both of which a later entity can reuse. Left behind, it hands that entity a
    // predecessor's source locale and refuses its real one, after its companion has already been
    // created and seeded.
    const config = defineConfig({
      localization: { locales: ["de", "en"], defaultLocale: "de" },
      collections: [
        defineCollection({
          slug: "dbsync_deleted",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    await runSync(config);
    await expect(
      readTransition("collection", "dbsync_deleted")
    ).resolves.toMatchObject({ sourceLocale: "de" });

    const { teardownEntityI18n } = await import(
      "../../../domains/i18n/migration/teardown-entity-i18n"
    );
    await teardownEntityI18n({
      adapter: adapter as unknown as Parameters<
        typeof teardownEntityI18n
      >[0]["adapter"],
      slug: "dbsync_deleted",
      tableName: "dc_dbsync_deleted",
      kind: "collection",
    });

    await expect(
      readTransition("collection", "dbsync_deleted")
    ).resolves.toEqual({ status: "untracked" });
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
