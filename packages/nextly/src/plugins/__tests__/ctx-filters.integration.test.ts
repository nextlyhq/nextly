import { afterEach, describe, expect, it } from "vitest";

import { getFilterRegistry, resetFilterRegistry } from "../../filters";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

describe("ctx.filters + ctx.actions wired to FilterRegistry (D63)", () => {
  it("ctx.filters.add registers a filter on the global FilterRegistry", async () => {
    current = await createTestNextly({
      plugins: [
        definePlugin({
          name: "@test/filter-plugin",
          version: "1.0.0",
          nextly: ">=0.0.0",
          init(ctx) {
            ctx.filters.add("test.seam", (v: number) => v + 1);
          },
        }),
      ],
    });

    expect(getFilterRegistry().hasFilters("test.seam")).toBe(true);
  });

  it("ctx.actions.add registers an action on the global FilterRegistry", async () => {
    current = await createTestNextly({
      plugins: [
        definePlugin({
          name: "@test/action-plugin",
          version: "1.0.0",
          nextly: ">=0.0.0",
          init(ctx) {
            ctx.actions.add("test.action", () => {});
          },
        }),
      ],
    });

    expect(getFilterRegistry().hasActions("test.action")).toBe(true);
  });

  it("ctx.filters.apply threads the value through registered filters", async () => {
    let appliedResult: number | undefined;

    current = await createTestNextly({
      plugins: [
        definePlugin({
          name: "@test/apply-plugin",
          version: "1.0.0",
          nextly: ">=0.0.0",
          async init(ctx) {
            ctx.filters.add("test.seam", (v: number) => v + 1);
            appliedResult = await ctx.filters.apply("test.seam", 1, {});
          },
        }),
      ],
    });

    expect(appliedResult).toBe(2);
  });
});
