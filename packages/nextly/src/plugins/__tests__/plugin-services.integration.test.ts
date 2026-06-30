/**
 * C1 + C5 — custom plugin services, end-to-end.
 *
 * A plugin contributes a service factory; another plugin consumes it via
 * `ctx.services.plugins.<name>.<svc>`, and app code reaches the same instance via
 * `nextly.plugins.<name>.<svc>`. Resolution is lazy (factory runs once, on first
 * access).
 */
import { afterEach, describe, expect, it } from "vitest";

import { getNextly } from "../../direct-api/nextly";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("plugin custom services", () => {
  it("one plugin consumes another's service; app reaches the same via nextly.plugins", async () => {
    const observed: { fromB?: string } = {};

    const a = definePlugin({
      name: "@test/svc-a",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        services: { greeter: () => ({ hi: () => "hi from A" }) },
      },
    });
    const b = definePlugin({
      name: "@test/svc-b",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        const greeter = ctx.services.plugins["@test/svc-a"]?.greeter as
          | { hi: () => string }
          | undefined;
        observed.fromB = greeter?.hi();
      },
    });

    current = await createTestNextly({ plugins: [a, b] });
    expect(observed.fromB).toBe("hi from A");

    const greeter = getNextly().plugins["@test/svc-a"]?.greeter as {
      hi: () => string;
    };
    expect(greeter.hi()).toBe("hi from A");
  });

  it("instantiates a contributed service at most once (singleton)", async () => {
    let constructed = 0;
    const a = definePlugin({
      name: "@test/svc-once",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        services: {
          counter: () => {
            constructed += 1;
            return { n: constructed };
          },
        },
      },
    });

    current = await createTestNextly({ plugins: [a] });
    const n = getNextly();
    const s1 = n.plugins["@test/svc-once"].counter;
    const s2 = n.plugins["@test/svc-once"].counter;
    expect(s1).toBe(s2);
    expect(constructed).toBe(1);
  });
});
