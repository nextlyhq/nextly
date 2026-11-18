/**
 * A field the Schema Builder moves into a group, or out of one, keeps its values on a Single and
 * in a field group as it does in a collection: the save writes the copy into its migration file
 * and runs it.
 *
 * - A Single's one row, through its schema dialog.
 * - A field group's table, which holds the rows of every collection and Single that uses it: each
 *   entry in each keeps its value, and a second database replaying the files with `nextly migrate`
 *   holds what the first held.
 * - A translated Single, a translated field moved into a translated group: each language's value
 *   moves in the language table, its own row.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../../migrate/data-loss-consent";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown>;
type Move = { from: string[]; to: string[] };

const NOTE: Field = { name: "note", type: "text" };
const group = (name: string, fields: Field[], extra: Field = {}): Field => ({
  name,
  type: "group",
  fields,
  ...extra,
});
const SUMMARY: Field = { name: "summary", type: "text" };
const VIEWS: Field = { name: "views", type: "number" };
const OUTSIDE: Field[] = [SUMMARY, VIEWS, group("meta", [NOTE])];
const INSIDE: Field[] = [group("meta", [NOTE, SUMMARY, VIEWS])];
const INTO: Move[] = [
  { from: ["summary"], to: ["meta", "summary"] },
  { from: ["views"], to: ["meta", "views"] },
];
const OUT: Move[] = INTO.map(({ from, to }) => ({ from: to, to: from }));

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-single-group-moves-"));
  // The schema dialogs apply their change, and write their migration, in development only.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
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
  consent: DataLossConsent = NO_CONSENT
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

/** A Single's schema dialog save of `fields`, with the moves the Builder sends beside them. */
async function saveSingle(
  t: TestNextly,
  slug: string,
  fields: Field[],
  moves: Move[]
): Promise<void> {
  const single = await t
    .getService("singleRegistryService")
    .getSingleBySlug(slug);
  await dispatchSingles(
    "applySingleSchemaChanges",
    { slug },
    {
      fields,
      confirmed: true,
      schemaVersion: single?.schemaVersion ?? 1,
      hints: { moves },
    }
  );
  clearRegistryRowCache();
}

/** A field group's schema dialog save of `fields`, with the moves the Builder sends. */
async function saveFieldGroup(
  t: TestNextly,
  slug: string,
  fields: Field[],
  moves: Move[]
): Promise<void> {
  const { schemaVersion } = await t
    .getService("fieldGroupRegistryService")
    .getComponent(slug);
  await dispatchComponents(
    "applyComponentSchemaChanges",
    { slug },
    { fields, confirmed: true, schemaVersion, hints: { moves } }
  );
  clearRegistryRowCache();
}

const readSingle = async (
  t: TestNextly,
  slug: string,
  locale?: string
): Promise<Record<string, unknown>> =>
  (await t.nextly.findSingle({
    slug: slug as never,
    overrideAccess: true,
    ...(locale === undefined ? {} : { locale }),
  })) as Record<string, unknown>;

/** The summary and views a holder carries, an absent one read as null. */
function values(holder: unknown): { summary: unknown; views: unknown } {
  const read = (holder ?? {}) as Record<string, unknown>;
  return { summary: read.summary ?? null, views: read.views ?? null };
}

describe.each(getConfiguredTestDialects())(
  "a field moved into or out of a group on a Single or in a field group keeps its values (%s)",
  dialect => {
    it("on a Single's row, through its schema dialog: in, then back out", async () => {
      const t = await boot(dialect);
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "sgm_hero", label: "Hero", fields: OUTSIDE }
      );
      await t.nextly.updateSingle({
        slug: "sgm_hero" as never,
        data: { summary: "Hello", views: 4, _overwrite: true },
        overrideAccess: true,
      });

      await saveSingle(t, "sgm_hero", INSIDE, INTO);
      expect(values((await readSingle(t, "sgm_hero")).meta)).toEqual({
        summary: "Hello",
        views: 4,
      });

      await saveSingle(t, "sgm_hero", OUTSIDE, OUT);
      expect(values(await readSingle(t, "sgm_hero"))).toEqual({
        summary: "Hello",
        views: 4,
      });
    });

    describe("a field group used by a collection and a Single", () => {
      const CARD = "sgm_card";
      const POSTS = "sgm_posts";
      const HERO = "sgm_hero";
      const uses: Field[] = [
        { name: "card", type: "component", component: CARD },
      ];
      const CARDS = {
        one: { summary: "Post one", views: 1 },
        two: { summary: "Post two", views: 2 },
        hero: { summary: "The hero", views: 9 },
      };

      /** The field group, a collection and a Single using it, written by their dialogs. */
      async function createUsers(t: TestNextly): Promise<void> {
        await dispatchComponents(
          "createComponent",
          {},
          { slug: CARD, label: "Card", fields: OUTSIDE }
        );
        await t.getService("collectionService").createCollection(
          {
            name: POSTS,
            label: "Post",
            localized: false,
            fields: uses,
          } as Parameters<CollectionService["createCollection"]>[0],
          {}
        );
        await dispatchSingles(
          "createSingle",
          {},
          { slug: HERO, label: "Hero", fields: uses }
        );
      }

      /** An entry in each user, each holding a card with values to move. */
      async function seed(t: TestNextly): Promise<void> {
        for (const slug of ["one", "two"] as const) {
          await t.nextly.create({
            collection: POSTS as never,
            data: { title: slug, slug, card: CARDS[slug] } as never,
          });
        }
        await t.nextly.updateSingle({
          slug: HERO as never,
          data: { card: CARDS.hero, _overwrite: true },
          overrideAccess: true,
        });
      }

      /** Each user's card, by entry, read through the API. */
      async function cards(t: TestNextly): Promise<Record<string, unknown>> {
        const { items } = await t.nextly.find({
          collection: POSTS as never,
          limit: 10,
        });
        const out: Record<string, unknown> = {};
        for (const item of items as { slug: string; card?: unknown }[]) {
          out[item.slug] = item.card;
        }
        out.hero = (await readSingle(t, HERO)).card;
        return out;
      }

      /** The field group's group column on each of its rows, as the database holds it, sorted. */
      async function storedGroups(t: TestNextly): Promise<unknown[]> {
        const { tableName } = await t
          .getService("fieldGroupRegistryService")
          .getComponent(CARD);
        const q = (id: string) =>
          dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
        const rows = await run<{ meta: unknown }>(
          t,
          `SELECT ${q("meta")} AS meta FROM ${q(tableName)}`
        );
        return rows
          .map(row =>
            typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta
          )
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      }

      it("every entry in each user keeps its values, in and back out", async () => {
        const t = await boot(dialect);
        await createUsers(t);
        await seed(t);

        await saveFieldGroup(t, CARD, INSIDE, INTO);
        const inside = await cards(t);
        for (const [entry, card] of Object.entries(CARDS)) {
          expect(
            values((inside[entry] as { meta?: unknown } | undefined)?.meta),
            entry
          ).toEqual(card);
        }

        await saveFieldGroup(t, CARD, OUTSIDE, OUT);
        const outside = await cards(t);
        for (const [entry, card] of Object.entries(CARDS)) {
          expect(values(outside[entry]), entry).toEqual(card);
        }
      });

      it("a second database replaying the files holds what the first held", async () => {
        const first = await boot(dialect);
        await createUsers(first);
        const created = await filesWritten();
        await seed(first);
        await saveFieldGroup(first, CARD, INSIDE, INTO);
        const movedIn = await filesWritten();
        const groupsInside = await storedGroups(first);
        await saveFieldGroup(first, CARD, OUTSIDE, OUT);
        expect(movedIn).toBeGreaterThan(created);
        await first.destroy();
        instance = undefined;

        const second = await boot(dialect);
        await migrateFolder(second, created);
        // The definition the run records is the newest, the fields where they began.
        await seed(second);
        const { tableName } = await second
          .getService("fieldGroupRegistryService")
          .getComponent(CARD);
        // An unattended run asks consent for every column a file drops, a moved field's too.
        await migrateFolder(
          second,
          movedIn - created,
          resolveDataLossConsent({
            flag: `${tableName}.summary,${tableName}.views`,
            env: {},
          })
        );
        expect(await storedGroups(second)).toEqual(groupsInside);

        await migrateFolder(second);
        const replayed = await cards(second);
        for (const [entry, card] of Object.entries(CARDS)) {
          expect(values(replayed[entry]), entry).toEqual(card);
        }
      });
    });

    it("on a translated Single, a translated field moved into a translated group keeps each language's value", async () => {
      const t = await boot(dialect);
      const title: Field = { name: "title", type: "text", localized: true };
      const meta = (fields: Field[]) =>
        group("meta", fields, { localized: true });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "sgm_page",
          label: "Page",
          localized: true,
          fields: [title, meta([NOTE])],
        }
      );
      for (const [locale, text] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ] as const) {
        await t.nextly.updateSingle({
          slug: "sgm_page" as never,
          data: { title: text, _overwrite: true },
          locale,
          overrideAccess: true,
        });
      }

      await saveSingle(
        t,
        "sgm_page",
        [meta([NOTE, title])],
        [{ from: ["title"], to: ["meta", "title"] }]
      );

      for (const [locale, text] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ] as const) {
        const read = await readSingle(t, "sgm_page", locale);
        expect(
          (read.meta as Record<string, unknown> | undefined)?.title,
          locale
        ).toBe(text);
      }
    });
  }
);
