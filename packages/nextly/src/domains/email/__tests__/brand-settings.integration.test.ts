/**
 * Brand settings on every dialect, on real tables.
 *
 * The database starts as an installation from before brand settings (and
 * before template owners): core's built-ins, with the default layout as core
 * shipped it then. The boot must bring that layout to core's version written
 * in the brand settings without changing any email, and from then on the
 * settings shape every email the layout wraps. A default layout the site
 * edited, and the site's own layouts, are left as they are.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMAIL_BRAND_TABLE } from "../../../schemas/email-brand";
import type { EmailTemplateVersion } from "../../../schemas/email-templates/types";
import { STARTING_BRAND } from "../brand-settings";
import type { EmailTemplateService } from "../services/email-template-service";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_BEFORE_BRAND,
  DEFAULT_LAYOUT_SLUG,
  defaultLayoutTemplate,
} from "../services/templates";
import { EMAIL_VERIFICATION_BEFORE_BRAND } from "../services/templates/email-verification";
import { PASSWORD_RESET_BEFORE_BRAND } from "../services/templates/password-reset";
import { WELCOME_BEFORE_BRAND } from "../services/templates/welcome";

import {
  forgetOwnership,
  openTemplateStore,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

/** Every variable the built-ins read, with characters escaping must handle. */
const DATA = {
  appName: `Shop <b>&</b> 'Co'`,
  year: "2026",
  userName: "Priya <Raman>",
  userEmail: "priya@example.com",
  resetLink: "https://example.com/reset?token=abc&next=/admin",
  verifyLink: "https://example.com/verify?token=def",
  expiresIn: "1 hour",
};

/** A default layout an admin edited before brand settings existed. */
const EDITED_LAYOUT = `<html><body style="background: #000000;"><table><tr><td>{{content}}</td></tr></table><p>Sent by {{appName}}</p></body></html>`;

/** A layout of the site's own that reads the settings. */
const SITE_LAYOUT = `<div style="background: {{ brand.backgroundColor }};">{{content}}<p>{{ brand.footerText }}</p></div>`;

/**
 * Each built-in body as core shipped it before brand settings, read from its
 * own file rather than from the registry's list of earlier versions, which is
 * what the upgrade below puts to the test.
 */
const BEFORE_BRAND: Record<string, EmailTemplateVersion> = {
  welcome: WELCOME_BEFORE_BRAND,
  "password-reset": PASSWORD_RESET_BEFORE_BRAND,
  "email-verification": EMAIL_VERIFICATION_BEFORE_BRAND,
};

const BODIES = BUILT_IN_TEMPLATES.filter(t => t.kind !== "layout").map(
  t => t.slug
);

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`brand settings — ${entry.dialect}`, () => {
    let store: TemplateStore;

    /** The rows such an installation holds, before the boot that upgrades it. */
    async function seedBeforeBrand(layoutHtml: string): Promise<void> {
      const seeding = store.newService();
      for (const template of BUILT_IN_TEMPLATES) {
        // Each built-in as core shipped it then, the layout as given.
        await seeding.createTemplate(
          template.slug === DEFAULT_LAYOUT_SLUG
            ? { ...template, htmlContent: layoutHtml }
            : { ...template, ...BEFORE_BRAND[template.slug] }
        );
      }
      await forgetOwnership(store);
    }

    async function boot(
      codeTemplates?: Parameters<
        EmailTemplateService["configureOwnership"]
      >[0]["codeTemplates"]
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({ plugins: [], codeTemplates });
      await service.ensureBuiltInTemplates();
      return service;
    }

    const template = async (service: EmailTemplateService, slug: string) => {
      const found = await service.getTemplateBySlug(slug);
      if (!found) throw new Error(`missing ${slug}`);
      return found;
    };

    /** What a send of each built-in delivers. */
    async function renderBodies(service: EmailTemplateService) {
      const out: Record<string, unknown> = {};
      for (const slug of BODIES) {
        out[slug] = await service.renderStored(
          await template(service, slug),
          DATA
        );
      }
      return out;
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

    it("upgrades a site without changing any email, and its layout follows core", async () => {
      await seedBeforeBrand(DEFAULT_LAYOUT_BEFORE_BRAND.htmlContent);
      const before = await renderBodies(store.newService());

      const service = await boot();

      expect(await renderBodies(service)).toEqual(before);
      // The control: the bodies were wrapped in the layout, so the equality
      // above compared the layout's output too.
      expect(JSON.stringify(before)).toContain("All rights reserved.");
      const layout = await template(service, DEFAULT_LAYOUT_SLUG);
      expect(layout).toMatchObject({
        owner: { kind: "core" },
        overridden: false,
        htmlContent: defaultLayoutTemplate.htmlContent,
      });
      // Every built-in body follows core too, its button now in the accent.
      for (const builtIn of BUILT_IN_TEMPLATES) {
        expect(await template(service, builtIn.slug)).toMatchObject({
          overridden: false,
          htmlContent: builtIn.htmlContent,
        });
      }
      const reach = await service.brandReach();
      expect(reach.map(r => [r.slug, r.reached]).sort()).toEqual(
        BODIES.map(slug => [slug, true]).sort()
      );
    });

    it("renders core's default layout from changed settings, on every surface", async () => {
      await seedBeforeBrand(DEFAULT_LAYOUT_BEFORE_BRAND.htmlContent);
      const service = await boot();

      const saved = await service.updateBrand({
        backgroundColor: "#102030",
        accentColor: "#FF0066",
        logoUrl: "https://cdn.example.com/logo.png",
        footerText: "Acme Ltd, 1 Main St",
        footerLinks: [{ label: "Privacy", url: "https://acme.test/privacy" }],
      });
      expect(saved).toMatchObject({
        backgroundColor: "#102030",
        accentColor: "#ff0066",
        contentColor: STARTING_BRAND.contentColor,
      });

      // Read back by a service of its own, as the next request would.
      const next = store.newService();
      const sent = await next.renderStored(
        await template(next, "password-reset"),
        DATA
      );
      expect(sent.html).toContain(
        `class="email-bg" style="background-color: #102030;"`
      );
      expect(sent.html).toContain(
        `<img src="https://cdn.example.com/logo.png"`
      );
      expect(sent.html).toContain(">Acme Ltd, 1 Main St</p>");
      expect(sent.html).toContain(
        `href="https://acme.test/privacy" style="color: #ff0066;`
      );
      expect(sent.html).not.toContain("All rights reserved.");
      // The button is in the accent, for Outlook and every other client.
      expect(sent.html).toContain(`fillcolor="#ff0066"`);
      expect(sent.html).toContain(`background-color: #ff0066; color: #ffffff;`);

      // The draft preview composes the same way.
      const draft = await next.previewDraft(
        {
          subject: "Hi",
          htmlContent: "<p>Draft</p>",
          plainTextContent: null,
          preheader: null,
          useLayout: true,
          kind: "template",
          layoutId: null,
        },
        {}
      );
      expect(draft.html).toContain(`style="background-color: #102030;"`);

      // Null returns a setting to where it started.
      await next.updateBrand({ backgroundColor: null, footerText: null });
      const reset = await next.renderStored(
        await template(next, "password-reset"),
        DATA
      );
      expect(reset.html).toContain(`style="background-color: #f4f4f5;"`);
      expect(reset.html).toContain("All rights reserved.");
      expect((await next.getBrand()).settings).toMatchObject({
        backgroundColor: STARTING_BRAND.backgroundColor,
        accentColor: "#ff0066",
      });
    });

    it("previews unsaved settings over the saved ones, and saves nothing", async () => {
      const service = await boot();
      await service.updateBrand({
        accentColor: "#ff0066",
        footerText: "Acme Ltd, 1 Main St",
      });
      const draft = {
        subject: "Hi",
        htmlContent: "<p>Draft</p>",
        plainTextContent: null,
        preheader: null,
        useLayout: true,
        kind: "template" as const,
        layoutId: null,
      };

      const preview = await service.previewDraft(
        draft,
        {},
        {
          backgroundColor: "#abcdef",
          // Null previews a setting at its starting value.
          footerText: null,
        }
      );
      expect(preview.html).toContain(`style="background-color: #abcdef;"`);
      expect(preview.html).toContain("All rights reserved.");
      expect(preview.html).not.toContain("Acme Ltd, 1 Main St");

      // What is saved is untouched, for this service and the next.
      const unchanged = {
        accentColor: "#ff0066",
        backgroundColor: STARTING_BRAND.backgroundColor,
        footerText: "Acme Ltd, 1 Main St",
      };
      expect((await service.getBrand()).settings).toMatchObject(unchanged);
      expect((await store.newService().getBrand()).settings).toMatchObject(
        unchanged
      );
      // And a preview without a change shows the saved settings.
      const saved = await service.previewDraft(draft, {});
      expect(saved.html).toContain(
        `style="background-color: ${STARTING_BRAND.backgroundColor};"`
      );
      expect(saved.html).toContain("Acme Ltd, 1 Main St");
    });

    it("leaves an edited default layout and the site's layouts as they are, and says which emails it reaches", async () => {
      await seedBeforeBrand(EDITED_LAYOUT);
      const service = await boot();

      const layout = await template(service, DEFAULT_LAYOUT_SLUG);
      expect(layout).toMatchObject({
        overridden: true,
        htmlContent: EDITED_LAYOUT,
      });

      const siteLayout = await service.createTemplate({
        name: "Newsletter layout",
        slug: "newsletter-layout",
        kind: "layout",
        subject: "",
        htmlContent: SITE_LAYOUT,
        useLayout: false,
      });
      const newsletter = await service.createTemplate({
        name: "Newsletter",
        slug: "newsletter",
        subject: "News",
        htmlContent: "<p>News</p>",
        layoutId: siteLayout.id,
      });
      const notice = await service.createTemplate({
        name: "Notice",
        slug: "notice",
        subject: "Notice",
        htmlContent: "<p>Notice</p>",
      });
      const plain = await service.createTemplate({
        name: "Plain",
        slug: "plain",
        subject: "Plain",
        htmlContent: "<p>Plain</p>",
        useLayout: false,
      });

      const welcome = await template(service, "welcome");
      const before = await service.renderStored(welcome, DATA);
      await service.updateBrand({
        backgroundColor: "#102030",
        footerText: "Acme Ltd",
      });

      expect(await service.renderStored(welcome, DATA)).toEqual(before);
      expect((await service.renderStored(newsletter, {})).html).toBe(
        `<div style="background: #102030;"><p>News</p><p>Acme Ltd</p></div>`
      );

      const reach = new Map((await service.brandReach()).map(r => [r.slug, r]));
      // Its button reads the accent, so the settings reach it though its
      // layout, the edited default one, reads none of them.
      expect(reach.get("welcome")).toMatchObject({
        reached: true,
        reason: null,
        via: { body: true, layout: false },
        layout: { slug: DEFAULT_LAYOUT_SLUG, overridden: true },
      });
      // An email whose text and layout both read none of them is not reached.
      expect(reach.get(notice.slug)).toMatchObject({
        reached: false,
        reason: "layoutWithoutBrand",
        via: { body: false, layout: false },
        layout: { slug: DEFAULT_LAYOUT_SLUG },
      });
      expect(reach.get("newsletter")).toMatchObject({
        reached: true,
        reason: null,
        layout: { id: siteLayout.id, overridden: false },
      });
      expect(reach.get(plain.slug)).toMatchObject({
        reached: false,
        reason: "noLayout",
        via: { body: false, layout: false },
        layout: null,
      });
      expect(reach.get("newsletter")).toMatchObject({
        via: { body: false, layout: true },
      });
      // Layouts are what the settings reach through, not emails of their own.
      expect(reach.has(DEFAULT_LAYOUT_SLUG)).toBe(false);
      expect(reach.has("newsletter-layout")).toBe(false);
    });

    it("says an email the site's code sends is not reached", async () => {
      // A new installation: its seeded welcome follows core, so the code
      // version sends. (On an installation from before template owners the
      // stored welcome it already sent is kept as an override, and sends.)
      const service = await boot({
        welcome: () => ({ subject: "Welcome (code)", html: "<p>code</p>" }),
      });

      const reach = new Map((await service.brandReach()).map(r => [r.slug, r]));
      expect(reach.get("welcome")).toMatchObject({
        reached: false,
        reason: "setInCode",
      });
      expect(reach.get("password-reset")).toMatchObject({ reached: true });
    });

    it("follows the send's choice when a template is switched off", async () => {
      const service = await boot({
        welcome: () => ({ subject: "Welcome (code)", html: "<p>code</p>" }),
      });
      // An active override sends the stored row, in the layout.
      const welcome = await template(service, "welcome");
      await service.overrideTemplate(welcome.id);
      const reachOf = async (slug: string) =>
        (await service.brandReach()).find(r => r.slug === slug);
      expect(await reachOf("welcome")).toMatchObject({ reached: true });

      // Switched off, the send falls back to the code version.
      await service.updateTemplate(welcome.id, { isActive: false });
      expect(await reachOf("welcome")).toMatchObject({
        reached: false,
        reason: "setInCode",
      });

      // Switched off with no code version, nothing sends.
      const reset = await template(service, "password-reset");
      await service.updateTemplate(reset.id, { isActive: false });
      expect(await reachOf("password-reset")).toMatchObject({
        reached: false,
        reason: "inactive",
        layout: null,
      });

      // Sent without a layout, a built-in is still reached through its button.
      const verify = await template(service, "email-verification");
      await service.updateTemplate(verify.id, { useLayout: false });
      expect(await reachOf("email-verification")).toMatchObject({
        reached: true,
        reason: null,
        via: { body: true, layout: false },
        layout: null,
      });
    });

    it("sends as before when the database has no brand table yet", async () => {
      await seedBeforeBrand(DEFAULT_LAYOUT_BEFORE_BRAND.htmlContent);
      const before = await renderBodies(store.newService());
      const service = await boot();
      const q = store.q;
      const aside = `${EMAIL_BRAND_TABLE}_aside`;
      await store.exec(
        `ALTER TABLE ${q(EMAIL_BRAND_TABLE)} RENAME TO ${q(aside)}`
      );
      try {
        expect(await renderBodies(service)).toEqual(before);
        expect((await service.getBrand()).settings).toEqual(STARTING_BRAND);
      } finally {
        await store.exec(
          `ALTER TABLE ${q(aside)} RENAME TO ${q(EMAIL_BRAND_TABLE)}`
        );
      }
    });
  });
}
