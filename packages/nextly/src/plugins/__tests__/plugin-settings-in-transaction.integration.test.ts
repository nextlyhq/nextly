/**
 * A plugin's `ctx.settings.set` inside its own `ctx.db.transaction` is refused,
 * with an error that names the call and the fix.
 *
 * A setting is not written through the plugin's transaction handle, so it
 * cannot be part of that transaction everywhere: on PostgreSQL and MySQL it
 * would commit on a connection of its own and survive the transaction's
 * rollback, and on SQLite it would join as a savepoint and roll back with it.
 * One call meaning two things by dialect is refused instead, as one-time
 * secrets and limits already are: the plugin writes the setting after its
 * transaction.
 *
 * The control writes the same setting once the transaction has committed,
 * so the refusal is the transaction's, not a write that fails anyway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { definePlugin, type PluginContext } from "../plugin-context";
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

interface Settings {
  get: () => Promise<{ port: number }>;
  set: (patch: Record<string, unknown>) => Promise<void>;
}

/** Boot one plugin with settings on `dialect`; its context and settings. */
async function boot(
  dialect: TestDialect
): Promise<{ ctx: PluginContext; settings: Settings }> {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name: "@test/settings-in-transaction",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      settings: z.object({ port: z.number().default(443) }),
    },
    init(ctx) {
      captured = ctx;
    },
  });
  current = await createTestNextly(
    dialect === "sqlite"
      ? { plugins: [plugin] }
      : { dialect, plugins: [plugin] }
  );
  if (!captured?.settings) throw new Error("the plugin's init did not run");
  return { ctx: captured, settings: captured.settings as unknown as Settings };
}

describe.each(getConfiguredTestDialects())(
  "ctx.settings.set inside the plugin's transaction (integration, %s)",
  dialect => {
    it("is refused, naming the call and the fix, and stores nothing", async () => {
      const { ctx, settings } = await boot(dialect);

      let refused: unknown;
      await ctx.db
        .transaction(async () => {
          await settings.set({ port: 8443 });
        })
        .catch((error: unknown) => {
          refused = error;
        });

      expect(refused).toBeInstanceOf(NextlyError);
      const logMessage = (refused as NextlyError).logMessage ?? "";
      expect(logMessage).toContain("ctx.settings.set");
      expect(logMessage).toContain("after it has finished");
      expect((await settings.get()).port).toBe(443);
    });

    it("stores the setting written after the transaction has committed", async () => {
      const { ctx, settings } = await boot(dialect);

      await ctx.db.transaction(async () => {});
      await settings.set({ port: 8443 });

      expect((await settings.get()).port).toBe(8443);
    });
  }
);
