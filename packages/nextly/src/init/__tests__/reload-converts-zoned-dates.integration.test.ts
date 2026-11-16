// A config reload under `next dev` converts a translated date column an earlier release made with
// a time zone, as the development sync does, but only once its translations pass refused nothing:
// a reload that leaves a translations column refused converts no date. Driving
// `reloadNextlyConfig` itself against PostgreSQL, the one dialect such a column exists on.
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));

vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

const SLUG = "rlzoned";
const COMPANION = `dc_${SLUG}_locales`;

/** The collection with a translated date, and with or without a newly translated `code`. */
const configWith = (code: boolean) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: true },
          { name: "published", type: "date", localized: true },
          ...(code ? [{ name: "code", type: "text", localized: true }] : []),
        ] as never,
      }),
    ],
  });

describe.runIf(process.env.TEST_POSTGRES_URL)(
  "a config reload over a date column made with a time zone",
  () => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
      handle = undefined;
    });

    /** The collection booted and reloaded once, its date column then made as an earlier release made it. */
    async function withOldDateColumn(): Promise<TestNextly> {
      handle = await createTestNextly({ dialect: "postgresql" });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith(false);
      await reloadNextlyConfig();
      await handle.adapter.executeQuery(
        `ALTER TABLE "${COMPANION}" ALTER COLUMN published TYPE timestamp with time zone`
      );
      expect(await dateColumnType()).toBe("timestamp with time zone");
      return handle;
    }

    async function dateColumnType(): Promise<string | undefined> {
      const [row] = (await handle!.adapter.executeQuery(
        `SELECT data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${COMPANION}' AND column_name = 'published'`
      )) as Array<{ type: string }>;
      return row?.type;
    }

    it("converts it when the reload's translations pass refuses nothing", async () => {
      await withOldDateColumn();
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await reloadNextlyConfig();

      expect(await dateColumnType()).toBe("timestamp without time zone");
    });

    it("converts nothing when the reload leaves a translations column refused", async () => {
      await withOldDateColumn();
      // A column of another kind, left in the translations table, under a field the reload newly
      // translates as text.
      await handle!.adapter.executeQuery(
        `ALTER TABLE "${COMPANION}" ADD COLUMN "code" integer`
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      loaded.config = configWith(true);

      await reloadNextlyConfig();

      expect(warn.mock.calls.flat().join(" ")).toMatch(/column "code"/);
      expect(await dateColumnType()).toBe("timestamp with time zone");
    });
  }
);
