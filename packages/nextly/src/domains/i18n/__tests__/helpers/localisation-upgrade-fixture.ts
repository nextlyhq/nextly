/**
 * A database laid out as an installation from before per-language storage keeps it, for the
 * upgrade's tests: booted once as that installation (the test-only `setPerLanguageStorage(false)`), filled
 * through the services it wrote with, and booted again after the upgrade as every installation now
 * runs (per-language storage on).
 *
 * The states are written as the earlier release wrote them: through its own services, so each row
 * has the shape that release gave it. A state no service writes any longer (a language live under a
 * main row in draft) is set on the rows the services wrote, by column, and named where it is.
 *
 * One database for both boots: a throwaway one on PostgreSQL and MySQL, and one in-memory SQLite
 * connection, which the second boot takes over as the first left it.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";
import { vi } from "vitest";

import {
  previewDataSteps,
  runDataSteps,
  type DataStepsDeps,
} from "../../../../cli/commands/data-steps";
import type {
  UpgradeSite,
  UpgradeStep,
} from "../../../../cli/commands/upgrade-step";
import { MIGRATE_DATA_STEPS } from "../../../../cli/commands/upgrade-steps";
import type { DryRunPlan } from "../../../../cli/dry-run";
import {
  defineCollection,
  defineSingle,
  text,
  textarea,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../../database/test-database-ddl";
import { clearServices } from "../../../../di/register";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { _resetEnvCache } from "../../../../shared/lib/env";
import type { Logger } from "../../../../services/shared";
import type { SingleEntryService } from "../../../singles/services/single-entry-service";
import { VERSIONS_TABLE } from "../../../../schemas/versions/types";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../../versions/versions-repository";
import { workingDraftKey } from "../../../versions/working-draft-key";
import {
  _resetPerLanguageStorage,
  setPerLanguageStorage,
} from "../../per-language-storage";

/** The languages of the site, its default first. */
export const LANGUAGES = ["en", "es", "fr"] as const;

/** A translated collection, with a translatable field and a shared one. */
export const ARTICLES = "articles";
/** A collection that is not translated: under per-language storage its text moves per language. */
export const NOTES = "notes";
/** A translated Single. */
export const BANNER = "banner";
/** A Single that is not translated. */
export const FOOTER = "footer";

const COLLECTIONS = [
  defineCollection({
    slug: ARTICLES,
    localized: true,
    status: true,
    versions: { drafts: true },
    fields: [
      text({ name: "title" }),
      textarea({ name: "summary" }),
      text({ name: "code", localized: false }),
    ],
  }),
  defineCollection({
    slug: NOTES,
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "title" }), text({ name: "code", localized: false })],
  }),
];

const SINGLES = [
  defineSingle({
    slug: BANNER,
    localized: true,
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "title" }), text({ name: "code", localized: false })],
  }),
  defineSingle({
    slug: FOOTER,
    status: true,
    versions: { drafts: true },
    fields: [text({ name: "title" }), text({ name: "code", localized: false })],
  }),
];

/** The site's configuration, as both boots and the upgrade read it. */
export const SITE = {
  collections: COLLECTIONS,
  singles: SINGLES,
  localization: { locales: [...LANGUAGES], defaultLocale: "en" },
} as const;

/** A site as the fixture boots it: its entities and its languages. */
export interface FixtureSite {
  collections: typeof COLLECTIONS;
  singles: typeof SINGLES;
  localization: { locales: readonly string[]; defaultLocale: string };
}

/** The fixture's site with other languages: an installation from before codes were checked. */
export function siteWithLanguages(
  locales: readonly string[],
  defaultLocale: string
): FixtureSite {
  return { ...SITE, localization: { locales, defaultLocale } };
}

/**
 * Run `nextly migrate`'s data steps over `adapter` for `site`, as the command runs them once its
 * migrations have applied, a backup confirmed: by default every step, or only `steps`.
 */
export async function migrateData(
  adapter: unknown,
  site: UpgradeSite,
  steps: readonly UpgradeStep[] = MIGRATE_DATA_STEPS
): Promise<void> {
  await runDataSteps({
    adapter: adapter as DataStepsDeps["adapter"],
    command: "nextly migrate",
    steps,
    backupConfirmed: true,
    interactive: false,
    log: () => undefined,
    warn: () => undefined,
    site,
  });
}

/** What `nextly migrate --dry-run` says of its data steps over `adapter` for `site`. */
export function previewMigrateData(
  adapter: unknown,
  site: UpgradeSite
): Promise<DryRunPlan> {
  return previewDataSteps({
    adapter: adapter as DataStepsDeps["adapter"],
    command: "nextly migrate",
    steps: MIGRATE_DATA_STEPS,
    backupConfirmed: true,
    interactive: false,
    log: () => undefined,
    warn: () => undefined,
    site,
  });
}

/** The database both boots of a case connect to. */
export interface UpgradeDatabase {
  dialect: TestDialect;
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** A throwaway database on a server dialect, or one in-memory SQLite connection. */
export async function openUpgradeDatabase(
  dialect: TestDialect
): Promise<UpgradeDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { dialect, adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_lu_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    dialect,
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/**
 * Boot the site on `database`: as an installation from before the upgrade (`legacy`), with
 * per-language storage off, or as every installation runs once upgraded.
 */
export async function bootSite(
  database: UpgradeDatabase,
  layout: "legacy" | "upgraded",
  site: FixtureSite = SITE,
  /** Where the start's log goes, for a test that reads what it warned. */
  logger?: Logger
): Promise<TestNextly> {
  clearServices();
  _resetPerLanguageStorage();
  // An earlier release's layout is a test's to stand in for: nothing a site configures selects it.
  if (layout === "legacy") setPerLanguageStorage(false);
  return createTestNextly({
    adapter: database.adapter as never,
    collections: [...site.collections],
    singles: [...site.singles],
    localization: {
      locales: [...site.localization.locales],
      defaultLocale: site.localization.defaultLocale,
    },
    ...(logger === undefined ? {} : { logger }),
  });
}

const entriesOf = (t: TestNextly) =>
  (t.getService("collectionsHandler") as CollectionsHandler).getEntryService();
const singlesOf = (t: TestNextly) =>
  t.getService("singleEntryService") as SingleEntryService;

/** Each seeded document, by the state it was seeded in. */
export interface SeededStates {
  /** Entries of `articles` by name. */
  articles: Record<ArticleState, string>;
  /** Entries of `notes` by name. */
  notes: Record<NoteState, string>;
}

/**
 * The states of a translated entry the fixture holds, each named for its main row and Spanish:
 * - `live-both`: both published;
 * - `live-es-draft`: main published, Spanish's row in draft;
 * - `live-no-es`: main published, no Spanish row;
 * - `draft-main-live-es`: main in draft under a published Spanish row (set by column);
 * - `draft-both`: both in draft;
 * - `split`: both live, then a pending change in Spanish and a later one in French, each holding
 *   the whole document and each changing the shared `code` differently (E5's conflict);
 * - `stale-copy`: both live, then a pending change in Spanish whose shared values equal live.
 */
export type ArticleState =
  | "live-both"
  | "live-es-draft"
  | "live-no-es"
  | "draft-main-live-es"
  | "draft-both"
  | "split"
  | "stale-copy";

/**
 * The states of an entry that is not translated:
 * - `live`: published;
 * - `pending`: published, then a pending change to its text and its shared `code`.
 */
export type NoteState = "live" | "pending";

/** A Single's and a collection entry's Spanish save, as each service takes it. */
type Values = Record<string, unknown>;

/**
 * Fill the legacy site `t` with every state the fixture holds, each through the service that wrote
 * it before the upgrade. Later saves are dated later (`laterThan`), so which of two pending changes
 * is the later is never decided by a clock that did not move.
 */
export async function seedLegacyStates(
  t: TestNextly,
  database: UpgradeDatabase
): Promise<SeededStates> {
  const entries = entriesOf(t);
  const create = async (values: Values): Promise<string> => {
    const created = await entries.createEntry(
      { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
      values
    );
    return (created.data as { id: string }).id;
  };
  const save = (id: string, locale: string, values: Values) =>
    entries.updateEntry(
      { collectionName: ARTICLES, entryId: id, locale, overrideAccess: true },
      { ...values, _overwrite: true }
    );

  const article = async (
    name: string,
    main: "published" | "draft",
    spanish: "published" | "draft" | "none"
  ): Promise<string> => {
    const id = await create({
      title: `${name} en`,
      summary: `${name} summary en`,
      code: `${name}-code`,
      status: main,
    });
    if (spanish !== "none") {
      await save(id, "es", { title: `${name} es`, status: spanish });
    }
    return id;
  };

  const articles = {
    "live-both": await article("live-both", "published", "published"),
    "live-es-draft": await article("live-es-draft", "published", "draft"),
    "live-no-es": await article("live-no-es", "published", "none"),
    "draft-main-live-es": await article("draft-main-live-es", "draft", "draft"),
    "draft-both": await article("draft-both", "draft", "draft"),
    split: await article("split", "published", "published"),
    "stale-copy": await article("stale-copy", "published", "published"),
  } satisfies Record<ArticleState, string>;

  // A Spanish row live under a main row in draft: no save writes this any longer, so it is set on
  // the row the save wrote.
  await writeRows(
    database,
    sql`UPDATE ${sql.identifier("dc_articles_locales")} SET ${sql.identifier("_status")} = ${"published"} WHERE ${sql.identifier("_parent")} = ${articles["draft-main-live-es"]} AND ${sql.identifier("_locale")} = ${"es"}`
  );

  // E5's conflict: French live too, then a pending change in Spanish and a later one in French,
  // each changing the shared `code` its own way.
  await save(articles.split, "fr", { title: "split fr", status: "published" });
  await save(articles.split, "es", { title: "split es 2", code: "from-es" });
  await save(articles.split, "fr", { title: "split fr 2", code: "from-fr" });
  await laterThan(database, articles.split, "fr", "es");

  // A pending change that carries the live shared values unchanged: a copy, not an edit.
  await save(articles["stale-copy"], "es", { title: "stale-copy es 2" });

  const notes = await seedNotes(t);
  await seedSingles(t);
  return { articles, notes };
}

/** The entries of the collection that is not translated. */
async function seedNotes(t: TestNextly): Promise<Record<NoteState, string>> {
  const entries = entriesOf(t);
  const note = async (name: string): Promise<string> => {
    const created = await entries.createEntry(
      { collectionName: NOTES, overrideAccess: true },
      { title: `${name} title`, code: `${name}-code`, status: "published" }
    );
    return (created.data as { id: string }).id;
  };
  const live = await note("live");
  const pending = await note("pending");
  await entries.updateEntry(
    { collectionName: NOTES, entryId: pending, overrideAccess: true },
    { title: "pending title 2", code: "pending-code-2", _overwrite: true }
  );
  return { live, pending };
}

/** The translated Single live in English with Spanish in draft, and the other Single live. */
async function seedSingles(t: TestNextly): Promise<void> {
  const singles = singlesOf(t);
  await singles.update(
    BANNER,
    {
      title: "banner en",
      code: "banner-code",
      status: "published",
      _overwrite: true,
    },
    { locale: "en", overrideAccess: true }
  );
  await singles.update(
    BANNER,
    { title: "banner es", status: "draft", _overwrite: true },
    { locale: "es", overrideAccess: true }
  );
  await singles.update(
    FOOTER,
    {
      title: "footer title",
      code: "footer-code",
      status: "published",
      _overwrite: true,
    },
    { overrideAccess: true }
  );
}

/**
 * Date `later`'s pending change of the entry `entryId` a minute after `earlier`'s, so the later
 * save is the later by its stored time and not by the order two writes in one millisecond landed.
 */
async function laterThan(
  database: UpgradeDatabase,
  entryId: string,
  later: string,
  earlier: string
): Promise<void> {
  const draftIn = (locale: string) => ({
    and: [
      { column: "entryId", op: "=" as const, value: entryId },
      { column: "locale", op: "=" as const, value: locale },
      ...WORKING_DRAFT_SHAPE,
    ],
  });
  const [row] = await database.adapter.select<VersionRow>(VERSIONS_TABLE, {
    where: draftIn(earlier),
    limit: 1,
  });
  if (!row) throw new Error(`no pending change in ${earlier}`);
  await database.adapter.update(
    VERSIONS_TABLE,
    { updatedAt: new Date(new Date(row.updatedAt).getTime() + 60_000) },
    draftIn(later)
  );
}

/**
 * Run a statement that writes and returns no rows: better-sqlite3 runs one with `run`, and refuses
 * it through `all`, which reads; the server drivers run either through `execute`.
 */
async function writeRows(
  database: UpgradeDatabase,
  statement: SQL
): Promise<void> {
  if (database.dialect === "sqlite") {
    await database.adapter
      .getDrizzle<{ run(query: SQL): unknown }>()
      .run(statement);
    return;
  }
  await database.adapter
    .getDrizzle<{ execute(query: SQL): Promise<unknown> }>()
    .execute(statement);
}

/**
 * Store every row written under `standard` under `old` instead, as a release from before codes
 * were checked stored them: each translation table's rows, each version's language, and each
 * pending change's key, computed from the old code as that release computed it. This release
 * writes every row under the standard code, so no service writes this state any longer.
 */
export async function storeUnderCode(
  database: UpgradeDatabase,
  standard: string,
  old: string
): Promise<void> {
  for (const table of [
    "dc_articles_locales",
    "dc_notes_locales",
    "single_banner_locales",
    "single_footer_locales",
  ]) {
    if (!(await database.adapter.tableExists(table))) continue;
    await writeRows(
      database,
      sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier("_locale")} = ${old} WHERE ${sql.identifier("_locale")} = ${standard}`
    );
  }
  const versions = await database.adapter.select<
    VersionRow & { draftKey: string | null }
  >(VERSIONS_TABLE, {
    where: { and: [{ column: "locale", op: "=", value: standard }] },
  });
  for (const row of versions) {
    const ref = {
      scopeKind: row.scopeKind,
      scopeSlug: row.scopeSlug,
      entryId: row.entryId,
    };
    await database.adapter.update(
      VERSIONS_TABLE,
      {
        locale: old,
        ...(row.draftKey === null
          ? {}
          : { draftKey: workingDraftKey(ref, old) }),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
  // The languages each version records it changed, under the older code too.
  const changed = await database.adapter.select<{
    id: string;
    changedLocales: unknown;
  }>(VERSIONS_TABLE, {
    columns: ["id", "changedLocales"],
    where: { and: [{ column: "changedLocales", op: "IS NOT NULL" }] },
  });
  for (const row of changed) {
    const list: unknown =
      typeof row.changedLocales === "string"
        ? JSON.parse(row.changedLocales)
        : row.changedLocales;
    if (!Array.isArray(list) || !list.includes(standard)) continue;
    await database.adapter.update(
      VERSIONS_TABLE,
      {
        changedLocales: JSON.stringify(
          list.map(code => (code === standard ? old : code))
        ),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/** What a reader sees of one document in one language: its values, or nothing. */
export type Seen = Values | "not found";

/** The fields a read is compared on: what the fixture wrote. */
const COMPARED = ["title", "summary", "code"] as const;

function compared(document: Values | null | undefined): Seen {
  if (!document) return "not found";
  return Object.fromEntries(
    COMPARED.filter(name => name in document).map(name => [
      name,
      document[name],
    ])
  );
}

/**
 * What a reader and what an editor see of every seeded document in every language: the published
 * read (`status: "published"`) and the pending read (`draft: true`), as the Direct API answers.
 */
export async function whatEachReaderSees(
  t: TestNextly,
  seeded: SeededStates
): Promise<Record<string, Seen>> {
  const seen: Record<string, Seen> = {};
  const read = async (key: string, reading: () => Promise<unknown>) => {
    try {
      seen[key] = compared((await reading()) as Values | null);
    } catch {
      seen[key] = "not found";
    }
  };
  for (const locale of LANGUAGES) {
    for (const [name, id] of Object.entries(seeded.articles)) {
      await read(`${ARTICLES}/${name}/${locale}/published`, () =>
        t.nextly.findByID({
          collection: ARTICLES,
          id,
          locale,
          status: "published",
        })
      );
      await read(`${ARTICLES}/${name}/${locale}/pending`, () =>
        t.nextly.findByID({
          collection: ARTICLES,
          id,
          locale,
          draft: true,
          status: "all",
        })
      );
    }
    for (const [name, id] of Object.entries(seeded.notes)) {
      await read(`${NOTES}/${name}/${locale}/published`, () =>
        t.nextly.findByID({
          collection: NOTES,
          id,
          locale,
          status: "published",
        })
      );
    }
    for (const slug of [BANNER, FOOTER]) {
      await read(`${slug}/${locale}/published`, () =>
        t.nextly.findSingle({ slug, locale, status: "published" })
      );
    }
  }
  return seen;
}
