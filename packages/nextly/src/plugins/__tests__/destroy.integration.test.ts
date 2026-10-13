import { afterEach, describe, expect, it } from "vitest";

import { defineConfig } from "../../collections/config/define-config";
import { clearServices, registerServices } from "../../di/register";
import { getNextly } from "../../init";
import { getImageProcessor } from "../../storage/image-processor";
import { definePlugin, type PluginDefinition } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("plugin destroy() on shutdown", () => {
  it("runs destroy in reverse init order, skipping disabled plugins", async () => {
    const order: string[] = [];
    const a = definePlugin({
      name: "@test/d-a",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {},
      destroy() {
        order.push("a");
      },
    });
    const b = definePlugin({
      name: "@test/d-b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/d-a": ">=1.0.0" },
      init() {},
      destroy() {
        order.push("b");
      },
    });
    const disabled = definePlugin({
      name: "@test/d-disabled",
      version: "1.0.0",
      nextly: ">=0.0.0",
      enabled: false,
      destroy() {
        order.push("disabled");
      },
    });

    current = await createTestNextly({ plugins: [a, b, disabled] });
    await current.destroy();
    current = undefined; // already torn down

    // Init order is [a, b]; destroy runs in reverse and skips the disabled one.
    expect(order).toEqual(["b", "a"]);
  });

  it("isolates a throwing destroy so the others still run and shutdown completes", async () => {
    const order: string[] = [];
    const safe = definePlugin({
      name: "@test/d-safe",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {},
      destroy() {
        order.push("safe");
      },
    });
    const boom = definePlugin({
      name: "@test/d-boom",
      version: "1.0.0",
      nextly: ">=0.0.0",
      dependsOn: { "@test/d-safe": ">=1.0.0" },
      init() {},
      destroy() {
        throw new Error("destroy boom");
      },
    });

    const t = await createTestNextly({ plugins: [safe, boom] });
    // boom destroys first (reverse order) and throws; shutdown must not reject.
    await expect(t.destroy()).resolves.toBeUndefined();
    expect(order).toEqual(["safe"]);
  });
});

/**
 * Two plugins, the second depending on the first, that record each init and
 * each destroy in one shared list, so the order across both is observable.
 */
function recordingPair(order: string[]): PluginDefinition[] {
  const a = definePlugin({
    name: "@test/r-a",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init() {
      order.push("init a");
    },
    destroy() {
      order.push("destroy a");
    },
  });
  const b = definePlugin({
    name: "@test/r-b",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { "@test/r-a": ">=1.0.0" },
    init() {
      order.push("init b");
    },
    destroy() {
      order.push("destroy b");
    },
  });
  return [a, b];
}

describe("plugin destroy() when services are registered again", () => {
  it("tears down the previous registration's plugins, in reverse, before any plugin initialises again", async () => {
    const order: string[] = [];
    const plugins = recordingPair(order);
    current = await createTestNextly({ plugins });

    // Re-registration as `registerServices` tells a caller to do it: clear,
    // then register again. The adapter stays connected across the two, so
    // the earlier plugins' teardown can still reach the database.
    clearServices();
    await registerServices({
      adapter: current.adapter,
      imageProcessor: getImageProcessor(),
      plugins,
    });

    expect(order).toEqual([
      "init a",
      "init b",
      "destroy b",
      "destroy a",
      "init a",
      "init b",
    ]);
  });
});

describe("plugin destroy() through nextly.shutdown()", () => {
  it("runs destroy in reverse init order", async () => {
    const order: string[] = [];
    current = await createTestNextly({ plugins: recordingPair(order) });

    // The public handle over the registration the harness just made: with
    // services already registered, `getNextly` builds its instance on them
    // rather than registering again, so its `shutdown()` is the one an
    // application calls.
    const nextly = await getNextly({ config: defineConfig({}) });
    await nextly.shutdown();

    expect(order).toEqual(["init a", "init b", "destroy b", "destroy a"]);
  });
});
