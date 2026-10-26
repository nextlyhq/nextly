/**
 * Typed variable declarations, on every dialect: today's declarations read
 * back as they were stored, and an owner's presentation (type, label,
 * example) reaches its template without ever counting as a change.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import type { EmailTemplateService } from "../services/email-template-service";

import {
  openTemplateStore,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const ORDERS = "@acme/plugin-orders";

/** The orders plugin's template, with `variables` as declared. */
const shipped = (
  variables: PluginEmailTemplate["variables"]
): PluginEmailTemplate => ({
  slug: "orders-shipped",
  name: "Order shipped",
  subject: "Your order shipped",
  htmlContent: "<p>Order {{number}} is on its way.</p>",
  description: "Sent when an order ships.",
  variables,
});

const UNTYPED = [
  { name: "number", description: "The order's number", required: true },
];
const TYPED = [
  {
    name: "number",
    description: "The order's number",
    required: true,
    type: "text" as const,
    label: "Order number",
    example: "A-1001",
  },
];

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`typed template variables — ${entry.dialect}`, () => {
    let store: TemplateStore;

    async function boot(
      variables: PluginEmailTemplate["variables"]
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({
        plugins: [{ name: ORDERS, templates: [shipped(variables)] }],
      });
      await service.ensureBuiltInTemplates();
      return service;
    }

    async function shippedTemplate(service: EmailTemplateService) {
      const template = await service.getTemplateBySlug("orders-shipped");
      if (!template) throw new Error("orders-shipped is missing");
      return template;
    }

    beforeAll(async () => {
      store = await openTemplateStore(entry);
    }, 60_000);

    afterAll(async () => {
      await store?.close();
    });

    beforeEach(async () => {
      await store.clear();
    });

    it("reads today's declarations as they were stored", async () => {
      const service = store.newService();
      const stored = [
        [{ name: "a", description: "One", required: true }],
        [{ name: "b" }],
        [{ name: "c", required: false }],
      ];
      for (const [index, variables] of stored.entries()) {
        const created = await service.createTemplate({
          name: `Stored ${index}`,
          slug: `stored-${index}`,
          subject: "Hi",
          htmlContent: "<p>Hi</p>",
        });
        // As an earlier release wrote the column: JSON text of that shape.
        await store.exec(
          `UPDATE ${store.q("email_templates")} SET ${store.q("variables")} = ? WHERE ${store.q("id")} = ?`,
          [JSON.stringify(variables), created.id]
        );
      }

      for (const [index, variables] of stored.entries()) {
        const read = await service.getTemplateBySlug(`stored-${index}`);
        expect(read?.variables).toEqual(variables);
      }
    }, 120_000);

    it("shows the owner's presentation on a copy whose declarations the site changed", async () => {
      const first = await boot(UNTYPED);
      const template = await shippedTemplate(first);
      // The site rewords the variable's description, so its declarations are
      // its own from here on.
      await first.updateTemplate(template.id, {
        variables: [
          {
            name: "number",
            description: "Our order reference",
            required: true,
          },
        ],
      });

      const second = await boot(TYPED);
      const read = await shippedTemplate(second);

      expect(read.variables).toEqual([
        {
          name: "number",
          description: "Our order reference",
          required: true,
          type: "text",
          label: "Order number",
          example: "A-1001",
        },
      ]);
      // Nothing the site sees as an update to review.
      expect(read.ownerChanged).toBe(false);
    }, 120_000);

    it("does not make an owned template the site's when only a variable's presentation changes", async () => {
      const service = await boot(UNTYPED);
      const template = await shippedTemplate(service);

      const saved = await service.updateTemplate(template.id, {
        variables: [{ ...UNTYPED[0], label: "Order", example: "A-1" }],
      });

      expect(saved.overridden).toBe(false);
    }, 120_000);

    it("still makes it the site's when what a variable says changes", async () => {
      const service = await boot(UNTYPED);
      const template = await shippedTemplate(service);

      const saved = await service.updateTemplate(template.id, {
        variables: [{ ...UNTYPED[0], required: false }],
      });

      expect(saved.overridden).toBe(true);
    }, 120_000);
  });
}
