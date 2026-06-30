/**
 * T3 — multi-plugin interaction via custom services.
 *
 * Plugin B `optionalDependsOn` Plugin A and consumes A's contributed service
 * when present, degrading gracefully (no throw) when A is absent/disabled.
 */
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const providerA = () =>
  definePlugin({
    name: "@test/provider-a",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      services: {
        translate: () => ({ upper: (s: string) => s.toUpperCase() }),
      },
    },
  });

interface Observed {
  result?: string;
  degraded?: boolean;
}

const consumerB = (out: Observed) =>
  definePlugin({
    name: "@test/consumer-b",
    version: "1.0.0",
    nextly: ">=0.0.0",
    optionalDependsOn: { "@test/provider-a": ">=1.0.0" },
    init(ctx) {
      const translate = ctx.services.plugins["@test/provider-a"]?.translate as
        | { upper: (s: string) => string }
        | undefined;
      if (translate) {
        out.result = translate.upper("hi");
      } else {
        out.degraded = true;
        out.result = "hi"; // fallback path
      }
    },
  });

describe("multi-plugin interaction via ctx.services.plugins (T3)", () => {
  it("B consumes A's service when A is present", async () => {
    const out: Observed = {};
    current = await createTestNextly({
      plugins: [providerA(), consumerB(out)],
    });
    expect(out.result).toBe("HI");
    expect(out.degraded).toBeUndefined();
  });

  it("B degrades gracefully when A is absent", async () => {
    const out: Observed = {};
    current = await createTestNextly({ plugins: [consumerB(out)] });
    expect(out.degraded).toBe(true);
    expect(out.result).toBe("hi");
  });
});
