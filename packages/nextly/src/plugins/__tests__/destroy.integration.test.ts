import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
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
