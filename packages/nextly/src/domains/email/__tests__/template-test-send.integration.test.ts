/**
 * A template's test send reaches the person who asked for it, and nobody else.
 *
 * A test renders the template with sample data, so it is not the email anyone
 * on the template's copies expects. The template's own Cc and Bcc (a team
 * inbox, a manager) are left out: the only recipient is the signed-in user
 * who pressed Send test. Run against a real database on every dialect, through
 * the route's dispatcher, with a provider that records what it is handed.
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

/** A booted install with a capturing default provider, a template that copies two people, and a staff user. */
async function boot(dialect: TestDialect): Promise<{
  templateId: string;
  staffId: string;
}> {
  const t = await createTestNextly({ dialect, plugins: [mailer] });
  current = t;
  await t.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-test-send",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
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
