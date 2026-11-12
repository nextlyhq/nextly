/**
 * A submission's notifications are queued with it and called off with it, on
 * every dialect:
 *
 * - each active notification whose conditions the answers meet is queued, in
 *   the transaction that stores the submission, with the record of it, and no
 *   other notification is;
 * - a transaction stopped after the submission's insert and before its commit
 *   leaves neither the submission nor its queued email nor the record;
 * - a submission caught by a spam check (the honeypot, reCAPTCHA, Turnstile)
 *   queues nothing, and marking it Not spam queues nothing either;
 * - marking a submission Spam cancels and clears a notification waiting to
 *   retry, and one that failed with its message still held, in the marking's
 *   transaction; one already with the provider ends Sent if the provider takes
 *   it and Cancelled if it fails.
 *
 * The provider is a real one that captures, fails, refuses or holds as each
 * case says, so every email goes through the queue, its job and the service.
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
import { runJobsPass } from "nextly";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SUBMISSION_SENDS_SLUG } from "../collections/sends";
import { FORM_SUBMISSION_TEMPLATE } from "../emails/starter-messages";
import { formBuilder } from "../plugin";

/** The bot-check provider's answer, as each case sets it. */
const verdict = vi.hoisted(() => ({ value: { success: true } as unknown }));

vi.mock("../handlers/bot-check-send", async original => ({
  ...(await original<typeof import("../handlers/bot-check-send")>()),
  sendVerification: vi.fn(async () => verdict.value),
}));

const TEAM = "team@example.com";

/** Every `to` the provider took, in order. */
const sent: string[] = [];

/** A promise and the function that settles it. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
}

/** What the provider does with its next calls. */
const behaviour: {
  mode: "send" | "retryable" | "refused";
  /** Held here until opened, once the call has arrived. */
  gate?: Promise<void>;
  reached?: () => void;
} = { mode: "send" };

/** A provider that sends, fails as a retry can help, refuses, or holds. */
const mailer = definePlugin({
  name: "@test/sends-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "sends-mailer",
        label: "Sends mailer",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (opts: { to: string | string[] }) => {
            if (behaviour.gate) {
              behaviour.reached?.();
              await behaviour.gate;
            }
            if (behaviour.mode === "retryable") {
              throw new Error("provider down");
            }
            if (behaviour.mode === "refused") {
              // Classified by the provider: no retry can help.
              throw Object.assign(new Error("refused"), {
                emailFailure: { retryable: false, reason: "Refused." },
              });
            }
            sent.push(...[opts.to].flat());
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
  behaviour.mode = "send";
  behaviour.gate = undefined;
  behaviour.reached = undefined;
  verdict.value = { success: true };
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

/** The in-transaction create, as the collections handler serves it. */
interface EntryService {
  createEntryInTransaction(
    tx: unknown,
    params: { collectionName: string; overrideAccess: boolean },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
}

interface QueueRow {
  id: string;
  state: string;
  message: string | null;
}

/** A notification to the team, active, as each case starts from. */
const teamNotification = {
  id: "team",
  name: "Team",
  enabled: true,
  recipientType: "static",
  to: TEAM,
  cc: [],
  bcc: [],
  templateSlug: FORM_SUBMISSION_TEMPLATE,
};

/**
 * An instance with the form builder and the provider as the default, and a
 * published form whose notifications are `notifications`.
 */
async function boot(
  dialect: TestDialect,
  options: {
    notifications?: Array<Record<string, unknown>>;
    spamProtection?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  } = {}
) {
  const fb = formBuilder(
    options.spamProtection
      ? { spamProtection: options.spamProtection }
      : undefined
  );
  current = await createTestNextly({
    dialect,
    plugins: [fb.plugin, mailer],
    seedPublic: true,
  });
  const t = current;
  // What a real start does after boot, which the test instance does not run.
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
      name: "Sends",
      type: "sends-mailer",
      fromEmail: "from@example.com",
      configuration: {},
      isDefault: true,
    },
  } as never);
  const form = await t.nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: [{ type: "text", name: "message", label: "Message" }],
      notifications: options.notifications ?? [teamNotification],
      settings: { honeypotEnabled: false, ...options.settings },
    },
  });
  const formId = String(form.item.id);

  const submissionData = (message: string) => ({
    form: formId,
    data: { message },
    status: "new",
    submittedAt: new Date(),
  });
  const submit = async (message: string) =>
    String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: submissionData(message),
        })
      ).item.id
    );

  /** Mark a submission with `status`, as the admin's actions do. */
  const mark = (id: string, status: string) =>
    t.nextly.update({
      collection: "form-submissions",
      id,
      data: { status, _overwrite: true },
    });

  /** What the submission recorded as sent. */
  const sendsOf = async (id: string) =>
    (
      await t.nextly.find({
        collection: SUBMISSION_SENDS_SLUG,
        where: { submission: { equals: id } },
        limit: 100,
      })
    ).items as Array<{ queuedId: string }>;

  const queue = () => t.adapter.select<QueueRow>("email_queue", {});
  const queued = async (id: string): Promise<QueueRow> => {
    const row = (await queue()).find(candidate => candidate.id === id);
    if (!row) throw new Error(`no queued email ${id}`);
    return row;
  };

  /** One jobs trigger, past any backoff the queue scheduled. */
  const trigger = () =>
    runJobsPass(t.adapter as never, t.getService("jobRegistry" as never), {
      now: () => new Date(Date.now() + 2 * 60 * 60_000),
    });

  const handler = t.getService("collectionsHandler") as {
    getEntryService(): EntryService;
  };
  const entries = handler.getEntryService();

  return {
    t,
    formId,
    submissionData,
    submit,
    mark,
    sendsOf,
    queue,
    queued,
    trigger,
    entries,
  };
}

const params = (...segments: string[]) => ({
  params: Promise.resolve({ params: segments }),
});

/** Post a submission to the form through the public route. */
async function post(data: Record<string, unknown>): Promise<void> {
  const response = await createDynamicHandlers().POST(
    new Request("http://localhost/api/forms/contact/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { message: "hello", ...data } }),
    }),
    params("forms", "contact", "submit")
  );
  expect(response.status).toBe(201);
}

describe.each(getConfiguredTestDialects())(
  "a submission's notifications, queued and called off with it (%s)",
  dialect => {
    it("queues each active notification whose conditions match, and no other", async () => {
      const b = await boot(dialect, {
        notifications: [
          teamNotification,
          {
            ...teamNotification,
            id: "off",
            to: "off@example.com",
            enabled: false,
          },
          {
            ...teamNotification,
            id: "vip",
            to: "vip@example.com",
            condition: { field: "message", comparison: "equals", value: "vip" },
          },
        ],
      });

      const id = await b.submit("hello");

      expect(await b.queue()).toHaveLength(1);
      expect(await b.sendsOf(id)).toHaveLength(1);
      expect(sent).toEqual([TEAM]);
    }, 60_000);

    it("queues the notification inside the submission's transaction, so a stop before the commit leaves neither", async () => {
      const b = await boot(dialect);
      const inside: { queued: number; records: number } = {
        queued: -1,
        records: -1,
      };

      await expect(
        b.t.adapter.transaction(async tx => {
          const created = await b.entries.createEntryInTransaction(
            tx,
            { collectionName: "form-submissions", overrideAccess: true },
            b.submissionData("hello")
          );
          expect(created.success, JSON.stringify(created)).toBe(true);
          // Seen on the transaction itself: queued and recorded with the
          // submission, before anything has committed.
          inside.queued = (await tx.select("email_queue", {})).length;
          inside.records = (
            await tx.select("dc_form_submission_sends", {})
          ).length;
          throw new Error("stopped before the commit");
        })
      ).rejects.toThrow("stopped before the commit");

      expect(inside).toEqual({ queued: 1, records: 1 });
      // Each reported on its own, so a run shows every one that failed.
      expect.soft(await b.queue()).toEqual([]);
      expect
        .soft(
          (await b.t.nextly.find({ collection: SUBMISSION_SENDS_SLUG })).items
        )
        .toEqual([]);
      expect
        .soft((await b.t.nextly.find({ collection: "form-submissions" })).items)
        .toEqual([]);
      await b.trigger();
      expect.soft(sent).toEqual([]);
    }, 60_000);

    // The control: the same transaction committed keeps all three, and the
    // email goes once the commit has happened.
    it("keeps the submission, its queued email and its record when the transaction commits", async () => {
      const b = await boot(dialect);

      await b.t.adapter.transaction(async tx => {
        await b.entries.createEntryInTransaction(
          tx,
          { collectionName: "form-submissions", overrideAccess: true },
          b.submissionData("hello")
        );
        expect(sent).toEqual([]);
      });

      const [row] = await b.queue();
      expect(row?.state).toBe("sent");
      expect(
        (await b.t.nextly.find({ collection: SUBMISSION_SENDS_SLUG })).items
      ).toHaveLength(1);
      expect(sent).toEqual([TEAM]);
    }, 60_000);

    it("queues nothing for a submission each spam check catches, nor once it is marked Not spam", async () => {
      const b = await boot(dialect, {
        spamProtection: {
          honeypot: true,
          recaptcha: { enabled: false, siteKey: "site", secretKey: "secret" },
          turnstile: { enabled: false, siteKey: "site", secretKey: "secret" },
        },
        settings: { honeypotEnabled: true },
      });
      const formsSet = (settings: Record<string, unknown>) =>
        b.t.nextly.update({
          collection: "forms",
          id: b.formId,
          data: {
            settings: { honeypotEnabled: true, ...settings },
            _overwrite: true,
          },
        });

      // The control: a clean submission through the same route is queued.
      await post({});
      expect(await b.queue()).toHaveLength(1);

      await post({ _honeypot: "filled" });
      await formsSet({ botCheck: "recaptcha" });
      verdict.value = { success: true, score: 0.1 };
      await post({ "g-recaptcha-response": "low" });
      await formsSet({ botCheck: "turnstile" });
      verdict.value = { success: false };
      await post({ "cf-turnstile-response": "bad" });

      const { items } = await b.t.nextly.find({
        collection: "form-submissions",
        where: { status: { equals: "spam" } },
      });
      const spam = items as Array<{ id: string; spamReason: string }>;
      expect(spam.map(row => row.spamReason).sort()).toEqual([
        "honeypot",
        "recaptcha",
        "turnstile",
      ]);
      for (const row of spam) await b.mark(String(row.id), "read");
      await b.trigger();

      expect(await b.queue()).toHaveLength(1);
      for (const row of spam) expect(await b.sendsOf(row.id)).toEqual([]);
      expect(sent).toEqual([TEAM]);
    }, 120_000);

    it("cancels and clears one waiting to retry when the submission is marked Spam", async () => {
      const b = await boot(dialect);
      behaviour.mode = "retryable";
      const id = await b.submit("hello");
      const [send] = await b.sendsOf(id);
      expect((await b.queued(send!.queuedId)).state).toBe("waiting");

      await b.mark(id, "spam");
      behaviour.mode = "send";
      await b.trigger();

      expect(await b.queued(send!.queuedId)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(sent).toEqual([]);
      // Kept, so deleting the submission still forgets what it sent.
      expect(await b.sendsOf(id)).toHaveLength(1);
    }, 60_000);

    it("cancels and clears one that failed with its message still held", async () => {
      const b = await boot(dialect);
      behaviour.mode = "refused";
      const id = await b.submit("hello");
      const [send] = await b.sendsOf(id);
      const failed = await b.queued(send!.queuedId);
      expect(failed.state).toBe("failed");
      expect(failed.message).not.toBeNull();

      await b.mark(id, "spam");

      expect(await b.queued(send!.queuedId)).toMatchObject({
        state: "cancelled",
        message: null,
      });
    }, 60_000);

    it.each([
      ["send", "sent", [TEAM]],
      ["retryable", "cancelled", []],
    ] as const)(
      "lets one already with the provider finish when marked Spam: a %s answer ends %s",
      async (answer, state, delivered) => {
        const b = await boot(dialect);
        const arrived = latch();
        const held = latch();
        behaviour.gate = held.promise;
        behaviour.reached = arrived.open;
        behaviour.mode = answer;
        const submitting = b.submit("hello");
        await arrived.promise;
        const { items } = await b.t.nextly.find({
          collection: "form-submissions",
        });
        const id = String((items[0] as { id: unknown }).id);
        const [send] = await b.sendsOf(id);
        expect((await b.queued(send!.queuedId)).state).toBe("sending");

        await b.mark(id, "spam");
        behaviour.gate = undefined;
        held.open();
        await submitting;
        behaviour.mode = "send";
        await b.trigger();

        expect((await b.queued(send!.queuedId)).state).toBe(state);
        expect(sent).toEqual(delivered);
      },
      60_000
    );
  }
);
