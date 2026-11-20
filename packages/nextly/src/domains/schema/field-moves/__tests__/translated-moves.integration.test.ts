/**
 * A field kept for each language, moved by the Schema Builder into or out of a group that also
 * keeps its structure for each language, keeps every language's value: the save writes the copy
 * into its migration file with the language table's own column added or dropped around it, and a
 * second database replaying the files with `nextly migrate` holds what the first held. Proved on a
 * translated collection and a translated Single, on every configured dialect, with different
 * values in two languages.
 *
 * Where a group keeps one structure for every language, its values are kept once, for every
 * language: a field kept for each language cannot move into or out of it without losing languages,
 * so that move is refused until such a group keeps each language's text inside it. A field kept
 * once moves into such a group as in an untranslated collection, and the fields kept for each
 * language beside it keep their values.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import {
  downDatabaseDeps,
  migrateDownCore,
} from "../../../../cli/commands/migrate-down";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { resolveDataLossConsent } from "../../migrate/data-loss-consent";
import { marksNoTransaction } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { withMigrateLock } from "../../pipeline/locks";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const POSTS = "tmv_posts";
const TABLE = "dc_tmv_posts";
const COMPANION = `${TABLE}_locales`;
const PAGE = "tmv_page";

type Field = Record<string, unknown>;
type Move = { from: string[]; to: string[] };

/** Kept for each language: text is translated by default in a translated entity. */
const SUBTITLE: Field = { name: "subtitle", type: "text" };
/** Kept once, for every language. */
const CODE: Field = { name: "code", type: "text", localized: false };
const NOTE: Field = { name: "note", type: "text" };
const LABEL: Field = { name: "label", type: "text", localized: false };
/** A group whose structure, and every value in it, is kept for each language. */
const perLanguage = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  localized: true,
  fields,
});
/** A group with one structure for every language, its values kept once. */
const shared = (name: string, fields: Field[]): Field => ({
  name,
  type: "group",
  localized: false,
  fields,
});

/** Each language's value of `subtitle`, different in each. */
const SUBTITLES = { en: "Hello", es: "Hola" } as const;
const LOCALES = ["en", "es"] as const;

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-translated-moves-"));
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

async function filesWritten(): Promise<number> {
  return (await readdir(join(basePath, "migrations"))).filter(f =>
    f.endsWith(".sql")
  ).length;
}

/** `nextly migrate` on `t`'s database over the folder the first database wrote. */
async function migrateFolder(
  t: TestNextly,
  step?: number,
  consent = resolveDataLossConsent({ flag: undefined, env: {} })
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
  } as never);
  clearRegistryRowCache();
}

/** `nextly migrate:down` of the newest migration on `t`'s database. */
async function migrateDown(t: TestNextly): Promise<void> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const migrationsDir = join(basePath, "migrations");
  await migrateDownCore({
    ...(await downDatabaseDeps({
      adapter,
      dialect: adapter.getCapabilities().dialect,
      migrationsDir,
    })),
    nodeEnv: "test",
    logger: createLogger({ quiet: true }),
    options: {
      step: 1,
      consent: resolveDataLossConsent({ flag: true, env: {} }),
      yes: true,
      dryRun: false,
    },
    fileExists: () => Promise.resolve(true),
    readDownSql: async filename => {
      const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
      const content = await readFile(join(migrationsDir, name), "utf-8");
      return {
        sql: parseSqlSections(content).downSql,
        transaction: !marksNoTransaction(content),
      };
    },
    withLock: withMigrateLock,
  } as Parameters<typeof migrateDownCore>[0]);
  clearRegistryRowCache();
}

/** The translated collection as the Builder creates it. */
async function createPosts(t: TestNextly, fields: Field[]): Promise<void> {
  await t.getService("collectionService").createCollection(
    {
      name: POSTS,
      label: "Post",
      localized: true,
      fields,
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await run<{ version: number | string | null }>(
    t,
    `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${POSTS}'`
  );
  return Number(row?.version ?? 1);
}

/** The collection's schema dialog save of `fields`, with the moves the Builder sends. */
async function savePosts(
  t: TestNextly,
  fields: Field[],
  moves: Move[]
): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: POSTS },
    {
      fields,
      confirmed: true,
      schemaVersion: await versionOf(t),
      hints: { moves },
    }
  );
  clearRegistryRowCache();
}

/** One entry, `subtitle` written in each language, and `code` and `label` once. */
async function seedPost(
  t: TestNextly,
  holder: (value: string) => Record<string, unknown>
): Promise<string> {
  const created = await t.nextly.create({
    collection: POSTS as never,
    locale: "en",
    data: { title: "One", slug: "one", ...holder(SUBTITLES.en) } as never,
  });
  const id = String((created.item as { id: unknown }).id);
  await t.nextly.update({
    collection: POSTS as never,
    id: id as never,
    locale: "es",
    data: { ...holder(SUBTITLES.es), _overwrite: true } as never,
  });
  return id;
}

/** The entry as each language reads it. */
async function readPost(
  t: TestNextly,
  locale: string
): Promise<Record<string, unknown>> {
  const { items } = await t.nextly.find({
    collection: POSTS as never,
    locale,
    limit: 10,
  } as never);
  return ((items as Record<string, unknown>[])[0] ?? {}) as Record<
    string,
    unknown
  >;
}

const refusal = (text: string) =>
  expect.objectContaining({
    publicData: {
      errors: [
        expect.objectContaining({
          code: "FIELD_MOVE_REFUSED",
          message: expect.stringContaining(text),
        }),
      ],
    },
  });

describe.each(getConfiguredTestDialects())(
  "a field kept for each language moved between groups that keep it so (%s)",
  dialect => {
    async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
      const rows = await run<{ name: string }>(
        t,
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    const OUTSIDE = [SUBTITLE, CODE, perLanguage("meta", [NOTE])];
    const INSIDE = [CODE, perLanguage("meta", [NOTE, SUBTITLE])];
    const INTO: Move[] = [{ from: ["subtitle"], to: ["meta", "subtitle"] }];
    const OUT: Move[] = [{ from: ["meta", "subtitle"], to: ["subtitle"] }];

    async function expectEachLanguage(
      t: TestNextly,
      at: (read: Record<string, unknown>) => unknown
    ): Promise<void> {
      for (const locale of LOCALES) {
        expect(at(await readPost(t, locale)), locale).toBe(SUBTITLES[locale]);
      }
    }
    const inMeta = (read: Record<string, unknown>) =>
      (read.meta as Record<string, unknown> | undefined)?.subtitle;

    it("on a translated collection, into a translated group: each language's value in the group, the language table's column gone, and back on migrate:down", async () => {
      const t = await boot(dialect);
      await createPosts(t, OUTSIDE);
      await seedPost(t, value => ({ subtitle: value }));

      await savePosts(t, INSIDE, INTO);
      await expectEachLanguage(t, inMeta);
      expect(await columnsOf(t, COMPANION)).not.toContain("subtitle");

      await migrateDown(t);
      expect(await columnsOf(t, COMPANION)).toContain("subtitle");
      const rows = await run<{ locale: string; subtitle: string | null }>(
        t,
        `SELECT ${dialect === "mysql" ? "`_locale`" : '"_locale"'} AS locale, subtitle FROM ${dialect === "mysql" ? `\`${COMPANION}\`` : `"${COMPANION}"`}`
      );
      expect(
        Object.fromEntries(rows.map(row => [row.locale, row.subtitle]))
      ).toEqual(SUBTITLES);
    });

    it("on a translated collection, into a translated group and back out, replayed by nextly migrate on a second database", async () => {
      const first = await boot(dialect);
      await createPosts(first, OUTSIDE);
      const created = await filesWritten();
      await seedPost(first, value => ({ subtitle: value }));
      await savePosts(first, INSIDE, INTO);
      const movedIn = await filesWritten();
      await savePosts(first, OUTSIDE, OUT);
      expect(movedIn).toBeGreaterThan(created);
      expect(await filesWritten()).toBeGreaterThan(movedIn);
      await expectEachLanguage(first, read => read.subtitle);
      await first.destroy();
      instance = undefined;

      const second = await boot(dialect);
      await migrateFolder(second, created);
      await seedPost(second, value => ({ subtitle: value }));
      // An unattended run asks consent for every column a file drops, a moved field's included.
      await migrateFolder(
        second,
        movedIn - created,
        resolveDataLossConsent({ flag: `${COMPANION}.subtitle`, env: {} })
      );
      expect(await columnsOf(second, COMPANION)).not.toContain("subtitle");
      await expectEachLanguage(second, inMeta);

      await migrateFolder(second);
      expect(await columnsOf(second, COMPANION)).toContain("subtitle");
      await expectEachLanguage(second, read => read.subtitle);
    });

    it("on a translated collection, from one translated group to another", async () => {
      const t = await boot(dialect);
      const from = [
        CODE,
        perLanguage("meta", [NOTE, SUBTITLE]),
        perLanguage("seo", [LABEL]),
      ];
      await createPosts(t, from);
      await seedPost(t, value => ({ meta: { subtitle: value } }));

      await savePosts(
        t,
        [
          CODE,
          perLanguage("meta", [NOTE]),
          perLanguage("seo", [LABEL, SUBTITLE]),
        ],
        [{ from: ["meta", "subtitle"], to: ["seo", "subtitle"] }]
      );
      await expectEachLanguage(
        t,
        read => (read.seo as Record<string, unknown> | undefined)?.subtitle
      );
    });

    it("refuses a field kept for each language moved into a group that keeps one structure for every language, each language's value kept", async () => {
      const t = await boot(dialect);
      await createPosts(t, [SUBTITLE, CODE, shared("box", [LABEL])]);
      await seedPost(t, value => ({ subtitle: value }));
      const files = await filesWritten();

      await expect(
        savePosts(
          t,
          [CODE, shared("box", [LABEL, SUBTITLE])],
          [{ from: ["subtitle"], to: ["box", "subtitle"] }]
        )
      ).rejects.toThrow(
        refusal("one structure with each language's text inside it")
      );
      expect(await filesWritten()).toBe(files);
      await expectEachLanguage(t, read => read.subtitle);
    });

    it("moves a field kept once into a group that keeps one structure, the fields kept for each language beside it unchanged", async () => {
      const t = await boot(dialect);
      await createPosts(t, [SUBTITLE, CODE, shared("box", [LABEL])]);
      await seedPost(t, value => ({ subtitle: value, code: "C-1" }));

      await savePosts(
        t,
        [SUBTITLE, shared("box", [LABEL, CODE])],
        [{ from: ["code"], to: ["box", "code"] }]
      );
      for (const locale of LOCALES) {
        const read = await readPost(t, locale);
        expect(
          (read.box as Record<string, unknown> | undefined)?.code,
          locale
        ).toBe("C-1");
        expect(read.subtitle, locale).toBe(SUBTITLES[locale]);
      }
      expect(await columnsOf(t, TABLE)).not.toContain("code");
    });

    describe("on a translated Single", () => {
      const TAGLINE: Field = { name: "tagline", type: "text" };
      const PAGE_OUT = [TAGLINE, perLanguage("meta", [NOTE])];
      const PAGE_IN = [perLanguage("meta", [NOTE, TAGLINE])];

      async function savePage(
        t: TestNextly,
        fields: Field[],
        moves: Move[]
      ): Promise<void> {
        const single = await t
          .getService("singleRegistryService")
          .getSingleBySlug(PAGE);
        await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: PAGE },
          {
            fields,
            confirmed: true,
            schemaVersion: single?.schemaVersion ?? 1,
            hints: { moves },
          }
        );
        clearRegistryRowCache();
      }

      async function seedPage(
        t: TestNextly,
        holder: (value: string) => Record<string, unknown>
      ): Promise<void> {
        for (const locale of LOCALES) {
          await t.nextly.updateSingle({
            slug: PAGE as never,
            data: { ...holder(SUBTITLES[locale]), _overwrite: true },
            locale,
            overrideAccess: true,
          } as never);
        }
      }

      async function expectPage(
        t: TestNextly,
        at: (read: Record<string, unknown>) => unknown
      ): Promise<void> {
        for (const locale of LOCALES) {
          const read = (await t.nextly.findSingle({
            slug: PAGE as never,
            overrideAccess: true,
            locale,
          } as never)) as Record<string, unknown>;
          expect(at(read), locale).toBe(SUBTITLES[locale]);
        }
      }

      it("into a translated group and back out, replayed by nextly migrate on a second database", async () => {
        const first = await boot(dialect);
        await dispatchSingles(
          "createSingle",
          {},
          { slug: PAGE, label: "Page", localized: true, fields: PAGE_OUT }
        );
        const created = await filesWritten();
        await seedPage(first, value => ({ tagline: value }));

        await savePage(first, PAGE_IN, [
          { from: ["tagline"], to: ["meta", "tagline"] },
        ]);
        await expectPage(
          first,
          read => (read.meta as Record<string, unknown> | undefined)?.tagline
        );
        const movedIn = await filesWritten();
        await savePage(first, PAGE_OUT, [
          { from: ["meta", "tagline"], to: ["tagline"] },
        ]);
        await expectPage(first, read => read.tagline);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        await seedPage(second, value => ({ tagline: value }));
        const pageCompanion = (
          await run<{ name: string }>(
            second,
            dialect === "mysql"
              ? "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '%tmv_page%locales'"
              : dialect === "sqlite"
                ? "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%tmv_page%locales'"
                : "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE '%tmv_page%locales'"
          )
        )[0]?.name;
        expect(pageCompanion).toBeDefined();
        await migrateFolder(
          second,
          movedIn - created,
          resolveDataLossConsent({ flag: `${pageCompanion}.tagline`, env: {} })
        );
        await expectPage(
          second,
          read => (read.meta as Record<string, unknown> | undefined)?.tagline
        );
        await migrateFolder(second);
        await expectPage(second, read => read.tagline);
      });
    });
  }
);
