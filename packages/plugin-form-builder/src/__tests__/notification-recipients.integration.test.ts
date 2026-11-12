/**
 * Notifications with several recipients, several conditions and their own
 * attachments, through a real submission and the queued send, on every
 * dialect. And the compatibility promise: a notification saved before these
 * existed (one address, one condition, files attached by the field's own
 * switch, the visitor's address and Reply-To from a field) sends exactly as
 * it did.
 */
import {
  defineEmailProvider,
  definePlugin,
  type PluginEmailTemplate,
} from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { FORM_SUBMISSION_TEMPLATE } from "../emails/starter-messages";
import { formBuilder } from "../plugin";
import type { FormEmailNotification } from "../types";

/** What the provider was asked to send. */
const sent: Array<{ to: string | string[]; replyTo?: string }> = [];
/** What the notifications resolved to, read at the plugin's own seam. */
const built: FormEmailNotification[] = [];

const mailer = definePlugin({
  name: "@test/recipients-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "recipients-mailer",
        label: "Recipients mailer",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (opts: { to: string | string[]; replyTo?: string }) => {
            sent.push({ to: opts.to, replyTo: opts.replyTo });
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
  },
} as never);

/** The part of the email template service a boot uses to seed templates. */
interface TemplateOwners {
  configureOwnership(input: {
    plugins: Array<{ name: string; templates: readonly PluginEmailTemplate[] }>;
  }): void;
  ensureBuiltInTemplates(): Promise<void>;
}

let current: TestNextly | undefined;
afterEach(async () => {
  sent.length = 0;
  built.length = 0;
  await current?.destroy();
  current = undefined;
});

const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  { type: "email", name: "email", label: "Email" },
  { type: "email", name: "work_email", label: "Work email" },
  { type: "checkbox", name: "access", label: "Access needs" },
  {
    type: "select",
    name: "join",
    label: "Joining",
    options: [
      { label: "In person", value: "in_person" },
      { label: "Online", value: "online" },
    ],
  },
  { type: "file", name: "cv", label: "CV", attachToEmail: true },
  { type: "file", name: "photo", label: "Photo" },
];

/** A notification, as the form stores it. */
const notification = (rest: Record<string, unknown>) => ({
  id: String(rest.id),
  name: String(rest.id),
  enabled: true,
  recipientType: "static",
  to: "",
  cc: [],
  bcc: [],
  templateSlug: FORM_SUBMISSION_TEMPLATE,
  ...rest,
});

async function boot(dialect: TestDialect, notifications: unknown[]) {
  const fb = formBuilder({
    // Read at the plugin's own seam, passed on unchanged.
    beforeEmail: ({ emails }) => {
      built.push(...emails);
      return emails;
    },
  });
  current = await createTestNextly({ dialect, plugins: [fb.plugin, mailer] });
  const t = current;
  const owners = t.getService(
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
  await t.nextly.emailProviders.create({
    data: {
      name: "Recipients",
      type: "recipients-mailer",
      fromEmail: "from@example.com",
      configuration: {},
      isDefault: true,
    },
  } as never);
  const form = await t.nextly.create({
    collection: "forms",
    data: {
      name: "Meetup",
      slug: "meetup",
      status: "published",
      fields: FIELDS,
      notifications,
    },
  });
  const submit = (data: Record<string, unknown>) =>
    t.nextly.create({
      collection: "form-submissions",
      data: {
        form: form.item.id,
        data,
        status: "new",
        submittedAt: new Date().toISOString(),
      },
    });
  return { submit };
}

/** The email a notification resolved to. */
const builtFor = (id: string) =>
  built.find(email => email.notificationId === id);

const ANSWERS = {
  name: "Ada",
  email: "ada@example.com",
  work_email: "ada@work.example",
  access: true,
  join: "in_person",
  cv: "media-cv",
  photo: "media-photo",
};

describe.each(getConfiguredTestDialects())(
  "a form's notifications (%s)",
  dialect => {
    it("sends a notification saved before these changes exactly as before", async () => {
      const { submit } = await boot(dialect, [
        notification({
          id: "team",
          to: "team@example.com",
          condition: {
            field: "join",
            comparison: "equals",
            value: "in_person",
          },
          replyTo: "{{email}}",
        }),
        notification({
          id: "visitor",
          recipientType: "field",
          to: "{{work_email}}",
          replyTo: "{{email}}",
        }),
        // Its one condition does not hold for these answers.
        notification({
          id: "online",
          to: "online@example.com",
          condition: { field: "join", comparison: "equals", value: "online" },
        }),
      ]);
      // Files would name media this test does not store, so the provider
      // is checked on a submission without any, and the files on the next.
      await submit({ ...ANSWERS, cv: undefined, photo: undefined });

      // One address stays a string; Reply-To from the chosen field.
      expect(builtFor("team")).toMatchObject({
        to: "team@example.com",
        replyTo: "ada@example.com",
      });
      // The visitor's address from the field the notification names.
      expect(builtFor("visitor")).toMatchObject({
        to: "ada@work.example",
        replyTo: "ada@example.com",
      });
      expect(builtFor("online")).toBeUndefined();
      expect(sent.map(each => each.to).sort()).toEqual(
        ["ada@work.example", "team@example.com"].sort()
      );
      expect(sent.every(each => each.replyTo === "ada@example.com")).toBe(true);

      // Files from the field marked to attach, and only those.
      built.length = 0;
      await submit(ANSWERS);
      expect(builtFor("team")?.attachments).toEqual([{ mediaId: "media-cv" }]);
      expect(builtFor("visitor")?.attachments).toEqual([
        { mediaId: "media-cv" },
      ]);
    }, 60_000);

    it("sends one email to several team addresses", async () => {
      const { submit } = await boot(dialect, [
        notification({
          id: "team",
          to: "events@example.com",
          recipients: ["events@example.com", "access@example.com"],
          attachFields: [],
        }),
      ]);
      await submit(ANSWERS);

      expect(builtFor("team")?.to).toEqual([
        "events@example.com",
        "access@example.com",
      ]);
      // Core delivers to each address of the email.
      expect(sent.flatMap(each => [each.to].flat()).sort()).toEqual([
        "access@example.com",
        "events@example.com",
      ]);
    }, 60_000);

    it("sends only when all, or any, of several conditions hold", async () => {
      const both = [
        { field: "access", comparison: "equals", value: true },
        { field: "join", comparison: "equals", value: "online" },
      ];
      const { submit } = await boot(dialect, [
        notification({
          id: "all",
          to: "all@example.com",
          conditions: { match: "all", list: both },
        }),
        notification({
          id: "any",
          to: "any@example.com",
          conditions: { match: "any", list: both },
        }),
      ]);
      // Needs access, joining in person: one of the two holds.
      await submit(ANSWERS);

      expect(builtFor("any")).toBeDefined();
      expect(builtFor("all")).toBeUndefined();
    }, 60_000);

    it("attaches each notification's own file fields", async () => {
      const { submit } = await boot(dialect, [
        notification({
          id: "team",
          to: "team@example.com",
          attachFields: ["cv"],
        }),
        notification({
          id: "security",
          to: "security@example.com",
          attachFields: ["photo"],
        }),
        notification({
          id: "visitor",
          recipientType: "field",
          to: "{{email}}",
          attachFields: [],
        }),
      ]);
      await submit(ANSWERS);

      expect(builtFor("team")?.attachments).toEqual([{ mediaId: "media-cv" }]);
      expect(builtFor("security")?.attachments).toEqual([
        { mediaId: "media-photo" },
      ]);
      expect(builtFor("visitor")?.attachments).toEqual([]);
    }, 60_000);
  }
);
