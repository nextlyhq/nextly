/**
 * B2 / T5 — plugin subscriptions are idempotent across re-initialization (HMR).
 *
 * The EventBus + HookRegistry are `globalThis` singletons that survive Next.js
 * HMR module re-evaluation. Re-running a plugin's `init()` therefore used to
 * stack a *second* handler on top of the first, so the plugin double-fired —
 * which is why first-party plugins hand-rolled `globalThis` guards. The platform
 * now tracks each plugin's subscriptions and clears them before the plugin
 * re-initializes, so a hook fires exactly once per real operation regardless of
 * how many times `init()` runs. This test proves it WITHOUT any guard.
 *
 * It boots twice, preserving the global bus + hook registry between boots
 * (exactly what a real HMR reload preserves) via `hmrReset` — which mirrors the
 * `createTestNextly` teardown but deliberately skips `resetEventBus()` /
 * `resetHookRegistry()`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { registerServices, shutdownServices } from "../../di/register";
import { getNextly, resetNextlyInstance } from "../../direct-api/nextly";
import { resetEventBus } from "../../events/event-bus";
import { resetFilterRegistry } from "../../filters";
import { getHookRegistry, resetHookRegistry } from "../../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../init/schema-snapshot-cache";
import type { Logger } from "../../services/shared";
import { getImageProcessor } from "../../storage/image-processor";
import { definePlugin } from "../plugin-context";
import { resetPluginRouteRegistry } from "../routes/route-registry";
import { clearPluginSubscriptions } from "../subscription-tracker";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error(message, meta) {
    console.error(message, meta ?? "");
  },
};

const notes = () =>
  defineCollection({
    slug: "notes",
    fields: [text({ name: "title" })],
  });

async function freshAdapter() {
  process.env.DB_DIALECT = "sqlite";
  return createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
}

async function boot(
  adapter: Awaited<ReturnType<typeof createAdapter>>,
  plugins: Parameters<typeof registerServices>[0]["plugins"]
) {
  await registerServices({
    adapter,
    imageProcessor: getImageProcessor(),
    logger: silentLogger,
    hookRegistry: getHookRegistry(),
    plugins,
    collections: [notes()],
  });
}

/** Full teardown — clean slate for the next test. */
async function fullReset() {
  await shutdownServices();
  resetHookRegistry();
  resetEventBus();
  clearPluginSubscriptions();
  resetFilterRegistry();
  resetPluginRouteRegistry();
  resetNextlyInstance();
  clearCachedSnapshot();
  clearLiveSnapshots();
}

/**
 * HMR-style teardown: tears services down but PRESERVES the global event bus +
 * hook registry — exactly what survives a Next.js HMR reload. Re-running boot()
 * afterwards re-invokes plugin init() against the surviving registries.
 */
async function hmrReset() {
  await shutdownServices();
  resetFilterRegistry();
  resetPluginRouteRegistry();
  resetNextlyInstance();
  clearCachedSnapshot();
  clearLiveSnapshots();
  // Deliberately NOT resetHookRegistry()/resetEventBus(): the platform itself
  // must keep subscriptions idempotent across re-init.
}

afterEach(async () => {
  await fullReset();
});

describe("HMR idempotency (B2/T5)", () => {
  it("a plugin hook fires once per op even after re-initialization", async () => {
    await fullReset(); // clean start

    const counter = { n: 0 };
    const probe = definePlugin({
      name: "@probe/hmr",
      version: "1.0.0",
      nextly: ">=0.0.0",
      // No globalThis guard — the platform must make this idempotent.
      init(ctx) {
        ctx.hooks.on("afterCreate", "notes", () => {
          counter.n += 1;
        });
      },
    });

    const a1 = await freshAdapter();
    await boot(a1, [probe]);
    await getNextly().create({ collection: "notes", data: { title: "x" } });
    expect(counter.n).toBe(1);

    // Simulate HMR: tear services down but keep the global bus + hook registry,
    // then re-register (re-runs plugin init()).
    await hmrReset();
    const a2 = await freshAdapter();
    await boot(a2, [probe]);
    await getNextly().create({ collection: "notes", data: { title: "y" } });

    // Without the fix the stale handler also fires -> 3. With it -> 2.
    expect(counter.n).toBe(2);
  });
});
