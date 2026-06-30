import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("contributes.events declared names", () => {
  it("registers contributes.events so a plugin's custom emits don't warn", async () => {
    const warnings: string[] = [];
    const received: unknown[] = [];

    const plugin = definePlugin({
      name: "billing",
      version: "0.0.1",
      nextly: ">=0.0.2-alpha.21",
      contributes: { events: [{ name: "billing.charged" }] },
      init(ctx) {
        ctx.events.setLogger({ warn: (m: string) => warnings.push(m) });
        ctx.events.on("billing.charged", e => received.push(e.payload));
        ctx.events.emit("billing.charged", { amount: 10 });
      },
    });

    current = await createTestNextly({ plugins: [plugin] });
    await current.events.settle();

    expect(warnings.filter(w => w.includes("billing.charged"))).toEqual([]);
    expect(received).toEqual([{ amount: 10 }]);
  });
});
