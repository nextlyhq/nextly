/**
 * `req.nextly` is bound for hooks from the moment services are registered.
 *
 * The handle resolved through a container binding that `getNextly()` created as
 * a side effect of its FIRST call. A process that never called it therefore
 * handed every hook `undefined` — and a REST or admin write does not call it,
 * so the handle the collections guide's own example reads was absent on exactly
 * the paths hooks run on most.
 *
 * Asserted against a production-shaped boot, and — since the harness stopped
 * resolving the Direct API while building its return value — through the
 * ordinary `createTestNextly` harness as well. The harness case is the one that
 * matters for everything written afterwards: while it called `getNextly()`
 * eagerly, the binding existed under it whatever the code did, so a test
 * written there could not fail.
 */

import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import { registerServices, shutdownServices } from "../../../di/register";
import {
  isNextlyInstantiated,
  resetNextlyInstance,
} from "../../../direct-api/nextly";
import { resetEventBus } from "../../../events/event-bus";
import { resetFilterRegistry } from "../../../filters";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { resetPluginRouteRegistry } from "../../../plugins/routes/route-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
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

describe("the ordinary test harness leaves the binding to service registration", () => {
  let current: TestNextly | undefined;

  afterEach(async () => {
    await current?.destroy();
    current = undefined;
    resetAll();
  });

  it("boots without resolving the Direct API, and binds it anyway", async () => {
    await shutdownServices();
    resetAll();

    // The controls: nothing in this process has resolved the Direct API or
    // bound it, so neither observation below can be left over from earlier.
    expect(isNextlyInstantiated()).toBe(false);
    expect(container.has("nextlyDirectAPI")).toBe(false);

    current = await createTestNextly({ dialect: "sqlite" });

    // The binding exists, and the harness is not what created it. Checking the
    // binding alone would not say that: service registration binds it before
    // the harness assembles its return value, so `container.has(...)` is true
    // whether the harness resolves the Direct API or not, and a guard reading
    // only that stays green if the harness goes back to resolving it eagerly.
    // Whether the singleton was BUILT is the independent observation, because
    // that is what an eager `getNextly()` does and a lazy property does not.
    expect(isNextlyInstantiated()).toBe(false);
    expect(container.has("nextlyDirectAPI")).toBe(true);

    // The mirror: reading the property does resolve it, so the assertion above
    // reflects the boot rather than the Direct API being unreachable.
    expect(current.nextly).toBeDefined();
    expect(isNextlyInstantiated()).toBe(true);
  });

  it("keeps `nextly` assignable, as the declared type allows", async () => {
    // `TestNextly.nextly` is not readonly, so `handle.nextly = stub` compiles
    // and did work while the property was a plain data property. A getter with
    // no setter would make that same code throw under the strict mode ES
    // modules run in, which is a silent break for any suite that stubs it.
    current = await createTestNextly({ dialect: "sqlite" });

    const stub = { marker: "stubbed" } as unknown as typeof current.nextly;
    current.nextly = stub;

    expect(current.nextly).toBe(stub);
  });
});
