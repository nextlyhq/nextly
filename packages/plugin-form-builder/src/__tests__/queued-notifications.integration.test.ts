/**
 * A form's notifications through the real queued send.
 *
 * A notification whose first attempt fails for a reason a retry can help is
 * kept and sent by the next run of the jobs trigger, rather than dropped as a
 * one-shot send would drop it. The provider is a real one that fails its first
 * send and captures every later one, so the email goes through the queue, its
 * job and the service's rendering exactly as a site's would.
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
import { runJobsPass } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { FORM_SUBMISSION_TEMPLATE } from "../emails/starter-messages";
import { formBuilder } from "../plugin";

const sent: Array<{ to: string | string[]; subject: string }> = [];
/** How many sends the provider fails before it takes one. */
const behaviour = { failures: 0 };

/** A provider that fails as told, then keeps what it was asked to send. */
const mailer = definePlugin({
  name: "@test/flaky-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<{ apiKey: string }>({
        type: "flaky-mailer",
        label: "Flaky mailer",
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
          send: async (opts: { to: string | string[]; subject: string }) => {
            if (behaviour.failures > 0) {
              behaviour.failures -= 1;
              // Thrown and unclassified: a failure a retry can help.
              throw new Error("provider down");
            }
            sent.push({ to: opts.to, subject: opts.subject });
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
  behaviour.failures = 0;
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
  current = await createTestNextly({ dialect, plugins: [fb.plugin, mailer] });
  // What a real start does after boot, which the test instance does not run.
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
      name: "Flaky",
      type: "flaky-mailer",
      fromEmail: "from@example.com",
      configuration: { apiKey: "throwaway-test-key" },
      isDefault: true,
    },
  } as never);
  return current;
}

/** One run of the jobs trigger, as `/api/jobs/run` makes it, at `now`. */
function trigger(t: TestNextly, now: Date) {
  return runJobsPass(t.adapter as never, t.getService("jobRegistry" as never), {
    now: () => now,
  });
}

/** A time past any backoff the queue could have scheduled for a first retry. */
const later = () => new Date(Date.now() + 2 * 60 * 60_000);

describe.each(getConfiguredTestDialects())(
  "a form's notifications on the queued send (integration, %s)",
  dialect => {
    it("sends a notification whose first attempt failed on the next jobs run", async () => {
      const t = await boot(dialect);
      behaviour.failures = 1;

      const form = (await t.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          notifications: [
            {
              id: "team",
              name: "Team",
              enabled: true,
              recipientType: "static",
              to: "team@example.com",
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
          data: { message: "hello" },
          status: "new",
          submittedAt: new Date(),
        },
      });

      // The first attempt failed: nothing went out, and nothing was dropped.
      expect(behaviour.failures).toBe(0);
      expect(sent).toEqual([]);

      await trigger(t, later());

      expect(sent).toHaveLength(1);
      expect([sent[0]!.to].flat()).toEqual(["team@example.com"]);
      expect(sent[0]!.subject).toBe("New submission: Contact");
    }, 60_000);
  }
);
