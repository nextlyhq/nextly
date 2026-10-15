/**
 * An installation that predates template ownership, upgraded, on every dialect.
 *
 * The database holds what such a site has: core's built-ins (one edited by an
 * admin, the others as shipped), a running plugin's templates (one edited),
 * the templates of a plugin that is no longer installed, the site's own, and
 * a site whose code configures `email.templates.welcome` while the seeded
 * welcome row is what it sends today. The upgrade must give each its owner
 * without changing what any of them sends.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import type { EmailTemplateInsert } from "../../../schemas/email-templates/types";
import type { EmailTemplateService } from "../services/email-template-service";
import { BUILT_IN_TEMPLATES } from "../services/templates";
import { versionOf } from "../template-ownership";

import {
  forgetOwnership,
  openTemplateStore,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const ORDERS = "@acme/plugin-orders";
const ORDERS_TEMPLATES: PluginEmailTemplate[] = [
  {
    slug: "orders-paid",
    name: "Order paid",
    subject: "Thanks for your payment",
    htmlContent: "<p>We received {{amount}}.</p>",
    description: "Sent when an order is paid.",
  },
  {
    slug: "orders-shipped",
    name: "Order shipped",
    subject: "Your order is on its way",
    htmlContent: "<p>Order {{number}} shipped.</p>",
  },
];

const welcomeFromCode = () => ({
  subject: "Welcome (code)",
  html: "<p>code</p>",
});

const builtIn = (slug: string): EmailTemplateInsert => {
  const template = BUILT_IN_TEMPLATES.find(t => t.slug === slug);
  if (!template) throw new Error(`no built-in ${slug}`);
  return template;
};

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(
    `upgrading an installation without template owners — ${entry.dialect}`,
    () => {
      let store: TemplateStore;
      let service: EmailTemplateService;

      async function seedAsBeforeTheUpgrade(): Promise<void> {
        const seeding = store.newService();
        for (const template of BUILT_IN_TEMPLATES) {
          const edited =
            template.slug === "email-verification"
              ? { subject: "Please confirm your address for {{appName}}" }
              : {};
          await seeding.createTemplate({ ...template, ...edited });
        }
        // As the old insert-if-absent seeding stored them.
        const [paid, shipped] = ORDERS_TEMPLATES;
        await seeding.createTemplate({
          name: paid.name,
          slug: paid.slug,
          subject: paid.subject,
          htmlContent: paid.htmlContent,
        });
        await seeding.createTemplate({
          name: shipped.name,
          slug: shipped.slug,
          subject: shipped.subject,
          htmlContent: "<p>Good news: order {{number}} is on its way.</p>",
        });
        // Left behind by the accounts plugin, which this site has since removed.
        await seeding.createTemplate({
          name: "Reset a password",
          slug: "accounts-reset-password",
          subject: "Reset your password",
          htmlContent: "<p>{{link}}</p>",
        });
        await seeding.createTemplate({
          name: "Newsletter welcome",
          slug: "newsletter-welcome",
          subject: "Welcome to the letter",
          htmlContent: "<p>Hi</p>",
        });
        await forgetOwnership(store);
      }

      async function upgrade(): Promise<void> {
        service = store.newService();
        service.configureOwnership({
          plugins: [{ name: ORDERS, templates: ORDERS_TEMPLATES }],
          codeTemplates: { welcome: welcomeFromCode },
        });
        await service.ensureBuiltInTemplates();
      }

      beforeAll(async () => {
        store = await openTemplateStore(entry);
      }, 60_000);

      afterAll(async () => {
        await store?.close();
      });

      beforeEach(async () => {
        await store.clear();
        await seedAsBeforeTheUpgrade();
        await upgrade();
      });

      const get = async (slug: string) => {
        const template = await service.getTemplateBySlug(slug);
        if (!template) throw new Error(`missing ${slug}`);
        return template;
      };

      it("gives core's unedited built-ins the owner core, following its version", async () => {
        for (const slug of ["password-reset", "default-layout"]) {
          const template = await get(slug);
          expect(template.owner).toEqual({ kind: "core" });
          expect(template.overridden).toBe(false);
          expect(versionOf(template)).toEqual(versionOf(builtIn(slug)));
        }
      });

      it("keeps an edited core template as an override based on core's version", async () => {
        const template = await get("email-verification");
        expect(template.owner).toEqual({ kind: "core" });
        expect(template.overridden).toBe(true);
        expect(template.ownerChanged).toBe(false);
        expect(template.subject).toBe(
          "Please confirm your address for {{appName}}"
        );
        const { base } = await service.compareTemplate(template.id);
        expect(base).toEqual(versionOf(builtIn("email-verification")));
      });

      it("gives a running plugin its templates, keeping its edited one as an override", async () => {
        const paid = await get("orders-paid");
        expect(paid.owner).toEqual({
          kind: "plugin",
          name: ORDERS,
          installed: true,
        });
        expect(paid.overridden).toBe(false);
        expect(paid.description).toBe("Sent when an order is paid.");

        const shipped = await get("orders-shipped");
        expect(shipped.owner).toEqual({
          kind: "plugin",
          name: ORDERS,
          installed: true,
        });
        expect(shipped.overridden).toBe(true);
        expect(shipped.htmlContent).toBe(
          "<p>Good news: order {{number}} is on its way.</p>"
        );
        const { base } = await service.compareTemplate(shipped.id);
        expect(base.htmlContent).toBe(ORDERS_TEMPLATES[1].htmlContent);
      });

      it("records a removed first-party plugin's template as that plugin's, not installed", async () => {
        const left = await get("accounts-reset-password");
        expect(left.owner).toEqual({
          kind: "plugin",
          name: "@nextlyhq/plugin-accounts",
          installed: false,
        });
        const [row] = await store.query<{
          owner_kind: string;
          owner_name: string;
        }>(
          `SELECT ${store.q("owner_kind")}, ${store.q("owner_name")} FROM ${store.q("email_templates")} WHERE ${store.q("slug")} = ?`,
          ["accounts-reset-password"]
        );
        expect(row).toMatchObject({
          owner_kind: "plugin",
          owner_name: "@nextlyhq/plugin-accounts",
        });
      });

      it("gives everything else to the site", async () => {
        const own = await get("newsletter-welcome");
        expect(own.owner).toEqual({ kind: "site" });
        expect(own.overridden).toBe(false);
      });

      it("keeps sending the stored welcome a site with email.templates.welcome sends today, until Reset", async () => {
        const welcome = await get("welcome");
        // The stored row equals core's version, and is still kept: it is what
        // this site sends today.
        expect(versionOf(welcome)).toEqual(versionOf(builtIn("welcome")));
        expect(welcome.overridden).toBe(true);
        expect(welcome.setInCode).toBe(true);
        expect((await service.resolveForSend("welcome")).preferCode).toBe(
          false
        );

        await service.resetTemplate(welcome.id);
        expect((await service.resolveForSend("welcome")).preferCode).toBe(true);
      });

      it("changes nothing at the next boot", async () => {
        const read = () =>
          store.query<Record<string, unknown>>(
            `SELECT ${["slug", "owner_kind", "owner_name", "overridden", "base_digest", "subject", "html_content", "updated_at"].map(store.q).join(", ")} FROM ${store.q("email_templates")} ORDER BY ${store.q("slug")}`
          );
        const before = await read();
        await upgrade();
        expect(await read()).toEqual(before);
      });

      it("is the instrument control: before the upgrade, nothing has an owner", async () => {
        await store.clear();
        await seedAsBeforeTheUpgrade();
        const rows = await store.query<{ owner_kind: string | null }>(
          `SELECT ${store.q("owner_kind")} FROM ${store.q("email_templates")}`
        );
        expect(rows.length).toBeGreaterThan(5);
        expect(rows.every(row => row.owner_kind === null)).toBe(true);
      });
    }
  );
}
