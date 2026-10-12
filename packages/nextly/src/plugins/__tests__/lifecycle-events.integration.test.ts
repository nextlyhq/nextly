/**
 * `plugin.initialized`, emitted after each plugin's init and observable by
 * other plugins, on every configured dialect's boot.
 */
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "plugin.initialized lifecycle event (%s)",
  dialect => {
    it("emits plugin.initialized after each plugin's init, observable by other plugins", async () => {
      const received: string[] = [];

      const observer = definePlugin({
        name: "@test/observer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx) {
          ctx.events.on<{ name: string }>("plugin.initialized", e => {
            received.push(e.payload.name);
          });
        },
      });

      const later = definePlugin({
        name: "@test/later",
        version: "1.0.0",
        nextly: ">=0.0.0",
        dependsOn: { "@test/observer": ">=1.0.0" },
        init() {},
      });

      // Topo order makes observer init (and subscribe) before later inits.
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [later, observer] }
          : { dialect, plugins: [later, observer] }
      );
      await current.events.settle();

      expect(received).toContain("@test/later");
    });
  }
);
