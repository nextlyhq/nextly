/**
 * The starter messages, through a real instance and the real email service.
 *
 * - After start, Settings › Email lists "Form submission" and "Form
 *   confirmation", so a new notification has a message to send.
 * - A submission to a form whose notification uses the team's starter sends an
 *   email listing every answer by its label, a choice by its option's label,
 *   and leaves out a question nobody answered.
 *
 * The provider is a real one that captures what it is handed, so the email
 * goes through the service's rendering exactly as a sent one does.
 */
import {
  defineEmailProvider,
  definePlugin,
  type PluginEmailTemplate,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  FORM_CONFIRMATION_TEMPLATE,
  FORM_SUBMISSION_TEMPLATE,
} from "../emails/starter-messages";
import { formBuilder } from "../plugin";

interface Captured {
  to: string | string[];
  subject: string;
  html: string;
}

const sent: Captured[] = [];

/** A provider that sends nothing and keeps what it was asked to send. */
const mailer = definePlugin({
  name: "@test/capturing-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<{ apiKey: string }>({
        type: "capturing-mailer",
        label: "Capturing mailer",
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            required: true,
            secret: true,
          },
        ],
        parseConfig: (input: unknown) => ({
          apiKey: String((input as { apiKey?: unknown }).apiKey ?? ""),
        }),
        createAdapter: () => ({
          send: async (opts: Captured) => {
            sent.push({ to: opts.to, subject: opts.subject, html: opts.html });
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
  },
} as never);

let current: TestNextly | undefined;
afterEach(async () => {
  sent.length = 0;
  const instance = current;
  current = undefined;
  await instance?.destroy();
});

/** The part of the email template service a boot uses to seed owners' templates. */
interface TemplateOwners {
  configureOwnership(input: {
    plugins: Array<{ name: string; templates: readonly PluginEmailTemplate[] }>;
  }): void;
  ensureBuiltInTemplates(): Promise<void>;
}

async function boot(
  dialect: Parameters<typeof createTestNextly>[0]["dialect"]
) {
  const fb = formBuilder();
  current = await createTestNextly({
    dialect,
    plugins: [fb.plugin, mailer],
  });
  // What a real start does after boot (`runPostInitTasks`), which the test
  // instance does not run: seed each plugin's contributed templates. Read from
  // the plugin's own contributions, so this proves they are contributed.
  const owners = current.getService(
    "emailTemplateService"
  ) as unknown as TemplateOwners;
  owners.configureOwnership({
    plugins: [
      {
        name: fb.plugin.name,
        templates: fb.plugin.contributes?.emailTemplates ?? [],
      },
    ],
  });
  await owners.ensureBuiltInTemplates();
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-mailer",
      fromEmail: "from@example.com",
      configuration: { apiKey: "throwaway-test-key" },
      isDefault: true,
    },
  } as never);
  return current;
}

describe.each(getConfiguredTestDialects())(
  "the starter messages (integration, %s)",
  dialect => {
    it("are listed in Settings › Email after start", async () => {
      const t = await boot(dialect);

      for (const slug of [
        FORM_SUBMISSION_TEMPLATE,
        FORM_CONFIRMATION_TEMPLATE,
      ]) {
        const found = (await t.nextly.emailTemplates.findBySlug({
          slug,
        } as never)) as unknown as { slug?: string; isActive?: boolean } | null;
        expect(found?.slug, slug).toBe(slug);
      }
    }, 60_000);

    it("send the team every answer by its label", async () => {
      const t = await boot(dialect);
      const form = (await t.nextly.create({
        collection: "forms",
        data: {
          name: "Job application",
          slug: "job-application",
          status: "published",
          fields: [
            { type: "text", name: "full_name", label: "Full name" },
            {
              type: "select",
              name: "role",
              label: "Role",
              options: [
                { label: "Backend engineer", value: "backend-engineer" },
              ],
            },
            { type: "textarea", name: "cover_letter", label: "Why this role?" },
          ],
          notifications: [
            {
              id: "team",
              name: "Hiring team",
              enabled: true,
              recipientType: "static",
              to: "jobs@example.com",
              cc: [],
              bcc: [],
              templateSlug: FORM_SUBMISSION_TEMPLATE,
            },
          ],
        },
      })) as unknown as { item: { id: string } };

      await t.nextly.create({
        collection: "form-submissions",
        data: {
          form: form.item.id,
          data: { full_name: "Hina Rossi", role: "backend-engineer" },
          status: "new",
          submittedAt: new Date(),
        },
      });

      await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(1);
      const [email] = sent;
      expect([email.to].flat()).toEqual(["jobs@example.com"]);
      expect(email.subject).toBe("New submission: Job application");
      expect(email.html).toContain("Full name");
      expect(email.html).toContain("Hina Rossi");
      expect(email.html).toContain("Backend engineer");
      expect(email.html).not.toContain("backend-engineer");
      // Left blank, so not listed.
      expect(email.html).not.toContain("Why this role?");
    }, 60_000);

    // An existing rule saved without a message stays unsent: the starters are
    // there now, but a rule never takes one by itself, so no email starts going
    // out after an upgrade to an address nobody has checked in months.
    it("leave an existing rule with no message unsent", async () => {
      const t = await boot(dialect);
      const form = (await t.nextly.create({
        collection: "forms",
        data: {
          name: "Old form",
          slug: "old-form",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          notifications: [
            {
              id: "old",
              name: "Old rule",
              enabled: true,
              recipientType: "static",
              to: "old@example.com",
              cc: [],
              bcc: [],
            },
          ],
        },
      })) as unknown as { item: { id: string } };

      await t.nextly.create({
        collection: "form-submissions",
        data: {
          form: form.item.id,
          data: { message: "hello" },
          status: "new",
          submittedAt: new Date(),
        },
      });
      // Long enough for a send that was going to happen to have happened: the
      // positive case above sees its email well inside this.
      await new Promise(resolve => setTimeout(resolve, 1_500));

      expect(sent).toEqual([]);
    }, 60_000);
  }
);
