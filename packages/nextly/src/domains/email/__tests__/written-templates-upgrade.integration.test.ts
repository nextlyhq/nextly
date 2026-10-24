/**
 * Written templates on every dialect, beside an installation's existing ones.
 *
 * The `format` and `blocks` columns reach an existing installation through
 * the real core reconcile (`migrateCore`, as `nextly migrate` and the boot
 * run it), its rows untouched. Every template stored before them has no
 * format: it reads as coded, a boot leaves the column as it is (nothing is
 * rewritten), and it renders exactly as before. A written template's blocks
 * are stored and read back unchanged by each dialect's JSON column.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

import type { EmailTemplateService } from "../services/email-template-service";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import type { WrittenDocument } from "../written/document";

import {
  openTemplateStore,
  serviceOver,
  storedRow,
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

const WRITTEN_COLUMNS = ["format", "blocks"];
const LEGACY_ID = "00000000-0000-4000-8000-0000000000f1";

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-wtc-");
afterAll(remove);

describe.each(availableDialects())(
  "the written template columns on an existing database (%s)",
  dialect => {
    it("adds them in place, keeps the rows coded and unchanged, and a written template then saves", async () => {
      await withFreshDatabase(dialect, "nextly_wtc_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        for (const column of WRITTEN_COLUMNS) {
          await fresh.exec(`ALTER TABLE email_templates DROP COLUMN ${column}`);
        }
        const before = await fresh.columnsOf("email_templates");
        for (const column of WRITTEN_COLUMNS) {
          expect(before).not.toContain(column);
        }
        // A site's own template, stored as an older release stored it.
        const yes = fresh.dialect === "postgresql" ? "true" : "1";
        const now =
          fresh.dialect === "sqlite" ? "1760000000" : "'2026-10-01 09:00:00'";
        await fresh.exec(
          `INSERT INTO email_templates (id, name, slug, subject, html_content, kind, use_layout, is_active, created_at, updated_at) VALUES ('${LEGACY_ID}', 'Newsletter', 'newsletter', 'News for {{userName}}', '<p>Hi {{userName}}</p>', 'template', ${yes}, ${yes}, ${now}, ${now})`
        );

        // The production reconcile adds the columns.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect(await fresh.columnsOf("email_templates")).toEqual(
          expect.arrayContaining(WRITTEN_COLUMNS)
        );

        const service = serviceOver(fresh);
        service.configureOwnership({ plugins: [] });
        await service.ensureBuiltInTemplates();

        // The row keeps no format, reads as coded, and renders as it did.
        const row = await storedRow(fresh, LEGACY_ID);
        expect(row).toMatchObject({
          format: null,
          blocks: null,
          htmlContent: "<p>Hi {{userName}}</p>",
        });
        const legacy = await service.getTemplate(LEGACY_ID);
        expect(legacy).toMatchObject({ format: "code", blocks: null });
        const sent = await service.renderStored(legacy, DATA);
        expect(sent.subject).toBe("News for Priya");
        expect(sent.html).toContain("Hi Priya");

        // The reconciled table takes a written template.
        const created = await service.createTemplate({
          name: "Order",
          slug: "order",
          subject: "Order {{ order.number }}",
          htmlContent: "",
          format: "written",
          blocks: BLOCKS,
        });
        expect(await service.getTemplate(created.id)).toMatchObject({
          format: "written",
          blocks: BLOCKS,
        });

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
