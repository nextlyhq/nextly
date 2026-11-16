/**
 * Two instances making the first boot on Liquid at once: the one that finds
 * the other has already recorded the switch takes the marks that instance
 * wrote with it, on every configured dialect. Its boot read the marks before
 * the other wrote them, so adding only the switch to that read would render
 * a template the other kept on the old engine as Liquid.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { EmailTemplateService } from "../services/email-template-service";

import { silentLogger } from "./template-ownership-fixture";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** Store a template as an install before Liquid did, straight into the table. */
async function storeAsBefore(
  t: TestNextly,
  dialect: TestDialect,
  slug: string,
  htmlContent: string
): Promise<void> {
  const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
  const p = (i: number) => (dialect === "postgresql" ? `$${i}` : "?");
  const columns = [
    "id",
    "name",
    "slug",
    "subject",
    "html_content",
    "kind",
    "use_layout",
    "is_active",
    "created_at",
    "updated_at",
  ];
  // Stored well before the boot, as a template from before Liquid is: a
  // render then trusts the instance's engine state rather than reading it
  // again for a row written after the state was read.
  const now = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await t.adapter.executeQuery(
    `INSERT INTO ${q("email_templates")} (${columns.map(q).join(", ")}) VALUES (${columns.map((_, i) => p(i + 1)).join(", ")})`,
    [
      randomUUID(),
      slug,
      slug,
      "Hello {{name}}",
      htmlContent,
      "template",
      dialect === "postgresql" ? false : 0,
      dialect === "postgresql" ? true : 1,
      now,
      now,
    ]
  );
}

/** A new instance's template service, with every owner listed. */
function instance(t: TestNextly): EmailTemplateService {
  const service = new EmailTemplateService(t.adapter, silentLogger);
  service.configureOwnership({ plugins: [] });
  return service;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`first boot on Liquid by two instances — ${dialect}`, () => {
    it("keeps on the old engine what the other instance kept", async () => {
      const t = (current = await createTestNextly({ dialect }));
      await storeAsBefore(
        t,
        dialect,
        "literal-if",
        "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>"
      );
      const late = instance(t);
      const early = instance(t);

      // The late instance's boot has read the marks (none yet) and is
      // scanning the stored templates when it first asks the table whether
      // the switch is recorded. The early instance completes its whole
      // first boot just then, keeping `literal-if` and recording the switch.
      const inTable = late as unknown as {
        liquidAdoptedInTable: () => Promise<boolean | null>;
      };
      const original = inTable.liquidAdoptedInTable.bind(late);
      let raced = false;
      vi.spyOn(inTable, "liquidAdoptedInTable").mockImplementation(async () => {
        if (!raced) {
          raced = true;
          await early.ensureBuiltInTemplates();
        }
        return original();
      });
      await late.ensureBuiltInTemplates();
      expect(raced).toBe(true);

      const literalIf = (await late.getTemplateBySlug("literal-if"))!;
      const data = { name: "Ada", vip: true };
      // What the early instance recorded: kept on the old engine.
      expect(
        (await early.keptOnOldEngineIds([literalIf])).has(literalIf.id)
      ).toBe(true);
      // A send from either instance renders it the same way: on the engine
      // the switch kept it on, not as Liquid.
      const fromEarly = await early.renderStored(literalIf, data);
      const fromLate = await late.renderStored(literalIf, data);
      expect(fromEarly.html).toContain("{% if vip %}");
      expect(fromLate.html).toBe(fromEarly.html);
    }, 120_000);
  });
}
