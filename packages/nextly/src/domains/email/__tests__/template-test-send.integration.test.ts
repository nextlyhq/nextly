/**
 * A template's test send reaches the person who asked for it, and nobody else,
 * with what is on their screen.
 *
 * A test renders the template with sample data, so it is not the email anyone
 * on the template's copies expects. The template's own Cc and Bcc (a team
 * inbox, a manager) are left out: the only recipient is the signed-in user
 * who pressed Send test. With the editor's draft it sends the unsaved edits,
 * through the same render path as a real send, and it names the provider that
 * delivers it, which for the log provider is nobody. Run against a real
 * database on every dialect, through the route's dispatcher, with a provider
 * that records what it is handed.
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
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { defineEmailProvider } from "../provider-definition";
import type { EmailTemplateService } from "../services/email-template-service";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const STAFF = "staff@example.com";
const TEAM = "team@example.com";
const MANAGER = "manager@example.com";

/** Every message the capturing provider was handed, in order. */
const sent: SentOptions[] = [];

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  sent.length = 0;
});

const mailer = definePlugin({
  name: "test-send-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "capturing-test-send",
        label: "Capturing",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (options: SentOptions) => {
            sent.push(options);
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
  },
} as never);

/**
 * A booted install with a template that copies two people and a staff user;
 * with a capturing default provider unless `provider` is false, when sends
 * fall back to the log provider.
 */
async function boot(
  dialect: TestDialect,
  { provider = true }: { provider?: boolean } = {}
): Promise<{
  templateId: string;
  staffId: string;
}> {
  const t = await createTestNextly({ dialect, plugins: [mailer] });
  current = t;
  if (provider) {
    await t.nextly.emailProviders.create({
      data: {
        name: "Capturing",
        type: "capturing-test-send",
        fromEmail: "provider@example.com",
        configuration: {},
        isDefault: true,
      },
    });
  }
  const { item } = await t.nextly.emailTemplates.create({
    data: {
      name: "Order note",
      slug: "order-note",
      subject: "Order {{ number }}",
      htmlContent: "<p>Order {{ number }}</p>",
      cc: [TEAM],
      bcc: [MANAGER],
      isActive: true,
    },
  });
  const staff = await new ServiceContainer(t.adapter).users.createLocalUser({
    email: STAFF,
    name: "Staff",
    password: "Str0ng-P@ssw0rd!",
    isActive: true,
    emailVerification: "admin-vouched",
  });
  return { templateId: item.id, staffId: String(staff.id) };
}

/** A route's dispatcher, called as the staff user; the response body. */
async function asStaff(
  staffId: string,
  method: string,
  params: Record<string, string>,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await asCaller(sessionCaller({ userId: staffId }), () =>
    dispatchEmailTemplates(method, params, body)
  );
  return (await (response as Response).json()) as Record<string, unknown>;
}

/** Every address a message was handed to, To, Cc and Bcc together. */
function everyone(message: SentOptions): string[] {
  const list = (value: string | string[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  return [...list(message.to), ...list(message.cc), ...list(message.bcc)];
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a template's test send — ${dialect}`, () => {
    it("reaches only the signed-in user, never the template's Cc or Bcc", async () => {
      const { templateId, staffId } = await boot(dialect);

      await asCaller(sessionCaller({ userId: staffId }), () =>
        dispatchEmailTemplates(
          "sendTestTemplate",
          { templateId },
          { variables: { number: "1042" } }
        )
      );

      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("Order 1042");
      expect(everyone(sent[0])).toEqual([STAFF]);
    });

    it("sends what is on screen, unsaved edits included, and leaves the stored template as it was", async () => {
      const { templateId, staffId } = await boot(dialect);

      await asStaff(
        staffId,
        "sendTestTemplate",
        { templateId },
        {
          variables: { number: "1042" },
          draft: {
            subject: "Draft {{ number }}",
            htmlContent: "<p>Draft for {{ number }}</p>",
          },
        }
      );

      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("Draft 1042");
      expect(sent[0].html).toContain("<p>Draft for 1042</p>");
      expect(everyone(sent[0])).toEqual([STAFF]);
      // A test saves nothing.
      const stored = await (
        current!.getService(
          "emailTemplateService"
        ) as unknown as EmailTemplateService
      ).getTemplate(templateId);
      expect(stored.subject).toBe("Order {{ number }}");
    });

    it("names the provider that will deliver it, before and after sending", async () => {
      const { templateId, staffId } = await boot(dialect);
      const capturing = {
        provider: "Capturing",
        type: "capturing-test-send",
        delivers: true,
      };

      expect(await asStaff(staffId, "testSendTarget", { templateId })).toEqual({
        to: STAFF,
        delivery: capturing,
      });
      const result = await asStaff(
        staffId,
        "sendTestTemplate",
        { templateId },
        { variables: { number: "1042" } }
      );
      expect(result).toMatchObject({ success: true, delivery: capturing });
    });

    it("says when the provider delivers nothing: the log provider", async () => {
      const { templateId, staffId } = await boot(dialect, { provider: false });
      const log = { type: "log", delivers: false };

      expect(
        await asStaff(staffId, "testSendTarget", { templateId })
      ).toMatchObject({ to: STAFF, delivery: log });
      const result = await asStaff(
        staffId,
        "sendTestTemplate",
        { templateId },
        { variables: { number: "1042" } }
      );
      // The log provider reports success and delivers nothing.
      expect(result).toMatchObject({ success: true, delivery: log });
      expect(sent).toHaveLength(0);
    });

    it("previews the inbox line as the sent email renders it", async () => {
      await boot(dialect);
      const templates = current!.getService(
        "emailTemplateService"
      ) as unknown as EmailTemplateService;
      const draft = {
        subject: "Hello",
        htmlContent: "<p>Hi</p>",
        plainTextContent: null,
        useLayout: false,
        kind: "template" as const,
        layoutId: null,
      };

      // The preview text renders into the email's HTML, so its markup is
      // markup and its values are escaped there; an inbox shows that as text.
      const preview = await templates.previewDraft(
        { ...draft, preheader: "Hi <b>{{ name }}</b> & welcome" },
        { name: "Priya" }
      );
      expect(preview.preheader).not.toContain("<b>");
      expect(preview.preheader).toContain("Priya");

      // A link in it shows as its text, as an inbox shows it: the plain-text
      // part's "(https://…)" is not in the inbox line.
      const linked = await templates.previewDraft(
        {
          ...draft,
          preheader: 'See <a href="https://example.com/o/1">your order</a>',
        },
        {}
      );
      expect(linked.preheader).toBe("See your order");

      // A From that can't render fails the preview, as it fails the send.
      await expect(
        templates.previewDraft(
          { ...draft, fromOverride: "{{ name | nope }} <shop@example.com>" },
          { name: "Priya" }
        )
      ).rejects.toBeDefined();

      // A variable in the From address, which a save refuses, shows as written.
      const asWritten = await templates.previewDraft(
        { ...draft, fromOverride: "Shop <{{ address }}>" },
        {}
      );
      expect(asWritten.from).toBe("Shop <{{ address }}>");
    });

    it("still copies the template's Cc and Bcc on a real send", async () => {
      // The control: the copies are stored and honoured, so leaving them out
      // of the test is the test send's doing, not a template without them.
      await boot(dialect);

      await current!.nextly.email.sendWithTemplate({
        template: "order-note",
        to: "customer@example.com",
        variables: { number: "1042" },
      });

      expect(sent).toHaveLength(1);
      expect(sent[0].cc).toEqual([TEAM]);
      expect(sent[0].bcc).toEqual([MANAGER]);
    });
  });
}
