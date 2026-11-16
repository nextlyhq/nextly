/**
 * A translated date field keeps its instant on a server whose time zone is not UTC,
 * through the Schema Builder: turning translation on and off moves each value without shifting it,
 * and a date written in each language while translated is stored as the UTC wall clock, like the
 * main table's. Each value is read back through Nextly's entry service and through plain SQL, since
 * Nextly's own read of a column it believes has no zone can hide a shifted instant.
 *
 * The Node process runs in a zone far from UTC on each side, as when the app runs on a machine set
 * to it: a `Date` bound bare is that process's local wall clock. On PostgreSQL every connection
 * starts in the zone too; MySQL's adapter starts every session in UTC. The values sit either side
 * of midnight there and in UTC.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureLocalizedCompanions } from "../../../cli/commands/dev-build";
import { createLogger } from "../../../cli/utils/logger";
import { defineConfig } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";

const SLUG = "tdkb_posts";
const MAIN = `dc_${SLUG}`;
const COMPANION = `${MAIN}_locales`;
const FIELDS = [
  { name: "heading", type: "text" },
  { name: "published", type: "date", localized: true },
];
/** Two instants, and the UTC wall clock each is stored as. */
const AT = {
  late: { iso: "2026-01-15T23:30:00.000Z", wall: "2026-01-15 23:30:00" },
  early: { iso: "2026-01-16T00:30:00.000Z", wall: "2026-01-16 00:30:00" },
};

interface Entries {
  createEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  getEntry(
    params: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
}

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
  }>;
  getEntryService(): Entries;
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

const ZONES = ["Asia/Karachi", "America/Los_Angeles"];
/**
 * Each configured server dialect in each zone. MySQL's adapter starts every session in UTC, so
 * there only the Node process is in the zone; it keeps a date as `DATETIME(3)` in the translations
 * table beside the main table's `timestamp`, both holding the UTC wall clock.
 */
const CASES = [
  ...(process.env.TEST_POSTGRES_URL
    ? ZONES.map(zone => ({
        dialect: "postgresql" as const,
        zone,
        companionType: "timestamp without time zone",
        mainType: "timestamp without time zone",
      }))
    : []),
  ...(process.env.TEST_MYSQL_URL
    ? ZONES.map(zone => ({
        dialect: "mysql" as const,
        zone,
        companionType: "datetime",
        mainType: "timestamp",
      }))
    : []),
];

describe.runIf(CASES.length > 0).each(CASES)(
  "a translated date keeps its instant through the Builder on $dialect in $zone",
  ({ dialect, zone, companionType, mainType }) => {
    /** An instance in `zone`: its Node process, and on PostgreSQL every connection too. */
    async function bootIn(): Promise<TestNextly> {
      // The schema dialog applies its change in development only.
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("TZ", zone);
      expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).not.toBe(0);
      if (dialect === "mysql") {
        current = await createTestNextly({
          dialect,
          collections: [],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
        return current;
      }
      const url = new URL(process.env.TEST_POSTGRES_URL ?? "");
      url.searchParams.set("options", `-c timezone=${zone}`);
      current = await createTestNextly({
        dialect,
        serverUrl: url.toString(),
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const [row] = await query<{ TimeZone: string }>("SHOW timezone");
      expect(row?.TimeZone).toBe(zone);
      return current;
    }

    const query = <T>(statement: string) =>
      (current!.adapter as unknown as DrizzleAdapter).executeQuery(
        statement
      ) as unknown as Promise<T[]>;

    const entries = () =>
      (
        current!.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler
      ).getEntryService();

    async function createPosts(localized: boolean): Promise<void> {
      const handler = current!.getService(
        "collectionsHandler"
      ) as unknown as CollectionsHandler;
      const created = await handler.createCollection({
        name: SLUG,
        label: "Post",
        localized,
        fields: FIELDS,
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
    }

    async function write(
      published: string,
      locale = "en",
      entryId?: string
    ): Promise<string> {
      const result = entryId
        ? await entries().updateEntry(
            { collectionName: SLUG, entryId, overrideAccess: true, locale },
            { published, _overwrite: true }
          )
        : await entries().createEntry(
            { collectionName: SLUG, overrideAccess: true, locale },
            { heading: "H", published }
          );
      expect(result.success, JSON.stringify(result)).toBe(true);
      return String((result.data as { id: unknown }).id);
    }

    /** The instant Nextly reads back for `id` in `locale`. */
    async function readThroughNextly(
      id: string,
      locale = "en"
    ): Promise<string> {
      const got = await entries().getEntry({
        collectionName: SLUG,
        entryId: id,
        overrideAccess: true,
        locale,
      });
      expect(got.success, JSON.stringify(got)).toBe(true);
      return new Date(
        String((got.data as { published: unknown }).published)
      ).toISOString();
    }

    /** `published` in `table`: its type, and each row's value as the database spells it. */
    async function readThroughSql(
      table: string,
      where: string
    ): Promise<{ type: string | undefined; wall: string | undefined }> {
      const [column] = await query<{ type: string }>(
        dialect === "mysql"
          ? `SELECT DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'published'`
          : `SELECT data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'published'`
      );
      const [row] = await query<{ wall: string }>(
        dialect === "mysql"
          ? `SELECT DATE_FORMAT(published, '%Y-%m-%d %H:%i:%s') AS wall FROM \`${table}\` WHERE ${where}`
          : `SELECT published::text AS wall FROM "${table}" WHERE ${where}`
      );
      return { type: column?.type, wall: row?.wall };
    }

    async function setTranslated(localized: boolean): Promise<void> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT schema_version AS version FROM dynamic_collections WHERE slug = '${SLUG}'`
      );
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: SLUG },
        {
          fields: FIELDS,
          confirmed: true,
          localized,
          schemaVersion: Number(row?.version ?? 1),
        }
      );
    }

    it("moves each value without shifting it when the schema dialog turns translation on and off", async () => {
      await bootIn();
      await createPosts(false);
      const late = await write(AT.late.iso);
      const early = await write(AT.early.iso);

      await setTranslated(true);

      for (const [id, at] of [
        [late, AT.late],
        [early, AT.early],
      ] as const) {
        expect(await readThroughNextly(id)).toBe(at.iso);
        expect(
          await readThroughSql(
            COMPANION,
            `_parent = '${id}' AND _locale = 'en'`
          )
        ).toEqual({ type: companionType, wall: at.wall });
      }

      await setTranslated(false);

      for (const [id, at] of [
        [late, AT.late],
        [early, AT.early],
      ] as const) {
        expect(await readThroughNextly(id)).toBe(at.iso);
        expect(await readThroughSql(MAIN, `id = '${id}'`)).toEqual({
          type: mainType,
          wall: at.wall,
        });
      }
    });

    // A collection made in the Schema Builder is in the registry, not the config, and `nextly
    // migrate` converts its translations table too.
    it.runIf(dialect === "postgresql")(
      "converts a Builder collection's date column made with a time zone through nextly migrate",
      async () => {
        await bootIn();
        await createPosts(true);
        const id = await write(AT.late.iso);
        // As an earlier release left it: the column with a time zone, the value read in the zone.
        await query(
          `ALTER TABLE "${COMPANION}" ALTER COLUMN published TYPE timestamp with time zone USING published AT TIME ZONE current_setting('TimeZone')`
        );
        expect(
          (await readThroughSql(COMPANION, `_parent = '${id}'`)).type
        ).toBe("timestamp with time zone");
        vi.stubEnv("NODE_ENV", "production");

        // `nextly migrate`'s translations pass, over a config that declares no collection.
        await ensureLocalizedCompanions(
          defineConfig({
            localization: { locales: ["en", "es"], defaultLocale: "en" },
          }),
          current!.adapter as unknown as Parameters<
            typeof ensureLocalizedCompanions
          >[1],
          {
            logger: createLogger({ quiet: true }),
            options: {},
            cwd: process.cwd(),
          } as unknown as Parameters<typeof ensureLocalizedCompanions>[2],
          "afterApply",
          { supervised: true }
        );

        expect(
          await readThroughSql(
            COMPANION,
            `_parent = '${id}' AND _locale = 'en'`
          )
        ).toEqual({ type: companionType, wall: AT.late.wall });
        expect(await readThroughNextly(id)).toBe(AT.late.iso);
      }
    );

    it("stores a date written in each language while translated as the UTC wall clock", async () => {
      await bootIn();
      await createPosts(true);
      const id = await write(AT.late.iso, "en");
      await write(AT.early.iso, "es", id);

      expect(await readThroughNextly(id, "en")).toBe(AT.late.iso);
      expect(await readThroughNextly(id, "es")).toBe(AT.early.iso);
      expect(
        await readThroughSql(COMPANION, `_parent = '${id}' AND _locale = 'en'`)
      ).toEqual({ type: companionType, wall: AT.late.wall });
      expect(
        (
          await readThroughSql(
            COMPANION,
            `_parent = '${id}' AND _locale = 'es'`
          )
        ).wall
      ).toBe(AT.early.wall);
    });
  }
);
