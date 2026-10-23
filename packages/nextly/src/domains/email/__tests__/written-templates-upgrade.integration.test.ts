/**
 * Written templates on every dialect, beside an installation's existing ones.
 *
 * Every template stored before written templates has no format: it reads as
 * coded, a boot leaves the column as it is (nothing is rewritten), and it
 * renders exactly as before. A written template's blocks are stored and read
 * back unchanged by each dialect's JSON column.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EmailTemplateService } from "../services/email-template-service";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import type { WrittenDocument } from "../written/document";

import {
  openTemplateStore,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const DATA = {
  appName: "Shop",
  year: "2026",
  userName: "Priya",
  resetLink: "https://example.com/reset?token=abc&next=/admin",
  verifyLink: "https://example.com/verify",
  expiresIn: "1 hour",
};

const BLOCKS: WrittenDocument = {
  version: 1,
  blocks: [
    {
      type: "heading",
      text: [
        { type: "text", text: "Order " },
        { type: "chip", variable: "order.number" },
      ],
    },
    {
      type: "list",
      variable: "lines",
      blocks: [
        { type: "text", text: [{ type: "chip", variable: "item.name" }] },
      ],
      show: { variable: "lines", when: "present" },
    },
    {
      type: "button",
      label: [{ type: "text", text: "View" }],
      link: {
        chip: { variable: "orderUrl", fallback: "https://shop.example/orders" },
      },
    },
  ],
};

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`written templates beside existing ones — ${entry.dialect}`, () => {
    let store: TemplateStore;

    async function boot(): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({ plugins: [] });
      await service.ensureBuiltInTemplates();
      return service;
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

    it("leaves every existing template coded, unrewritten and rendering as before", async () => {
      const seeding = await boot();
      await seeding.createTemplate({
        name: "Newsletter",
        slug: "newsletter",
        subject: "News for {{userName}}",
        htmlContent: "<p>Hi {{userName}}</p>",
      });
      // As every row stored before written templates: no format at all.
      await store.exec(
        `UPDATE ${store.q("email_templates")} SET ${store.q("format")} = NULL, ${store.q("blocks")} = NULL`
      );
      const slugs = [...BUILT_IN_TEMPLATES.map(t => t.slug), "newsletter"];
      const before: Record<string, unknown> = {};
      for (const slug of slugs) {
        const t = await seeding.getTemplateBySlug(slug);
        if (t && t.kind !== "layout")
          before[slug] = await seeding.renderStored(t, DATA);
      }

      const service = await boot();

      const raw = await store.query<{ format: unknown; blocks: unknown }>(
        `SELECT ${store.q("format")} AS format, ${store.q("blocks")} AS blocks FROM ${store.q("email_templates")}`
      );
      expect(raw.length).toBe(slugs.length);
      expect(raw.every(row => row.format === null && row.blocks === null)).toBe(
        true
      );
      for (const slug of slugs) {
        const t = await service.getTemplateBySlug(slug);
        expect(t).toMatchObject({ format: "code", blocks: null });
        if (t && t.kind !== "layout") {
          expect(await service.renderStored(t, DATA)).toEqual(before[slug]);
        }
      }
      // The control: the comparison above rendered real emails.
      expect(JSON.stringify(before)).toContain("Hi Priya");
    });

    it("stores a written template's blocks and reads them back as written", async () => {
      const service = await boot();
      const created = await service.createTemplate({
        name: "Order",
        slug: "order",
        subject: "Order {{ order.number }}",
        htmlContent: "",
        format: "written",
        blocks: BLOCKS,
      });

      const read = await store.newService().getTemplate(created.id);
      expect(read).toMatchObject({ format: "written", blocks: BLOCKS });
      const sent = await service.renderStored(read, {
        order: { number: "1042" },
        lines: [{ name: "Tea" }, { name: "Cake" }],
      });
      expect(sent.subject).toBe("Order 1042");
      expect(sent.html).toContain("Order 1042</h1>");
      expect(sent.html).toContain(">Tea</p>");
      expect(sent.html).toContain(">Cake</p>");
      expect(sent.html).toContain(`href="https://shop.example/orders"`);
    });
  });
}
