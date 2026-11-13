/**
 * The general settings row, followed rather than read on every use, on every
 * dialect.
 *
 * One admin screen asks for the row a dozen times or more: every JSON answer
 * reads the timezone, the startup request answers several parts that each
 * do, and the admin's branding reads the name and logo. The row is the same
 * for every reader, so this process reads it at most once per interval and
 * shares a read under way. What that must not cost:
 * - a write made through this process is read back at once;
 * - a change another instance makes (a write past this process's services,
 *   so nothing here is told) is seen once the interval has passed, and
 *   bounded by it;
 * - a reader whose decision guards access reads the row itself: the preview
 *   revocation generation and the address a preview link sends its holder
 *   to reflect another instance's change at once, even while a copy read a
 *   moment earlier is kept for everyone else.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { recordStatements } from "../../__tests__/helpers/record-statements";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { getDialectTables } from "../../database";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { defaultGeneration } from "../../runtime/preview/preview-route-defaults";

import {
  GENERAL_SETTINGS_READ_INTERVAL_MS,
  type GeneralSettingsService,
} from "./general-settings-service";

const ORIGIN = "http://localhost";
const EDITOR = "settings-followed-editor";

/** Every part the admin's startup request asks for. */
const STARTUP = `/startup?${[
  "/auth/setup-status",
  "/auth/session",
  "/admin-meta",
  "/admin-meta/workspace",
  "/me",
  "/me/permissions",
  "/me/capabilities",
  "/general-settings",
  "/collections?limit=100&page=1&sortBy=name&sortOrder=asc",
  "/singles?limit=100&page=1",
]
  .map(path => `path=${encodeURIComponent(path)}`)
  .join("&")}`;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A real wait: the followed row is timed on the process's clock. */
const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** The statements of `texts` that read the settings row. */
function settingsReads(texts: readonly string[]): string[] {
  return texts.filter(text =>
    /^\s*select\b[\s\S]*\bfrom\s+["`]?site_settings["`]?/i.test(text)
  );
}

describe.each(getConfiguredTestDialects())(
  "the general settings row, followed (%s)",
  dialect => {
    async function boot(): Promise<{
      t: TestNextly;
      settings: GeneralSettingsService;
      elsewhere: (values: Record<string, unknown>) => Promise<void>;
    }> {
      const t = (current = await createTestNextly({ dialect }));
      const settings = t.getService(
        "generalSettingsService"
      ) as GeneralSettingsService;
      await settings.updateSettings({
        applicationName: "Before",
        siteUrl: "https://before.example",
        timezone: "UTC",
      });
      const table = getDialectTables(dialect).siteSettings;
      // Another instance's write: the row changed on the database, past this
      // process's settings service, so nothing here is marked or told.
      const elsewhere = async (values: Record<string, unknown>) => {
        const db = t.adapter.getDrizzle() as unknown as {
          update(table: unknown): {
            set(values: Record<string, unknown>): {
              where(condition: unknown): Promise<unknown>;
            };
          };
        };
        await db.update(table).set(values).where(eq(table.id, "default"));
      };
      return { t, settings, elsewhere };
    }

    it("reads a write made through this process back at once", async () => {
      const { settings } = await boot();
      expect((await settings.getSettings()).applicationName).toBe("Before");

      await settings.updateSettings({ applicationName: "After" });

      expect((await settings.getSettings()).applicationName).toBe("After");
      expect(await settings.getTimezone()).toBe("UTC");
    });

    it("sees another instance's change once the interval has passed, and not before", async () => {
      const { settings, elsewhere } = await boot();
      expect((await settings.getSettings()).timezone).toBe("UTC");

      await elsewhere({ timezone: "Asia/Karachi" });

      expect(await settings.getTimezone()).toBe("UTC");
      await pause(GENERAL_SETTINGS_READ_INTERVAL_MS + 100);
      expect(await settings.getTimezone()).toBe("Asia/Karachi");
    });

    it("honours a revoke another instance made at once, while the kept copy is older", async () => {
      const { settings, elsewhere } = await boot();
      // The copy every other reader is answered from, read just now.
      expect((await settings.getSettings()).previewTokenGeneration).toBe(0);

      await elsewhere({ previewTokenGeneration: 5 });

      // The verify path's generation, through the container as a request
      // reads it: never the kept copy.
      expect(await defaultGeneration()).toBe(5);
      expect(await settings.getPreviewTokenGeneration()).toBe(5);
      // What the fresh read found is kept for everyone.
      expect((await settings.getSettings()).previewTokenGeneration).toBe(5);
    });

    it("reads the address a preview link sends its holder to from the row", async () => {
      const { settings, elsewhere } = await boot();
      expect((await settings.getSettings()).siteUrl).toBe(
        "https://before.example"
      );

      await elsewhere({ siteUrl: "https://after.example" });

      expect((await settings.getSettings({ fresh: true })).siteUrl).toBe(
        "https://after.example"
      );
    });

    it("answers a revoke made here with the new generation at once", async () => {
      const { settings } = await boot();
      await settings.getSettings();

      expect(await settings.revokeAllPreviewTokens()).toBe(1);
      expect((await settings.getSettings()).previewTokenGeneration).toBe(1);
    });

    it("reads the row once for the whole startup request, and not again within the interval", async () => {
      const { t } = await boot();
      await superAdminUser(t, EDITOR);
      const token = await signAccessToken(
        buildClaims({
          userId: EDITOR,
          email: `${EDITOR}@example.test`,
          name: EDITOR,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const startup = async (): Promise<number> => {
        const url = new URL(`${ORIGIN}/admin/api${STARTUP}`);
        const response = await createDynamicHandlers().GET(
          new Request(url, {
            headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
          }),
          { params: Promise.resolve({ params: ["startup"] }) }
        );
        await response.text();
        return response.status;
      };
      expect(await startup()).toBe(200);
      // Past the interval, so the request below finds the copy too old and
      // reads once: the read it makes is the one being counted.
      await pause(GENERAL_SETTINGS_READ_INTERVAL_MS + 100);

      const recorder = await recordStatements(t.adapter, dialect);
      let first: string[];
      let second: string[];
      try {
        expect(await startup()).toBe(200);
        first = [...recorder.statements];
        expect(await startup()).toBe(200);
        second = recorder.statements.slice(first.length);
      } finally {
        recorder.uninstall();
      }
      expect(settingsReads(first)).toHaveLength(1);
      expect(settingsReads(second)).toHaveLength(0);
    });
  }
);
