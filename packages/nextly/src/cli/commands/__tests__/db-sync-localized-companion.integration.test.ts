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

/**
 * The pass `nextly migrate` runs: supervised, so absence of a record counts as a debt.
 *
 * Deliberately NOT the whole migrate command — that owns lock handling and file discovery, and
 * what this file is about is the companion work it delegates.
 */
async function runSupervisedRepair(
  config: LoadConfigResult["config"],
  { repairUntracked = false }: { repairUntracked?: boolean } = {}
): Promise<void> {
  const logger = createLogger({ quiet: true });
  const context = { logger, options: {}, cwd: dir } as CommandContext;
  await ensureLocalizedCompanions(
    config,
    adapter as unknown as CLIDatabaseAdapter,
    context,
    "afterApply",
    { supervised: true, repairUntracked }
  );
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
    insertIfAbsent: (key, v) => meta.insertIfAbsent(key, v),
    compareAndSet: (key, expected, next) =>
      meta.compareAndSet(key, expected, next),
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
    ).resolves.toMatchObject({
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

    await expect(
      readTransition("collection", "dbsync_once")
    ).resolves.toMatchObject({
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

  it("applies one edit that turns on localization and Draft/Published together", async () => {
    // The copy runs before the schema push, so `status: true` in the desired config does not mean
    // the main table has a `status` column yet. Reading it anyway made the seed fail after the
    // companion had already been created, and because every later run found that companion and
    // resumed into the same statement, this combination could never apply at all.
    await runSync(
      defineConfig({
        collections: [
          defineCollection({
            slug: "dbsync_bothon",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_bothon" ("id", "slug", "title") VALUES ('row1', 'r1', 'Both at once')`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_bothon",
            localized: true,
            status: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    const rows = await adapter?.executeQuery<{
      title: string;
      _status: string;
    }>(
      `SELECT "title", "_status" FROM "dc_dbsync_bothon_locales" WHERE "_locale" = 'en'`
    );
    // The companion still gets `_status` — it is created once and the runtime reconcile refuses to
    // add it later — and the row lands in the same state the main column's own default gives it.
    expect(rows).toEqual([{ title: "Both at once", _status: "draft" }]);
  });

  it("restores content from the companion when localization is turned off", async () => {
    // The round trip the enable fix left half-finished. Provisioning skipped every entity that was
    // not currently localized, so setting `localized: false` in configuration abandoned the
    // companion where all the content is and fell back to the main table's retained columns —
    // which hold whatever they held before the entity was localized, because every write since
    // went to the companion alone. The user's edits are on disk and invisible.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_offagain",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_offagain",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_offagain" ("id", "slug", "title") VALUES ('row1', 'r1', 'Before localizing')`
    );
    await runSync(localized);

    // An edit made while the entity was localized. It lands on the companion, which is what makes
    // the retained main column stale.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_offagain_locales" SET "title" = 'Edited in English' WHERE "_locale" = 'en'`
    );

    await runSync(unlocalized);

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_offagain" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Edited in English" }]);
    // Additive: `db:sync` persists registry metadata before its destructive prompt, so dropping
    // here would run even for an operator who then declined the change. The companion stays until
    // `nextly migrate` removes it under supervision.
    expect(await tableExists("dc_dbsync_offagain_locales")).toBe(true);
  });

  it("does not overwrite a main row that has no companion row in the default locale", async () => {
    // A correlated UPDATE with no guard assigns SQL NULL when the subquery finds nothing, so an
    // entry authored only in another language would have its main column blanked by the restore
    // instead of being left alone. There is nothing to restore for such a row.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_partial",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_partial",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_partial" ("id", "slug", "title") VALUES ('row1', 'r1', 'Kept')`
    );
    await runSync(localized);
    // Only a Spanish translation exists for this row; the English companion row is gone.
    await adapter?.executeQuery(
      `DELETE FROM "dc_dbsync_partial_locales" WHERE "_locale" = 'en'`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_partial_locales" ("_parent", "_locale", "title") VALUES ('row1', 'es', 'Guardado')`
    );

    await runSync(unlocalized);

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_partial" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Kept" }]);
  });

  it("re-seeds a companion that outlived a disable instead of trusting its rows", async () => {
    // The trap the additive restore creates if nothing records it. The companion is left standing,
    // so re-enabling localization finds a table full of default-locale rows and, under the resume's
    // usual `WHERE NOT EXISTS`, leaves every one of them alone. They are stale by definition: main
    // was authoritative for the whole period localization was off.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_roundtrip",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_roundtrip",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_roundtrip" ("id", "slug", "title") VALUES ('row1', 'r1', 'First')`
    );
    await runSync(localized);
    await runSync(unlocalized);

    // Edited with localization off, so it lands on the main table and the companion goes stale.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_roundtrip" SET "title" = 'Edited while off' WHERE "id" = 'row1'`
    );
    await expect(
      readTransition("collection", "dbsync_roundtrip")
    ).resolves.toMatchObject({ status: "restored", sourceLocale: "en" });

    await runSync(localized);

    const rows = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_roundtrip_locales" WHERE "_locale" = 'en'`
    );
    expect(rows).toEqual([{ title: "Edited while off" }]);
  });

  it("labels a re-enabled entity with the default locale in force now", async () => {
    // The trap in reusing the restore marker's locale. Localization goes off, the app changes its
    // default while it is off, and localization comes back on. Main has been authoritative the
    // whole time and carries no language of its own, so enabling declares its content to be in
    // TODAY's default — exactly as a first enable does. Labelling the rows with the locale the
    // restore recorded writes them under a code reads no longer look for, and may not even be a
    // configured locale any more, so every edit made while localization was off disappears.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_relocale",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localizedIn = (defaultLocale: string) =>
      defineConfig({
        localization: { locales: ["en", "de"], defaultLocale },
        collections: [
          defineCollection({
            slug: "dbsync_relocale",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_relocale" ("id", "slug", "title") VALUES ('row1', 'r1', 'First')`
    );
    await runSync(localizedIn("en"));
    await runSync(unlocalized);
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_relocale" SET "title" = 'Edited while off' WHERE "id" = 'row1'`
    );

    // The app's default locale moves while localization is off.
    await runSync(localizedIn("de"));

    const rows = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_relocale_locales" WHERE "_locale" = 'de'`
    );
    expect(rows).toEqual([{ title: "Edited while off" }]);
    // And the record now describes the transition that just happened, not the one before it.
    await expect(
      readTransition("collection", "dbsync_relocale")
    ).resolves.toMatchObject({ status: "seeded", sourceLocale: "de" });
  });

  it("repairs an install whose companion predates transition records", async () => {
    // What `nextly migrate --repair-localization` exists for. These have a companion, no marker,
    // and no way to tell whether their content was ever copied across — the one fact that cannot
    // be re-derived is the language, which running the repair supplies from the configured
    // default. Nothing infers that debt: an entity localized since birth is untracked too and
    // owes nothing, and no physical shape separates the two.
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_legacy",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(
      defineConfig({
        collections: [
          defineCollection({
            slug: "dbsync_legacy",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_legacy" ("id", "slug", "title") VALUES ('row1', 'r1', 'Predates the record')`
    );
    await runSync(localized);

    // Reproduce the legacy shape: a real companion holding nothing, and no record of why it
    // exists — which is every install that transitioned before this was written.
    await adapter?.executeQuery(`DELETE FROM "dc_dbsync_legacy_locales"`);
    await forgetI18nTransition(
      await transitionStore(),
      "collection",
      "dbsync_legacy"
    );

    // An ordinary sync leaves it alone: absence is not a debt without supervision.
    await runSync(localized);
    expect(
      await adapter?.executeQuery(`SELECT * FROM "dc_dbsync_legacy_locales"`)
    ).toEqual([]);

    // The operator asks for it, which is how the missing fact — that main holds content in the
    // configured default locale — gets supplied.
    await runSupervisedRepair(localized, { repairUntracked: true });

    const rows = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_legacy_locales" WHERE "_locale" = 'en'`
    );
    expect(rows).toEqual([{ title: "Predates the record" }]);
    // Settled, not left owing. A repair that copies and then cannot record that it did would fail
    // the command and repeat identically on every retry.
    await expect(
      readTransition("collection", "dbsync_legacy")
    ).resolves.toMatchObject({ status: "seeded", sourceLocale: "en" });
  });

  it("does not repair an untracked companion unless asked to", async () => {
    // The absence of a record does not distinguish an install that transitioned before transitions
    // were recorded from an entity localized since birth — and nothing on disk does either: the
    // push leaves the translatable columns on main in both cases. That is the same conclusion this
    // whole mechanism rests on, so the repair is opt-in rather than inferred.
    //
    // Inferring it manufactures a default-locale translation for every entry, including ones
    // deliberately authored in another language only, and records a transition that never
    // happened. Draft/Published is what makes it fire even with nothing to copy, because a
    // readable `status` on main is enough to make the plan non-empty.
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_frombirth",
          localized: true,
          status: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    await runSync(localized);

    // A legacy install: the companion predates transition records, so there is no marker — which
    // is the only thing the repair has to go on. A modern from-birth entity is recorded when its
    // companion is created, so this state is reached by forgetting it.
    await forgetI18nTransition(
      await transitionStore(),
      "collection",
      "dbsync_frombirth"
    );

    // An entry that exists only in Spanish, which is exactly what a spurious repair would
    // manufacture an English row for.
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_frombirth" ("id", "slug", "status") VALUES ('row1', 'r1', 'published')`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_frombirth_locales" ("_parent", "_locale", "_status", "title") VALUES ('row1', 'es', 'published', 'Solo español')`
    );

    // An ordinary `nextly migrate` provisions companions but asks no questions about content.
    await runSupervisedRepair(localized);

    const rows = await adapter?.executeQuery<{ _locale: string }>(
      `SELECT "_locale" FROM "dc_dbsync_frombirth_locales" ORDER BY "_locale"`
    );
    expect(rows).toEqual([{ _locale: "es" }]);
    // And nothing is recorded about a transition nobody has claimed happened.
    await expect(
      readTransition("collection", "dbsync_frombirth")
    ).resolves.toEqual({ status: "untracked" });
  });

  it("restores a companion that has no transition record when localization is turned off", async () => {
    // The mirror of the test above, and it resolves the opposite way — deliberately.
    //
    // On the ENABLE side, absence of a record is genuinely ambiguous: it can mean a legacy
    // transition or a from-birth entity, and only the first owes a copy. On the DISABLE side the
    // ambiguity does not matter. Both kinds have their content in the companion, because every
    // write since went there, so both owe the copy back. What separates them from an entity that
    // was never localized is that the never-localized one has no companion at all.
    //
    // Returning early on `untracked` therefore stranded exactly the installs that predate
    // transition records: the push recreates the main-table columns, reads switch back to them,
    // and the content sits in a table nothing reads any more.
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_legacyoff",
          localized: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(localized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_legacyoff" ("id", "slug") VALUES ('row1', 'r1')`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_legacyoff_locales" ("_parent", "_locale", "title") VALUES ('row1', 'en', 'Written while localized')`
    );

    // A legacy install: the companion predates transition records, so there is no marker.
    await forgetI18nTransition(
      await transitionStore(),
      "collection",
      "dbsync_legacyoff"
    );

    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_legacyoff",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_legacyoff" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Written while localized" }]);
    // And the transition it established is recorded as finished, so nothing repeats the copy over
    // edits main is authoritative for from now on.
    await expect(
      readTransition("collection", "dbsync_legacyoff")
    ).resolves.toMatchObject({ status: "restored", sourceLocale: "en" });
  });

  it("carries a status changed while localization was off back onto the companion", async () => {
    // Publishing state moves while localization is off too, and the companion row that survives
    // the disable keeps whatever `_status` it held when it was last the authority. The guarded
    // insert cannot correct it, because the row it would fix already exists — so a page published
    // in the meantime stays hidden from locale-aware published reads.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_restatus",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localized = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_restatus",
          localized: true,
          status: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_restatus" ("id", "slug", "title", "status") VALUES ('row1', 'r1', 'First', 'draft')`
    );
    await runSync(localized);
    await runSync(unlocalized);

    // Published while localization was off, so main is authoritative about it.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_restatus" SET "status" = 'published' WHERE "id" = 'row1'`
    );

    await runSync(localized);

    const rows = await adapter?.executeQuery<{ _status: string }>(
      `SELECT "_status" FROM "dc_dbsync_restatus_locales" WHERE "_locale" = 'en'`
    );
    expect(rows).toEqual([{ _status: "published" }]);
  });

  it("leaves an explicitly shared field alone when every other field localizes by default", async () => {
    // The per-field flag is only half the story: a text field with no flag at all localizes,
    // because that is the default for its type. So the fields that still belong to the companion
    // need not carry `localized: true` — and reading the flag literally finds nothing claimed,
    // falls back to treating every field as restorable, and copies the abandoned companion value
    // straight over the shared field's current one.
    const localizedBoth = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_smartshared",
          localized: true,
          // Neither carries a flag, so both localize by the text default.
          fields: [text({ name: "title" }), text({ name: "sku" })],
        }),
      ],
    });
    // `sku` becomes shared. Nothing else gains a flag, so nothing is explicitly claimed.
    const skuShared = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_smartshared",
          localized: true,
          fields: [
            text({ name: "title" }),
            text({ name: "sku", localized: false }),
          ],
        }),
      ],
    });

    await runSync(localizedBoth);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_smartshared" ("id", "slug") VALUES ('row1', 'r1')`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_smartshared_locales" ("_parent", "_locale", "title", "sku") VALUES ('row1', 'en', 'Widget', 'OLD-SKU')`
    );

    await runSync(skuShared);
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_smartshared" SET "sku" = 'NEW-SKU' WHERE "id" = 'row1'`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_smartshared",
            fields: [
              text({ name: "title" }),
              text({ name: "sku", localized: false }),
            ],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ title: string; sku: string }>(
      `SELECT "title", "sku" FROM "dc_dbsync_smartshared" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Widget", sku: "NEW-SKU" }]);
  });

  it("restores the publishing state of the locale it restores content from", async () => {
    // Publishing is per locale while an entity is localized: a publish under a locale that is not
    // the default updates that companion row and deliberately leaves main's `status` alone. If
    // the default has since moved away from the locale an entry was actually authored in, the
    // restore falls back to that locale for its content — and bringing the content across without
    // the state it was published under either makes a draft public or makes live content vanish.
    const localizedInDe = defineConfig({
      localization: { locales: ["de", "en"], defaultLocale: "de" },
      collections: [
        defineCollection({
          slug: "dbsync_locstatus",
          localized: true,
          status: true,
          fields: [text({ name: "title", localized: true })],
        }),
      ],
    });
    // Localization off, and the default has moved to a locale this entry was never authored in.
    const disabledInEn = defineConfig({
      localization: { locales: ["de", "en"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_locstatus",
          status: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await runSync(
      defineConfig({
        collections: [
          defineCollection({
            slug: "dbsync_locstatus",
            status: true,
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_locstatus" ("id", "slug", "title", "status") VALUES ('row1', 'r1', 'Entwurf', 'draft')`
    );
    // Localized with `de` as the default, so the content and its draft state land on the `de`
    // companion row.
    await runSync(localizedInDe);
    // Published in `de`, which is where this entry actually lives.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_locstatus_locales" SET "_status" = 'published' WHERE "_locale" = 'de'`
    );

    // The default moves to a locale this entry has no translation in, and localization is then
    // turned off — so the restore falls back to `de` for the content.
    await runSync(disabledInEn);

    const main = await adapter?.executeQuery<{
      title: string;
      status: string;
    }>(
      `SELECT "title", "status" FROM "dc_dbsync_locstatus" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Entwurf", status: "published" }]);
  });

  it("restores from the recorded locale when the configured default has no translation", async () => {
    // The restore is guarded on a matching companion row, so preferring the configured default
    // unconditionally copies nothing for an entity only ever authored under the locale the
    // transition recorded — while the record still marks the transition finished. `restored` is
    // terminal, so no later pass retries and the content stays in a companion nothing reads.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_otherloc",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const localizedIn = (defaultLocale: string) =>
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale },
        collections: [
          defineCollection({
            slug: "dbsync_otherloc",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_otherloc" ("id", "slug", "title") VALUES ('row1', 'r1', 'Vor der Übersetzung')`
    );
    await runSync(localizedIn("de"));
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_otherloc_locales" SET "title" = 'Auf Deutsch' WHERE "_locale" = 'de'`
    );

    // The app's default moves to a locale this entity has no translation in, and localization is
    // then turned off.
    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_otherloc",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_otherloc" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Auf Deutsch" }]);
  });

  it("leaves a field that was made shared before the entity was disabled", async () => {
    // Reconciliation is additive, so a field turned `localized: false` while its entity stays
    // localized keeps its companion column while writes correctly go to the main one. A later
    // entity-level disable must not copy that abandoned value back over the current one.
    const localizedBoth = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_shared",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "sku", localized: true }),
          ],
        }),
      ],
    });
    // `sku` becomes shared; the entity stays localized. Spelled out rather than left to the
    // per-type default, which for a text field is to localize — dropping the flag would leave it
    // localized, not share it.
    const skuShared = defineConfig({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "dbsync_shared",
          localized: true,
          fields: [
            text({ name: "title", localized: true }),
            text({ name: "sku", localized: false }),
          ],
        }),
      ],
    });

    await runSync(localizedBoth);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_shared" ("id", "slug") VALUES ('row1', 'r1')`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_shared_locales" ("_parent", "_locale", "title", "sku") VALUES ('row1', 'en', 'Widget', 'OLD-SKU')`
    );

    await runSync(skuShared);
    // The current value, written to main now that the field is shared.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_shared" SET "sku" = 'NEW-SKU' WHERE "id" = 'row1'`
    );

    // Now the whole entity is disabled, with the per-field flags left as they are — which is what
    // says which columns the companion still owns. A field that was made shared earlier no longer
    // claims to be localized, so it is not restored from.
    await runSync(
      defineConfig({
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_shared",
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "sku", localized: false }),
            ],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ title: string; sku: string }>(
      `SELECT "title", "sku" FROM "dc_dbsync_shared" WHERE "id" = 'row1'`
    );
    // `title` comes back from the companion; `sku` keeps the value main already had.
    expect(main).toEqual([{ title: "Widget", sku: "NEW-SKU" }]);
  });

  it("restores each entry from whichever locale it actually has", async () => {
    // The default can move while an entity is localized, so a corpus ends up mixed: some entries
    // authored under the new code, some only under the one the transition recorded. One
    // entity-wide choice restores whichever group matches and leaves the rest holding
    // pre-localization values — while the record marks the transition terminally finished.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_mixedloc",
          fields: [text({ name: "title" })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_mixedloc" ("id", "slug", "title") VALUES ('old', 'o', 'Stale old'), ('new', 'n', 'Stale new')`
    );
    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "de" },
        collections: [
          defineCollection({
            slug: "dbsync_mixedloc",
            localized: true,
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    );

    // One entry translated under the recorded locale only, the other under the new default.
    await adapter?.executeQuery(
      `UPDATE "dc_dbsync_mixedloc_locales" SET "title" = 'Nur Deutsch' WHERE "_parent" = 'old'`
    );
    await adapter?.executeQuery(
      `DELETE FROM "dc_dbsync_mixedloc_locales" WHERE "_parent" = 'new'`
    );
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_mixedloc_locales" ("_parent", "_locale", "title") VALUES ('new', 'en', 'English only')`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_mixedloc",
            fields: [text({ name: "title" })],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{ id: string; title: string }>(
      `SELECT "id", "title" FROM "dc_dbsync_mixedloc" ORDER BY "id"`
    );
    expect(main).toEqual([
      { id: "new", title: "English only" },
      { id: "old", title: "Nur Deutsch" },
    ]);
  });

  it("restores every field of an entry from one companion row", async () => {
    // A parent that has rows in BOTH candidate locales, with one field left untranslated in the
    // preferred one. Asking each column for its own first non-null value across the candidates
    // would take that field from the other language and its neighbours from the preferred row —
    // a mixed-language document written to the table that is authoritative from then on, with the
    // record marking the restore terminally finished.
    const unlocalized = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_onerow",
          fields: [text({ name: "title" }), text({ name: "summary" })],
        }),
      ],
    });

    await runSync(unlocalized);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_onerow" ("id", "slug", "title", "summary") VALUES ('row1', 'r1', 'Vor', 'Zusammenfassung')`
    );
    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "de" },
        collections: [
          defineCollection({
            slug: "dbsync_onerow",
            localized: true,
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "summary", localized: true }),
            ],
          }),
        ],
      })
    );

    // The English translation exists but its summary was never written. English becomes the
    // default, so it is the preferred candidate and German is the fallback.
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_onerow_locales" ("_parent", "_locale", "title", "summary") VALUES ('row1', 'en', 'English title', NULL)`
    );

    await runSync(
      defineConfig({
        localization: { locales: ["de", "en"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "dbsync_onerow",
            fields: [text({ name: "title" }), text({ name: "summary" })],
          }),
        ],
      })
    );

    const main = await adapter?.executeQuery<{
      title: string;
      summary: string | null;
    }>(`SELECT "title", "summary" FROM "dc_dbsync_onerow" WHERE "id" = 'row1'`);
    // Both from the English row. Its untranslated summary comes back as null, which is what that
    // row actually says — not the German summary sitting beside it.
    expect(main).toEqual([{ title: "English title", summary: null }]);
  });

  it("leaves an entity that was never localized alone", async () => {
    // The restore is gated on the durable record, not on physical shape, so a collection that
    // never had a companion is not probed for one and nothing is written on its behalf.
    const config = defineConfig({
      collections: [
        defineCollection({
          slug: "dbsync_neverloc",
          fields: [text({ name: "title" })],
        }),
      ],
    });
    await runSync(config);
    await adapter?.executeQuery(
      `INSERT INTO "dc_dbsync_neverloc" ("id", "slug", "title") VALUES ('row1', 'r1', 'Untouched')`
    );
    await runSync(config);

    const main = await adapter?.executeQuery<{ title: string }>(
      `SELECT "title" FROM "dc_dbsync_neverloc" WHERE "id" = 'row1'`
    );
    expect(main).toEqual([{ title: "Untouched" }]);
    await expect(
      readTransition("collection", "dbsync_neverloc")
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
