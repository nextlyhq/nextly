import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { NextlyServiceConfig } from "../../di/register";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("enabled:false behavior-skip (D49)", () => {
  it("skips init for a disabled plugin but still runs its setup (schema kept)", async () => {
    let disabledInit = false;
    let enabledInit = false;

    const disabled = definePlugin({
      name: "@test/disabled",
      version: "1.0.0",
      nextly: ">=0.0.0",
      enabled: false,
      setup(config) {
        return {
          ...config,
          collections: [
            ...(config.collections ?? []),
            defineCollection({
              slug: "disabledthings",
              fields: [text({ name: "title" })],
            }),
          ],
        };
      },
      init() {
        disabledInit = true;
      },
    });

    const enabled = definePlugin({
      name: "@test/enabled",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init() {
        enabledInit = true;
      },
    });

    current = await createTestNextly({ plugins: [disabled, enabled] });

    // Behavior skipped for the disabled plugin, but the enabled one ran.
    expect(disabledInit).toBe(false);
    expect(enabledInit).toBe(true);

    // Schema contribution still applied — the disabled plugin's setup ran,
    // so its collection is present in the booted config (D49).
    const cfg = current.getService("config") as NextlyServiceConfig;
    expect(cfg.collections?.some(c => c.slug === "disabledthings")).toBe(true);
  });
});
