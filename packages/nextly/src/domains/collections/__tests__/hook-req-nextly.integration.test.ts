/**
 * `req.nextly` is bound for hooks from the moment services are registered.
 *
 * The handle resolved through a container binding that `getNextly()` created as
 * a side effect of its FIRST call. A process that never called it therefore
 * handed every hook `undefined` — and a REST or admin write does not call it,
 * so the handle the collections guide's own example reads was absent on exactly
 * the paths hooks run on most.
 *
 * Asserted against a production-shaped boot rather than the `createTestNextly`
 * harness. That harness calls `getNextly()` while building its return value, so
 * the binding always exists under it and a test written there cannot fail no
 * matter what the code does.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import { registerServices, shutdownServices } from "../../../di/register";
import { resetNextlyInstance } from "../../../direct-api/nextly";
import { resetEventBus } from "../../../events/event-bus";
import { resetFilterRegistry } from "../../../filters";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { resetPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import { getImageProcessor } from "../../../storage/image-processor";

function resetAll(): void {
  resetHookRegistry();
  resetEventBus();
  resetFilterRegistry();
  resetPluginRouteRegistry();
  resetNextlyInstance();
  clearCachedSnapshot();
  clearLiveSnapshots();
}

async function bootLikeProduction(): Promise<void> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);

  await registerServices({
    adapter,
    imageProcessor: getImageProcessor(),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as unknown as Parameters<typeof registerServices>[0]);
}

describe("the Direct API is bound for hook contexts at boot", () => {
  afterEach(async () => {
    await shutdownServices();
    resetAll();
  });

  it("binds nextlyDirectAPI during registerServices, before anything calls getNextly", async () => {
    await shutdownServices();
    resetAll();

    // The control: nothing has resolved the Direct API yet, so a binding found
    // below cannot be left over from an earlier call in this process.
    expect(container.has("nextlyDirectAPI")).toBe(false);

    await bootLikeProduction();

    expect(container.has("nextlyDirectAPI")).toBe(true);
  });

  it("resolves to a usable Direct API without a prior getNextly call", async () => {
    // A binding that cannot produce a working instance is no better than an
    // absent one, so this resolves it and checks the surface a hook would use.
    await shutdownServices();
    resetAll();
    await bootLikeProduction();

    const resolved = container.get("nextlyDirectAPI") as
      | { create?: unknown; find?: unknown }
      | undefined;

    expect(resolved).toBeDefined();
    expect(typeof resolved?.create).toBe("function");
  });
});
