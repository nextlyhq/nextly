/**
 * Owners keep their templates up to date until a site overrides them, on every
 * dialect.
 *
 * Each "boot" here is what the post-init boot does: a new service, told which
 * plugins run and what the site's code sets, reconciling the stored rows.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { container } from "../../../di/container";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import type { LogActivityInput } from "../../../services/dashboard/activity-log-service";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { passwordResetTemplate } from "../services/templates";
import type { EmailConfig } from "../types";

import {
  openTemplateStore,
  silentLogger,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const ACTOR = { type: "user" as const, id: "user-1" };
const ORDERS = "@acme/plugin-orders";
const lines = (...l: string[]) => l.join("\n");

// The plugin's version 1 of its template, and version 2 with two changes.
const V1 = lines(
  "<h1>Your order shipped</h1>",
  "<p>Hi {{name}},</p>",
  "<p>Order {{number}} left our warehouse.</p>",
  '<a href="{{trackingUrl}}">Track it</a>',
  "<p>It should arrive in {{days}} days.</p>",
  "<p>Questions? Reply to this email.</p>"
);
const V2 = V1.replace(
  "<p>Hi {{name}},</p>",
  '<p>Hi {{name | default: "there"}},</p>'
).replace(
  "<p>It should arrive in {{days}} days.</p>",
  "<p>It should arrive within {{days}} working days.</p>"
);
const shipped = (htmlContent: string): PluginEmailTemplate => ({
  slug: "orders-shipped",
  name: "Order shipped",
  subject: "Your order shipped",
  htmlContent,
  description: "Sent when an order ships.",
});

const logged: LogActivityInput[] = [];

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`template owners — ${entry.dialect}`, () => {
    let store: TemplateStore;

    /** A boot with the orders plugin at `html`, or without it when null. */
    async function boot(
      html: string | null,
      codeTemplates?: EmailConfig["templates"]
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({
        plugins:
          html === null ? [] : [{ name: ORDERS, templates: [shipped(html)] }],
        codeTemplates,
      });
      await service.ensureBuiltInTemplates();
      return service;
    }

    /** A boot with the orders plugin shipping `template`. */
    async function bootShipping(
      template: PluginEmailTemplate
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({
        plugins: [{ name: ORDERS, templates: [template] }],
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
      logged.length = 0;
      container.register("activityLogService", () => ({
        logActivity: (input: LogActivityInput) => {
          logged.push(input);
          return Promise.resolve();
        },
      }));
    });

    afterEach(() => {
      container.clear();
    });

    describe("owners update their templates", () => {
      it("stores the owner's new version at the next boot when the site has not overridden it", async () => {
        await boot(V1);
        const service = await boot(V2);
        const template = await shippedTemplate(service);
        expect(template.htmlContent).toBe(V2);
        expect(template.overridden).toBe(false);
        expect(template.owner).toEqual({
          kind: "plugin",
          name: ORDERS,
          installed: true,
        });
      });

      it("keeps the site's version when the owner's changes, and marks that it changed", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.overrideTemplate(id, undefined, ACTOR);
        await first.updateTemplate(
          id,
          { htmlContent: V1.replace("Hi", "Hello") },
          ACTOR
        );

        const second = await boot(V2);
        const template = await shippedTemplate(second);
        expect(template.overridden).toBe(true);
        expect(template.ownerChanged).toBe(true);
        expect(template.htmlContent).toBe(V1.replace("Hi", "Hello"));

        // The control: before the owner moved, nothing was waiting.
        const unchanged = await boot(V2);
        await unchanged.resetTemplate(id, ACTOR);
        expect((await shippedTemplate(unchanged)).ownerChanged).toBe(false);
      });

      it("overrides a template whose wording an editor changes, so the next boot keeps the edit", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.updateTemplate(id, { subject: "It's on its way!" }, ACTOR);

        const second = await boot(V2);
        const template = await shippedTemplate(second);
        expect(template.subject).toBe("It's on its way!");
        expect(template.htmlContent).toBe(V1);
        expect(template.ownerChanged).toBe(true);
        expect(logged.at(-1)).toMatchObject({
          action: "update",
          metadata: { operation: "override" },
        });
      });

      it("keeps an edit made while its plugin was away when the plugin comes back", async () => {
        await boot(V1);
        const away = await boot(null);
        const id = (await shippedTemplate(away)).id;
        await away.updateTemplate(id, { subject: "Shipped, from us" }, ACTOR);

        const back = await shippedTemplate(await boot(V1));
        expect(back).toMatchObject({
          subject: "Shipped, from us",
          overridden: true,
          ownerChanged: false,
        });
      });

      it("leaves an edit saved after the boot read the template", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        const second = store.newService();
        second.configureOwnership({
          plugins: [{ name: ORDERS, templates: [shipped(V2)] }],
        });
        const internals = second as unknown as {
          getRowBySlug(slug: string): Promise<unknown>;
          followOwner(row: unknown, entry: unknown): Promise<void>;
          registry: { owned: Map<string, unknown> };
        };
        // The boot's read, then an editor's save, then the boot's write.
        const stale = await internals.getRowBySlug("orders-shipped");
        await first.updateTemplate(id, { subject: "On its way" }, ACTOR);
        await internals.followOwner(
          stale,
          internals.registry.owned.get("orders-shipped")
        );

        const template = await shippedTemplate(second);
        expect(template).toMatchObject({
          subject: "On its way",
          htmlContent: V1,
          overridden: true,
        });
      });

      it("keeps a removed plugin's templates, as not installed, and lets the site delete them for good", async () => {
        await boot(V1);
        const without = await boot(null);
        const template = await shippedTemplate(without);
        expect(template.owner).toEqual({
          kind: "plugin",
          name: ORDERS,
          installed: false,
        });

        await without.deleteTemplate(template.id, ACTOR);
        const again = await boot(null);
        expect(await again.getTemplateBySlug("orders-shipped")).toBeNull();
      });
    });

    describe("override, review, undo and reset", () => {
      it("reviews two upstream changes one by one, with overlapping edits offered both ways, then undoes", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.overrideTemplate(id, undefined, ACTOR);
        // The site rewrote the greeting (the owner changes it too) and the
        // last line (the owner leaves it alone).
        const mine = V1.replace(
          "<p>Hi {{name}},</p>",
          "<p>Hello {{name}}, from the shop.</p>"
        ).replace(
          "<p>Questions? Reply to this email.</p>",
          "<p>Questions? Write to help@example.com.</p>"
        );
        await first.updateTemplate(id, { htmlContent: mine }, ACTOR);

        const service = await boot(V2);
        const comparison = await service.compareTemplate(id);
        expect(comparison.base.htmlContent).toBe(V1);
        expect(comparison.theirs.htmlContent).toBe(V2);
        expect(comparison.changes).toHaveLength(2);
        expect(comparison.changes[0]).toMatchObject({
          id: "htmlContent:0",
          conflict: true,
          theirs: ['<p>Hi {{name | default: "there"}},</p>'],
          mine: ["<p>Hello {{name}}, from the shop.</p>"],
        });
        expect(comparison.changes[1]).toMatchObject({
          id: "htmlContent:1",
          conflict: false,
        });

        logged.length = 0;
        const { template, undo } = await service.applyOwnerUpdate(
          id,
          {
            "htmlContent:0": {
              use: "edited",
              text: '<p>Hello {{name | default: "there"}}, from the shop.</p>',
            },
            "htmlContent:1": { use: "theirs" },
          },
          comparison.review,
          ACTOR
        );
        expect(template.htmlContent).toBe(
          lines(
            "<h1>Your order shipped</h1>",
            '<p>Hello {{name | default: "there"}}, from the shop.</p>',
            "<p>Order {{number}} left our warehouse.</p>",
            '<a href="{{trackingUrl}}">Track it</a>',
            "<p>It should arrive within {{days}} working days.</p>",
            "<p>Questions? Write to help@example.com.</p>"
          )
        );
        expect(template.overridden).toBe(true);
        expect(template.ownerChanged).toBe(false);
        expect(logged).toEqual([
          expect.objectContaining({
            action: "update",
            entryId: id,
            userId: ACTOR.id,
            metadata: expect.objectContaining({
              operation: "apply-owner-update",
            }),
          }),
        ]);

        // Rebased: the same changes are not offered again.
        expect((await service.compareTemplate(id)).changes).toEqual([]);

        // An undo meant for that state is refused once the template moved on.
        const edited = await service.updateTemplate(
          id,
          { subject: "Shipped!" },
          ACTOR
        );
        await expect(
          service.undoOwnerUpdate(id, undo, ACTOR)
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect((await shippedTemplate(service)).htmlContent).toBe(
          edited.htmlContent
        );
        await service.updateTemplate(id, { subject: template.subject }, ACTOR);

        const undone = await service.undoOwnerUpdate(id, undo, ACTOR);
        expect(undone.htmlContent).toBe(mine);
        expect(undone.ownerChanged).toBe(true);
        expect((await service.compareTemplate(id)).changes).toHaveLength(2);
      });

      it("refuses choices made on a comparison the template has since moved on from", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.overrideTemplate(id, undefined, ACTOR);
        const service = await boot(V2);
        const { review } = await service.compareTemplate(id);

        // Another editor saves the same lines in between.
        await service.updateTemplate(
          id,
          { htmlContent: V1.replace("Hi", "Hey") },
          ACTOR
        );
        await expect(
          service.applyOwnerUpdate(
            id,
            {
              "htmlContent:0": { use: "theirs" },
              "htmlContent:1": { use: "theirs" },
            },
            review,
            ACTOR
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect((await shippedTemplate(service)).htmlContent).toBe(
          V1.replace("Hi", "Hey")
        );
      });

      it("records a reset under the site's name for the template", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.updateTemplate(id, { name: "Parcel sent" }, ACTOR);
        await first.overrideTemplate(id, undefined, ACTOR);
        logged.length = 0;
        await first.resetTemplate(id, ACTOR);
        expect(logged.at(-1)).toMatchObject({
          entryTitle: "Parcel sent",
          metadata: expect.objectContaining({ operation: "reset" }),
        });
      });

      it("resets an override to the owner's current version and records it", async () => {
        await boot(V1);
        const service = await boot(V1);
        const id = (await shippedTemplate(service)).id;
        await service.overrideTemplate(id, undefined, ACTOR);
        await service.updateTemplate(id, { htmlContent: "<p>mine</p>" }, ACTOR);
        const later = await boot(V2);

        logged.length = 0;
        const reset = await later.resetTemplate(id, ACTOR);
        expect(reset.htmlContent).toBe(V2);
        expect(reset.overridden).toBe(false);
        expect(logged).toEqual([
          expect.objectContaining({
            action: "update",
            metadata: expect.objectContaining({ operation: "reset" }),
          }),
        ]);
      });

      it("records an override in the activity log", async () => {
        const service = await boot(V1);
        const id = (await shippedTemplate(service)).id;
        logged.length = 0;
        await service.overrideTemplate(id, undefined, ACTOR);
        expect(logged).toEqual([
          expect.objectContaining({
            action: "update",
            entryId: id,
            metadata: expect.objectContaining({ operation: "override" }),
          }),
        ]);
      });
    });

    describe("what the owner says, and what the site sets", () => {
      it("keeps the site's name and layout choice when the owner's version moves", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        await first.updateTemplate(
          id,
          { name: "Shipping notice", useLayout: false },
          ACTOR
        );
        expect((await shippedTemplate(first)).overridden).toBe(false);

        const template = await shippedTemplate(await boot(V2));
        expect(template.htmlContent).toBe(V2);
        expect(template).toMatchObject({
          name: "Shipping notice",
          useLayout: false,
          overridden: false,
        });
      });

      it("follows the owner's description and variables on an override, removals included, until the site changes them", async () => {
        const declared = [{ name: "number", description: "Order number" }];
        const first = await bootShipping({
          ...shipped(V1),
          variables: declared,
        });
        const id = (await shippedTemplate(first)).id;
        await first.overrideTemplate(id, undefined, ACTOR);

        // The owner drops both: an override the site left alone drops them too.
        const { description: _gone, ...bare } = shipped(V1);
        const dropped = await shippedTemplate(await bootShipping(bare));
        expect(dropped).toMatchObject({
          overridden: true,
          description: null,
          variables: null,
        });

        // Once the site has its own description, the owner's no longer replaces it.
        await first.updateTemplate(
          id,
          { description: "Our shipping email" },
          ACTOR
        );
        const kept = await shippedTemplate(
          await bootShipping({
            ...shipped(V1),
            description: "Owner's new text",
          })
        );
        expect(kept.description).toBe("Our shipping email");
      });

      it("overrides a template whose declared variables the site changes, and keeps them", async () => {
        const first = await boot(V1);
        const id = (await shippedTemplate(first)).id;
        const mine = [{ name: "carrier", description: "Who delivers it" }];
        await first.updateTemplate(id, { variables: mine }, ACTOR);
        expect((await shippedTemplate(first)).overridden).toBe(true);

        const later = await bootShipping({
          ...shipped(V1),
          variables: [{ name: "number" }],
        });
        expect((await shippedTemplate(later)).variables).toEqual(mine);
      });

      it("reads ownership from the registered config on a boot that did not configure it", async () => {
        container.register("config", () => ({
          plugins: [
            { name: ORDERS, contributes: { emailTemplates: [shipped(V1)] } },
          ],
        }));
        const service = store.newService();
        await service.ensureBuiltInTemplates();
        expect((await shippedTemplate(service)).owner).toEqual({
          kind: "plugin",
          name: ORDERS,
          installed: true,
        });
      });

      it("is the control: with no config to read, a boot only creates core's missing templates", async () => {
        const service = store.newService();
        await service.ensureBuiltInTemplates();
        expect(await service.getTemplateBySlug("orders-shipped")).toBeNull();
        expect(
          await service.getTemplateBySlug("password-reset")
        ).not.toBeNull();
      });
    });

    describe("deleting", () => {
      it("refuses to delete core's template or an installed plugin's, and offers Reset", async () => {
        const service = await boot(V1);
        for (const slug of [
          "password-reset",
          "default-layout",
          "orders-shipped",
        ]) {
          const template = await service.getTemplateBySlug(slug);
          await expect(
            service.deleteTemplate(template!.id, ACTOR)
          ).rejects.toMatchObject({
            code: "BUSINESS_RULE_VIOLATION",
            publicMessage: expect.stringContaining("Reset"),
          });
          expect(await service.getTemplateBySlug(slug)).not.toBeNull();
        }
      });

      it("deletes the site's own template, and the next boot does not recreate it", async () => {
        const service = await boot(V1);
        const own = await service.createTemplate(
          {
            name: "Newsletter",
            slug: "newsletter",
            subject: "Hi",
            htmlContent: "<p>Hi</p>",
          },
          ACTOR
        );
        await service.deleteTemplate(own.id, ACTOR);
        const next = await boot(V1);
        expect(await next.getTemplateBySlug("newsletter")).toBeNull();
      });
    });

    describe("which version is sent", () => {
      const fromCode = () => ({ subject: "Reset (code)", html: "<p>code</p>" });

      function sender(
        service: EmailTemplateService,
        codeTemplates?: EmailConfig["templates"]
      ) {
        const email = new EmailService(
          store.adapter,
          silentLogger,
          {} as EmailProviderService,
          service,
          { templates: codeTemplates } as EmailConfig
        );
        const send = vi
          .spyOn(email, "send")
          .mockResolvedValue({ success: true, messageId: "m" });
        return { email, send };
      }

      async function sentSubject(
        service: EmailTemplateService,
        codeTemplates?: EmailConfig["templates"]
      ) {
        const { email, send } = sender(service, codeTemplates);
        await email.sendWithTemplate("password-reset", "to@example.com", {
          appName: "Shop",
          resetLink: "https://example.com/r",
          expiresIn: "1 hour",
        });
        return (send.mock.calls[0]?.[0] as { subject: string }).subject;
      }

      it("sends the override, then the site's code, then the owner's default, as each is removed", async () => {
        const code = { passwordReset: fromCode };
        const service = await boot(V1, code);
        const id = (await service.getTemplateBySlug("password-reset"))!.id;
        await service.overrideTemplate(
          id,
          { version: { subject: "Reset (override)" } },
          ACTOR
        );

        expect(await sentSubject(service, code)).toBe("Reset (override)");

        await service.resetTemplate(id, ACTOR);
        expect(await sentSubject(service, code)).toBe("Reset (code)");

        const withoutCode = await boot(V1);
        expect(await sentSubject(withoutCode)).toBe("Reset your Shop password");
        expect(passwordResetTemplate.subject).toBe(
          "Reset your {{appName}} password"
        );
      });

      it("delivers the site's code version with the stored template's settings", async () => {
        const code = { passwordReset: fromCode };
        const service = await boot(V1, code);
        const id = (await service.getTemplateBySlug("password-reset"))!.id;
        await service.updateTemplate(
          id,
          { fromOverride: "shop@example.com", replyTo: "help@example.com" },
          ACTOR
        );
        const { email, send } = sender(service, code);
        await email.sendWithTemplate("password-reset", "to@example.com", {
          resetLink: "https://example.com/r",
        });
        expect(send.mock.calls[0]?.[0]).toMatchObject({
          subject: "Reset (code)",
          from: "shop@example.com",
          replyTo: "help@example.com",
        });
      });

      it("uses a configured passwordReset function on a fresh install", async () => {
        const code = { passwordReset: fromCode };
        const service = await boot(V1, code);
        const template = await service.getTemplateBySlug("password-reset");
        expect(template?.setInCode).toBe(true);
        expect(template?.overridden).toBe(false);
        expect(await sentSubject(service, code)).toBe("Reset (code)");
      });

      it("treats a plugin's replacement through its options as that template's default", async () => {
        // A site that configures the plugin to ship different wording: the
        // plugin contributes it, the row follows it, an override wins over
        // it, and Reset returns to it.
        const replaced = V1.replace(
          "Your order shipped",
          "Your parcel is on its way"
        );
        const service = await boot(replaced);
        const id = (await shippedTemplate(service)).id;
        expect((await shippedTemplate(service)).htmlContent).toBe(replaced);

        await service.overrideTemplate(
          id,
          { version: { htmlContent: "<p>mine</p>" } },
          ACTOR
        );
        expect((await shippedTemplate(await boot(replaced))).htmlContent).toBe(
          "<p>mine</p>"
        );

        const reset = await service.resetTemplate(id, ACTOR);
        expect(reset.htmlContent).toBe(replaced);
      });
    });
  });
}
