/**
 * `ctx.db.transaction` on the default (sqlite) boot: the work commits as one
 * unit and rolls back as one unit.
 *
 * Drizzle's better-sqlite3 transaction refuses an async callback, so the
 * restricted handle runs the work through the adapter's BEGIN IMMEDIATE
 * runner. That only holds if the builder writes on the connection the runner
 * opened, which a fake cannot show — so this writes through the context the
 * runtime builds, into a real table.
 */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { nextlyPluginSettings } from "../../schemas/plugin-settings/sqlite";
import {
  definePlugin,
  type PluginDatabase,
  type PluginSettingsApi,
} from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OWNER = "@test/tx-owner";

function row(key: string) {
  return {
    owner: OWNER,
    key,
    value: '"v"',
    isSecret: false,
    updatedAt: new Date(),
    updatedBy: null,
  };
}

async function bootWithDb(): Promise<PluginDatabase> {
  let db: PluginDatabase | undefined;
  const plugin = definePlugin({
    name: "@test/tx",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      db = ctx.db;
    },
  });
  current = await createTestNextly({ plugins: [plugin] });
  if (!db) throw new Error("the plugin's init did not run");
  return db;
}

async function keysStored(db: PluginDatabase): Promise<string[]> {
  const rows = (await db
    .select({ key: nextlyPluginSettings.key } as never)
    .from(nextlyPluginSettings)
    .where(eq(nextlyPluginSettings.owner, OWNER))) as Array<{ key: string }>;
  return rows.map(r => r.key).sort();
}

describe("ctx.db.transaction on sqlite", () => {
  it("commits every write the work made", async () => {
    const db = await bootWithDb();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await tx.insert(nextlyPluginSettings).values(row("b"));
    });

    expect(await keysStored(db)).toEqual(["a", "b"]);
  });

  it("rolls back every write when the work throws", async () => {
    const db = await bootWithDb();

    await expect(
      db.transaction(async tx => {
        await tx.insert(nextlyPluginSettings).values(row("a"));
        throw new Error("second step failed");
      })
    ).rejects.toThrow("second step failed");

    expect(await keysStored(db)).toEqual([]);
  });
});

describe("a core write inside ctx.db.transaction on sqlite", () => {
  async function bootWithSettings(): Promise<{
    db: PluginDatabase;
    settings: PluginSettingsApi;
  }> {
    let captured:
      | { db: PluginDatabase; settings: PluginSettingsApi }
      | undefined;
    const plugin = definePlugin({
      name: "@test/tx-settings",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        settings: z.object({ port: z.number().default(443) }),
      },
      init(ctx) {
        captured = { db: ctx.db, settings: ctx.settings as PluginSettingsApi };
      },
    });
    current = await createTestNextly({ plugins: [plugin] });
    if (!captured) throw new Error("the plugin's init did not run");
    return captured;
  }

  it("completes instead of waiting on the transaction it is inside", async () => {
    // The settings store opens its own adapter transaction; queued behind
    // the plugin's, it hung both and every later write on the instance.
    const { db, settings } = await bootWithSettings();

    await db.transaction(async tx => {
      await tx.insert(nextlyPluginSettings).values(row("a"));
      await settings.set({ port: 8443 });
    });

    expect(await keysStored(db)).toEqual(["a"]);
    expect((await settings.get()).port).toBe(8443);
  });

  it("is rolled back with the transaction it ran inside", async () => {
    const { db, settings } = await bootWithSettings();

    await expect(
      db.transaction(async () => {
        await settings.set({ port: 8443 });
        throw new Error("later step failed");
      })
    ).rejects.toThrow("later step failed");

    expect((await settings.get()).port).toBe(443);
  });
});
