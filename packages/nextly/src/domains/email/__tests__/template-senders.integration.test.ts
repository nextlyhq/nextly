/**
 * What sends each email template, through the admin's routes.
 *
 * A template's owner says what sends it (core's built-ins, a plugin's
 * `sentBy`), and settings that send a template report it through the
 * `email.templateReferences` seam, as form-builder's notification rules do.
 * The list carries both on every row; the senders route answers for one
 * template before it is deleted, and says so when a plugin couldn't be asked.
 * Run against a real database on every dialect, through the dispatcher.
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  asCaller,
  sessionCaller,
} from "../../../dispatcher/__tests__/request-caller";
import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import { resetFilterRegistry } from "../../../filters/filter-registry";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { EmailTemplateService } from "../services/email-template-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

const CONTACT_RULE = "Form: Contact us, Notify team";

/**
 * A shop plugin: it owns one template and says what sends it, and its
 * settings send a site template, as a form's notification rule does.
 */
function shop(references: () => unknown) {
  return definePlugin({
    name: "@acme/shop",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      emailTemplates: [
        {
          slug: "shop-order-paid",
          name: "Order paid",
          subject: "Paid",
          htmlContent: "<p>Paid</p>",
          sentBy: ["A shop order is paid"],
        },
      ],
    },
    init(ctx: PluginContext) {
      ctx.filters.add("email.templateReferences", (refs: unknown[]) => [
        ...refs,
        ...(references() as unknown[]),
      ]);
    },
  } as never);
}

async function boot(
  dialect: TestDialect,
  references: () => unknown
): Promise<{ t: TestNextly; staffId: string; ids: Record<string, string> }> {
  const t = await createTestNextly({ dialect, plugins: [shop(references)] });
  current = t;
  await (
    t.getService("emailTemplateService") as unknown as EmailTemplateService
  ).ensureBuiltInTemplates();
  const ids: Record<string, string> = {};
  for (const slug of ["contact-reply", "unused-note"]) {
    const { item } = await t.nextly.emailTemplates.create({
      data: {
        name: slug,
        slug,
        subject: "Hello",
        htmlContent: "<p>Hello</p>",
        isActive: true,
      },
    });
    ids[slug] = item.id;
  }
  const staff = await new ServiceContainer(t.adapter).users.createLocalUser({
    email: "staff@example.com",
    name: "Staff",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return { t, staffId: String(staff.id), ids };
}

async function asStaff(
  staffId: string,
  method: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const response = await asCaller(sessionCaller({ userId: staffId }), () =>
    dispatchEmailTemplates(method, params, undefined)
  );
  return (await (response as Response).json()) as Record<string, unknown>;
}

type Row = {
  slug: string;
  sentBy?: { declared: string[]; referenced: string[] };
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`what sends each email — ${dialect}`, () => {
    it("lists, for every template, what its owner says and the settings that send it", async () => {
      const { staffId } = await boot(dialect, () => [
        { slug: "contact-reply", label: CONTACT_RULE },
      ]);

      const list = await asStaff(staffId, "listTemplates", {});
      const rows = new Map(
        (list.templates as Row[]).map(row => [row.slug, row.sentBy])
      );

      // Core's own.
      expect(rows.get("password-reset")?.declared).toEqual([
        "Someone asks to reset their password",
      ]);
      // A plugin's, as it declares it.
      expect(rows.get("shop-order-paid")).toEqual({
        declared: ["A shop order is paid"],
        referenced: [],
      });
      // A site template a setting sends.
      expect(rows.get("contact-reply")).toEqual({
        declared: [],
        referenced: [CONTACT_RULE],
      });
      // A site template nothing sends.
      expect(rows.get("unused-note")).toEqual({ declared: [], referenced: [] });
      expect(list.referencesComplete).toBe(true);
    });

    it("names what would stop sending before a template is deleted", async () => {
      const { staffId, ids } = await boot(dialect, () => [
        { slug: "contact-reply", label: CONTACT_RULE },
      ]);

      expect(
        await asStaff(staffId, "templateSenders", {
          templateId: ids["contact-reply"],
        })
      ).toEqual({ declared: [], referenced: [CONTACT_RULE], complete: true });
    });

    it("says the senders couldn't all be checked when a plugin fails to answer", async () => {
      const { staffId, ids } = await boot(dialect, () => {
        throw new Error("the forms can't be read");
      });

      // Not "nothing sends this": the plugin that would have said is unknown.
      expect(
        await asStaff(staffId, "templateSenders", {
          templateId: ids["contact-reply"],
        })
      ).toEqual({ declared: [], referenced: [], complete: false });
      expect(
        (await asStaff(staffId, "listTemplates", {})).referencesComplete
      ).toBe(false);
    });
  });
}
