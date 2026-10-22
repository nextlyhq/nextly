/**
 * The templates list carries what the admin's Email hub groups and labels each
 * email by, on every configured dialect: its owner, whether the site
 * customised it and the owner has since changed it, whether it is off, what
 * sends it, and whether it is kept on the previous engine.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { EmailTemplateService } from "../../../domains/email/services/email-template-service";
import { dispatchEmailTemplates } from "../email-dispatcher";

const ACTOR = { type: "user" as const, id: "user-1" };
const ORDERS = "@acme/plugin-orders";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

const shipped = (htmlContent: string): PluginEmailTemplate => ({
  slug: "orders-shipped",
  name: "Order shipped",
  subject: "Your order shipped",
  htmlContent,
  description: "Sent when an order ships.",
});
const refunded: PluginEmailTemplate = {
  slug: "orders-refunded",
  name: "Order refunded",
  subject: "Refunded",
  htmlContent: "<p>Refunded, {{name}}.</p>",
  description: "Sent when an order is refunded.",
};

/** A boot with the orders plugin at `shippedHtml`. */
async function bootPlugin(t: TestNextly, shippedHtml: string): Promise<void> {
  templates(t).configureOwnership({
    plugins: [{ name: ORDERS, templates: [shipped(shippedHtml), refunded] }],
  });
  await templates(t).ensureBuiltInTemplates();
}

/**
 * Store a template as an install before Liquid did, straight into the table:
 * what it holds no longer passes the save-time check.
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

interface ListedTemplate {
  slug: string;
  owner: { kind: string; name?: string; installed?: boolean };
  description: string | null;
  isActive: boolean;
  overridden: boolean;
  ownerChanged: boolean;
  keptOnOldEngine: boolean;
}

async function list(): Promise<Map<string, ListedTemplate>> {
  const response = (await dispatchEmailTemplates(
    "listTemplates",
    {},
    undefined
  )) as Response;
  const body = (await response.json()) as { templates: ListedTemplate[] };
  return new Map(body.templates.map(row => [row.slug, row]));
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`the templates list for the Email hub — ${dialect}`, () => {
    it("carries each email's owner and state", async () => {
      const t = (current = await createTestNextly({ dialect }));
      // Stored before the switch to Liquid, so the first boot keeps it.
      await storeAsBefore(
        t,
        dialect,
        "spring-sale",
        "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>"
      );
      await bootPlugin(t, "<p>Shipped, {{name}}.</p>");

      const service = templates(t);
      const welcome = await service.getTemplateBySlug("welcome");
      await service.overrideTemplate(welcome!.id, undefined, ACTOR);
      const shippedRow = await service.getTemplateBySlug("orders-shipped");
      await service.overrideTemplate(shippedRow!.id, undefined, ACTOR);
      // The owner changes its version after the site customised it.
      await bootPlugin(t, "<p>Shipped today, {{name}}.</p>");
      const newsletter = await t.nextly.emailTemplates.create({
        data: {
          name: "Newsletter",
          slug: "newsletter",
          subject: "News",
          htmlContent: "<p>News</p>",
        },
      });
      // Turned off, as the editor's switch does.
      await t.nextly.emailTemplates.update({
        id: newsletter.item.id,
        data: { isActive: false },
      });

      const rows = await list();

      expect(rows.get("password-reset")).toMatchObject({
        owner: { kind: "core" },
        overridden: false,
        ownerChanged: false,
        keptOnOldEngine: false,
      });
      expect(rows.get("welcome")).toMatchObject({
        owner: { kind: "core" },
        overridden: true,
        ownerChanged: false,
      });
      expect(rows.get("orders-shipped")).toMatchObject({
        owner: { kind: "plugin", name: ORDERS, installed: true },
        description: "Sent when an order ships.",
        overridden: true,
        ownerChanged: true,
      });
      expect(rows.get("orders-refunded")).toMatchObject({
        owner: { kind: "plugin", name: ORDERS, installed: true },
        overridden: false,
        ownerChanged: false,
      });
      expect(rows.get("newsletter")).toMatchObject({
        owner: { kind: "site" },
        isActive: false,
        keptOnOldEngine: false,
      });
      expect(rows.get("spring-sale")).toMatchObject({
        owner: { kind: "site" },
        keptOnOldEngine: true,
      });
    }, 120_000);
  });
}
