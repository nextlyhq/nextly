/**
 * A plugin's `ctx.settings.set` commits, and reads back, on every dialect.
 *
 * Drizzle's better-sqlite3 transaction callback is synchronous by driver
 * design, so the store's Drizzle-transaction path fails every awaited write
 * with "Transaction function cannot return a promise". SQLite writes ride
 * the adapter's manual BEGIN IMMEDIATE runner instead — this is the boot a
 * plugin actually takes, writing through the context the runtime builds.
 *
 * Run on every configured dialect: PostgreSQL and MySQL write through their
 * own transaction path, and each dialect's column has to hold the largest
 * value the service admits. MySQL's `TEXT` would hold 64 KiB, a quarter of it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { MAX_SETTING_BYTES } from "../../domains/plugins/settings-service";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface CapturedSettings {
  get: () => Promise<{ port: number; host: string }>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

/** Boot one plugin with settings on `dialect`, and hand back its `ctx.settings`. */
async function bootSettings(dialect: TestDialect): Promise<CapturedSettings> {
  let captured: CapturedSettings | undefined;
  const plugin = definePlugin({
    name: "@test/settings",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      settings: z.object({
        port: z.number().default(443),
        host: z.string().default(""),
      }),
    },
    init(ctx) {
      captured = ctx.settings as never;
    },
  });
  current = await createTestNextly(
    dialect === "sqlite"
      ? { plugins: [plugin] }
      : { dialect, plugins: [plugin] }
  );
  expect(captured).toBeDefined();
  return captured!;
}

describe.each(getConfiguredTestDialects())(
  "ctx.settings.set on %s",
  dialect => {
    it("commits the patch and reads it back", async () => {
      const settings = await bootSettings(dialect);

      await settings.set({ port: 8443 });

      expect((await settings.get()).port).toBe(8443);
    });

    it("stores and reads back a value of the largest size a setting may hold", async () => {
      // Stored as JSON, so the string's quotes are two of the bytes.
      const host = "h".repeat(MAX_SETTING_BYTES - 2);
      const settings = await bootSettings(dialect);

      await settings.set({ host });

      expect((await settings.get()).host).toBe(host);
    });

    it("refuses a value one byte larger, and keeps the stored one", async () => {
      // The control for the case above: a bound that admitted everything would
      // pass it, and so would a column that silently truncated.
      const settings = await bootSettings(dialect);
      await settings.set({ host: "kept" });

      await expect(
        settings.set({ host: "h".repeat(MAX_SETTING_BYTES - 1) })
      ).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({ path: "host", code: "TOO_LARGE" }),
          ],
        },
      });
      expect((await settings.get()).host).toBe("kept");
    });
  }
);
