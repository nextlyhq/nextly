/**
 * The ownership steps through the module-level `nextly.emailTemplates`
 * facade, on a booted instance, on every configured dialect: the methods are
 * forwarded, not only declared.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { nextly } from "../../../direct-api/nextly";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const orders = definePlugin({
  name: "@acme/plugin-orders",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailTemplates: [
      {
        slug: "orders-paid",
        name: "Order paid",
        subject: "Paid",
        htmlContent: "<p>Thanks, {{name}}.</p>",
      },
    ],
  },
} as never);

for (const dialect of getConfiguredTestDialects()) {
  describe(`template ownership through the module facade — ${dialect}`, () => {
    it("overrides, compares, applies, undoes and resets", async () => {
      current = await createTestNextly({ dialect, plugins: [orders] });
      // The boot reconciliation, which reads the plugins from the config.
      await (
        current.getService("emailTemplateService") as unknown as {
          ensureBuiltInTemplates(): Promise<void>;
        }
      ).ensureBuiltInTemplates();
      const found = await nextly.emailTemplates.findBySlug({
        slug: "orders-paid",
      });
      const id = found!.id;

      const overridden = await nextly.emailTemplates.override({ id });
      expect(overridden.item.overridden).toBe(true);

      const comparison = await nextly.emailTemplates.compare({ id });
      expect(comparison.changes).toEqual([]);

      const { undo } = await nextly.emailTemplates.applyUpdate({
        id,
        choices: {},
        review: comparison.review,
      });
      const undone = await nextly.emailTemplates.undoUpdate({ id, undo });
      expect(undone.item.overridden).toBe(true);

      const reset = await nextly.emailTemplates.reset({ id });
      expect(reset.item.overridden).toBe(false);
    });
  });
}
