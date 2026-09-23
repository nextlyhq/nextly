/**
 * A plugin's `ctx.settings.set` must commit on SQLite.
 *
 * Drizzle's better-sqlite3 transaction callback is synchronous by driver
 * design, so the store's Drizzle-transaction path fails every awaited write
 * with "Transaction function cannot return a promise". SQLite writes ride
 * the adapter's manual BEGIN IMMEDIATE runner instead — this is the boot a
 * plugin actually takes, writing through the context the runtime builds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("ctx.settings.set on the default (sqlite) boot", () => {
  it("commits the patch and reads it back", async () => {
    let captured:
      | {
          get: () => Promise<{ port: number; host: string }>;
          set: (patch: Record<string, unknown>) => Promise<void>;
        }
      | undefined;

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

    current = await createTestNextly({ plugins: [plugin] });
    expect(captured).toBeDefined();

    await captured!.set({ port: 8443 });
    const settings = await captured!.get();
    expect(settings.port).toBe(8443);
  });
});
