/**
 * Raw SQL is what the boot granted, at every place a plugin context is built.
 *
 * The boot decides which plugins hold `capabilities.db.rawSql` once, when it
 * resolves the plugin list. The contexts it builds for `init`, and the ones
 * the auth router builds lazily for a plugin's auth hooks, read that decision
 * rather than the plugin's manifest. A plugin whose own code turns the
 * capability on after the boot, by editing the definition the container
 * holds, must not find the live handle in the context its auth hook runs in.
 *
 * SQLite only: the decision is made before any query, and nothing about it
 * depends on the dialect the handle would reach.
 */
import { afterEach, expect, it } from "vitest";

import { buildAuthRouterDeps } from "../../auth/handlers/deps-bridge";
import { getService } from "../../di/register";
import type { AuthUserId } from "../../types/auth";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let handle: TestNextly | undefined;
afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/** What `typeof ctx.db.raw.run` was in each place a plugin looked. */
type Seen = { init?: string; hook?: string };

/** A plugin that records whether `run` is on its raw handle, in init and in an auth hook. */
function recording(
  seen: Seen,
  plugin: Pick<PluginDefinition, "name" | "capabilities"> & {
    init?: () => void;
  }
): PluginDefinition {
  return {
    version: "1.0.0",
    nextly: ">=0.0.1",
    ...plugin,
    init: ctx => {
      seen.init = typeof (ctx.db.raw as { run?: unknown }).run;
      plugin.init?.();
    },
    contributes: {
      auth: {
        hooks: {
          afterAuthenticate: (user, ctx) => {
            seen.hook = typeof (ctx.db.raw as { run?: unknown }).run;
            return user;
          },
        },
      },
    },
  };
}

/** Run the auth router's after-authenticate hooks once. */
async function authenticate(booted: TestNextly): Promise<void> {
  const deps = buildAuthRouterDeps(
    booted.getService as (name: string) => unknown
  );
  await deps.authHooks.runAfterAuthenticate(
    { id: "u1" as AuthUserId, email: "a@example.com" },
    deps.pluginCtx
  );
}

it("does not hand an auth hook raw SQL a plugin turned on after the boot", async () => {
  const seen: Seen = {};
  const plugin = recording(seen, {
    name: "@evil/late",
    init: () => {
      // The definition the container holds, reached as any plugin code can
      // reach the container, and given the capability after resolution.
      const config = getService("config") as {
        plugins?: PluginDefinition[];
      };
      const self = config.plugins?.find(entry => entry.name === "@evil/late");
      if (self) self.capabilities = { db: { rawSql: true } };
    },
  });

  handle = await createTestNextly({ plugins: [plugin] });
  await authenticate(handle);

  expect(seen).toEqual({ init: "undefined", hook: "undefined" });
});

it("hands an auth hook raw SQL the boot granted", async () => {
  const seen: Seen = {};
  const plugin = recording(seen, {
    name: "@acme/reports",
    capabilities: { db: { rawSql: true } },
  });

  handle = await createTestNextly({
    plugins: [plugin],
    pluginConsent: { rawSql: ["@acme/reports"] },
  });
  await authenticate(handle);

  expect(seen).toEqual({ init: "function", hook: "function" });
});

it("names the pluginConsent option when createTestNextly refuses a plugin", async () => {
  const reports = recording(
    {},
    { name: "@acme/reports", capabilities: { db: { rawSql: true } } }
  );

  const refused = await createTestNextly({
    plugins: [reports],
    pluginConsent: { rawSql: ["@acme/other"] },
  }).catch((error: unknown) => error);

  expect(refused).toMatchObject({
    logContext: {
      reason: "capability-not-listed",
      testOption: 'pluginConsent: { rawSql: ["@acme/other", "@acme/reports"] }',
    },
  });
  expect((refused as { logMessage?: string }).logMessage).toContain(
    'Under createTestNextly the app\'s listing is its pluginConsent option: pass pluginConsent: { rawSql: ["@acme/other", "@acme/reports"] }.'
  );
});
