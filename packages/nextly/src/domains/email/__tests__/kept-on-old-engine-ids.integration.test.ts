/**
 * `keptOnOldEngineIds` answers for a whole list what `oldEngineStatus`
 * answers for one template, on every configured dialect, and reads the meta
 * table once however long the list is.
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
import type { EmailTemplateService } from "../services/email-template-service";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

/**
 * Store a template as an install before Liquid did, straight into the table:
 * what some of these hold no longer passes the save-time check.
 */
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
  const now = new Date();
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

/** What `oldEngineStatus` says of each template, one at a time. */
async function onePerTemplate(service: EmailTemplateService) {
  const kept = new Set<string>();
  for (const template of await service.listTemplates()) {
    if ((await service.oldEngineStatus(template.id)).kept) {
      kept.add(template.id);
    }
  }
  return kept;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`keptOnOldEngineIds — ${dialect}`, () => {
    it("agrees with oldEngineStatus for every template, before and after the switch is recorded", async () => {
      const t = (current = await createTestNextly({ dialect }));
      await storeAsBefore(
        t,
        dialect,
        "literal-if",
        "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>"
      );
      await storeAsBefore(t, dialect, "plain", "<p>Hi {{name}}</p>");
      const service = templates(t);

      // Before the boot records the switch, each is judged by what it holds.
      const before = await service.keptOnOldEngineIds(
        await service.listTemplates()
      );
      expect(before).toEqual(await onePerTemplate(service));

      // The first boot on Liquid records which ones it keeps.
      await service.ensureBuiltInTemplates();
      const after = await service.keptOnOldEngineIds(
        await service.listTemplates()
      );
      expect(after).toEqual(await onePerTemplate(service));

      const literalIf = await service.getTemplateBySlug("literal-if");
      const plain = await service.getTemplateBySlug("plain");
      expect(after.has(literalIf!.id)).toBe(true);
      expect(after.has(plain!.id)).toBe(false);
    }, 120_000);

    it("reads the meta table once for the whole list", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const service = templates(t);
      await service.ensureBuiltInTemplates();
      const list = await service.listTemplates();
      expect(list.length).toBeGreaterThan(1);

      const meta = (
        service as unknown as {
          meta: { getAll: () => unknown; getEntry: () => unknown };
        }
      ).meta;
      const getAll = vi.spyOn(meta, "getAll");
      const getEntry = vi.spyOn(meta, "getEntry");

      await service.keptOnOldEngineIds(list);

      // One read of the whole state answers whether the switch is recorded
      // and which templates it kept; none per template.
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(getEntry).not.toHaveBeenCalled();
    }, 120_000);

    it("reads nothing for an empty list", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const service = templates(t);
      const meta = (service as unknown as { meta: { getAll: () => unknown } })
        .meta;
      const getAll = vi.spyOn(meta, "getAll");

      expect(await service.keptOnOldEngineIds([])).toEqual(new Set());
      expect(getAll).not.toHaveBeenCalled();
    }, 120_000);
  });
}
