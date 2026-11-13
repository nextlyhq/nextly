/**
 * A boot settles every owned template's engine from one read of the engine
 * marks, on every dialect: the number of `nextly_meta` reads a boot makes is
 * the same for one plugin template as for six, and at most one. Each
 * template used to read whether Liquid is adopted and then its own mark, two
 * reads of the meta table one after the other, at every start.
 */
import { afterEach, expect, it } from "vitest";

import { recordStatements } from "../../../__tests__/helpers/record-statements";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { EmailTemplateService } from "../services/email-template-service";

import { silentLogger } from "./template-ownership-fixture";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** `count` templates of one plugin, each with its own slug. */
function ordersTemplates(count: number): PluginEmailTemplate[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `orders-${index}`,
    name: `Order step ${index}`,
    subject: `Order update ${index}`,
    htmlContent: `<p>Hi {{name}}, step ${index} of your order is done.</p>`,
  }));
}

describeEachDialect("engine marks at boot", dialect => {
  /** A boot of a new instance's template service with the plugin's `templates`. */
  async function boot(
    t: TestNextly,
    templates: PluginEmailTemplate[]
  ): Promise<void> {
    const fresh = new EmailTemplateService(t.adapter, silentLogger);
    fresh.configureOwnership({
      plugins: [{ name: "@acme/plugin-orders", templates }],
    });
    await fresh.ensureBuiltInTemplates();
  }

  /** How many reads of `nextly_meta` a second boot with `templates` makes. */
  async function metaReadsOfSecondBoot(
    on: TestDialect,
    templates: PluginEmailTemplate[]
  ): Promise<number> {
    await current?.destroy();
    current = await createTestNextly({ dialect: on });
    // The first boot seeds the rows and records the switch to Liquid.
    await boot(current, templates);
    const recorder = await recordStatements(current.adapter, on);
    try {
      await boot(current, templates);
    } finally {
      recorder.uninstall();
    }
    return recorder.statements.filter(
      text =>
        /^\s*select\b/i.test(text) &&
        /\bfrom\s+["`]?nextly_meta["`]?/i.test(text)
    ).length;
  }

  it("reads the engine marks once, however many templates it settles", async () => {
    const one = await metaReadsOfSecondBoot(dialect, ordersTemplates(1));
    const six = await metaReadsOfSecondBoot(dialect, ordersTemplates(6));

    // Read at all, so the counts below are of a boot that consulted them.
    expect(one).toBeGreaterThan(0);
    expect(six).toBe(one);
    expect(six).toBeLessThanOrEqual(1);
  });
});
