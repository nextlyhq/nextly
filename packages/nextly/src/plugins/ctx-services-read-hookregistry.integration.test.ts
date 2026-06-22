/**
 * Regression: `ctx.services.collections` reads must work when the boot did NOT
 * pass a `hookRegistry` to `registerServices`.
 *
 * Both production boot paths (init.ts instrumentation + route-handler
 * `ensureServicesInitialized`) omit `hookRegistry`; only the `createTestNextly`
 * harness passed it. Before the fix, the collection read path resolved the hook
 * service to a stub and threw "this.hookService.hookRegistry.executeBeforeOperation
 * is not a function" — so every plugin route doing a read (redirects lookup, SEO
 * sitemap) 500'd in production while the SQLite harness stayed green. The fix
 * defaults `hookRegistry` to `getHookRegistry()` inside `registerServices`.
 *
 * This test deliberately boots WITHOUT a hookRegistry (the production shape) and
 * reads through `ctx.services` from a plugin `init`.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../collections/config/define-collection";
import { createAdapter } from "../database/factory";
import { registerServices, shutdownServices } from "../di/register";
import { resetNextlyInstance } from "../direct-api/nextly";
import { resetEventBus } from "../events/event-bus";
import { resetFilterRegistry } from "../filters";
import { resetHookRegistry } from "../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../init/schema-snapshot-cache";
import { getImageProcessor } from "../storage/image-processor";

import type { PluginDefinition } from "./plugin-context";
import { resetPluginRouteRegistry } from "./routes/route-registry";

function resetAll(): void {
  resetHookRegistry();
  resetEventBus();
  resetFilterRegistry();
  resetPluginRouteRegistry();
  resetNextlyInstance();
  clearCachedSnapshot();
  clearLiveSnapshots();
}

describe("ctx.services reads without an explicit hookRegistry (production boot)", () => {
  afterEach(async () => {
    await shutdownServices();
    resetAll();
  });

  it("does not throw 'executeBeforeOperation is not a function' — hookRegistry defaults to the global one", async () => {
    await shutdownServices();
    resetAll();

    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);

    let readError: unknown = null;
    let docs: unknown;
    const reader: PluginDefinition = {
      name: "@t/ctx-reader",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [
          {
            slug: "reg_read_probe",
            fields: [{ name: "title", type: "text" }],
          } as unknown as CollectionConfig,
        ],
      },
      init: async ctx => {
        try {
          const res = await ctx.services.collections.listEntries(
            "reg_read_probe",
            {},
            { as: "system" }
          );
          docs = res.data;
        } catch (err) {
          readError = err;
        }
      },
    };

    // NOTE: deliberately NO `hookRegistry` here — this is the production boot
    // shape that init.ts / ensureServicesInitialized use. The fix makes
    // registerServices default it; without the fix the read below throws.
    await registerServices({
      adapter,
      imageProcessor: getImageProcessor(),
      logger: {
        debug() {},
        info() {},
        warn() {},
        error(message, meta) {
          console.error(message, meta ?? "");
        },
      },
      plugins: [reader],
    } as unknown as Parameters<typeof registerServices>[0]);

    expect(readError).toBeNull();
    expect(Array.isArray(docs)).toBe(true);
  });
});
