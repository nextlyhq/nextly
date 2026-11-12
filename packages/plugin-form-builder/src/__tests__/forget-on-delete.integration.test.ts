/**
 * Every path that deletes a submission forgets the notifications it sent, in
 * the deletion's transaction, on every dialect: a notification waiting to
 * retry is cancelled and cleared and never goes out; one that failed for good
 * is cleared; the delivery records of one that went out are erased; and the
 * record of what was sent goes with the submission. Through one deletion, a
 * bulk deletion, and deleting the form, which deletes its submissions.
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
import { afterEach, describe, expect, it } from "vitest";

import { SUBMISSION_SENDS_SLUG } from "../collections/sends";
import { DELETE_PAGE } from "../handlers/forget-sends";
import { FORM_SUBMISSION_TEMPLATE } from "../emails/starter-messages";
import { formBuilder } from "../plugin";

const sent: Array<{ to: string | string[] }> = [];
/** What the provider does with the next sends. */
const behaviour = { mode: "send" as "send" | "retryable" | "refused" };

/** A provider that sends, fails in a way a retry can help, or refuses. */
const mailer = definePlugin({
  name: "@test/forget-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "forget-mailer",
        label: "Forget mailer",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (opts: { to: string | string[] }) => {
            if (behaviour.mode === "retryable") {
              throw new Error("provider down");
            }
            if (behaviour.mode === "refused") {
              // Classified by the provider: no retry can help.
              throw Object.assign(new Error("refused"), {
                emailFailure: { retryable: false, reason: "Refused." },
              });
            }
            sent.push({ to: opts.to });
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

interface QueueRow {
  id: string;
  state: string;
  message: string | null;
}

async function boot(dialect: TestDialect, sendsSlug = SUBMISSION_SENDS_SLUG) {
  const fb = formBuilder();
  // A host may rename the collection the sends are kept in.
  const plugin =
    sendsSlug === SUBMISSION_SENDS_SLUG
      ? fb.plugin
      : fb.plugin.rename!({ [SUBMISSION_SENDS_SLUG]: sendsSlug });
  current = await createTestNextly({ dialect, plugins: [plugin, mailer] });
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
      name: "Forget",
      type: "forget-mailer",
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
  });
  const formId = String(form.item.id);

  const submit = async (message: string) =>
    String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form: formId,
            data: { message },
            status: "new",
            submittedAt: new Date(),
          },
        })
      ).item.id
    );

  /** What the submission recorded as sent. */
  const sendsOf = async (id: string) =>
    (
      await t.nextly.find({
        collection: sendsSlug,
        where: { submission: { equals: id } },
        limit: 1000,
      })
    ).items as Array<{ queuedId: string; sendKey: string }>;

  const queued = async (id: string): Promise<QueueRow> => {
    const [row] = await t.adapter.select<QueueRow>("email_queue", {
      where: { and: [{ column: "id", op: "=", value: id }] },
    });
    if (!row) throw new Error(`no queued email ${id}`);
    return row;
  };

  /** One jobs trigger, past any backoff the queue scheduled. */
  const trigger = () =>
    runJobsPass(t.adapter as never, t.getService("jobRegistry" as never), {
      now: () => new Date(Date.now() + 2 * 60 * 60_000),
    });

  return { t, formId, submit, sendsOf, queued, trigger, sendsSlug };
}

describe.each(getConfiguredTestDialects())(
  "deleting a submission forgets its notifications (%s)",
  dialect => {
    it("cancels and clears one waiting to retry, which then never goes out", async () => {
      const { t, submit, sendsOf, queued, trigger } = await boot(dialect);
      behaviour.mode = "retryable";
      const id = await submit("hello");
      const [send] = await sendsOf(id);
      expect((await queued(send!.queuedId)).state).toBe("waiting");

      await t.nextly.delete({ collection: "form-submissions", id });
      behaviour.mode = "send";
      await trigger();

      expect(await queued(send!.queuedId)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(sent).toEqual([]);
      expect(await sendsOf(id)).toEqual([]);
    }, 60_000);

    it("clears one that failed for good", async () => {
      const { t, submit, sendsOf, queued } = await boot(dialect);
      behaviour.mode = "refused";
      const id = await submit("hello");
      const [send] = await sendsOf(id);
      expect((await queued(send!.queuedId)).state).toBe("failed");

      await t.nextly.delete({ collection: "form-submissions", id });

      // Its message goes; core files it with the cancelled ones.
      expect(await queued(send!.queuedId)).toMatchObject({
        state: "cancelled",
        message: null,
      });
    }, 60_000);

    it("erases the delivery records of one that went out", async () => {
      const { t, submit, sendsOf } = await boot(dialect);
      const id = await submit("hello");
      expect(sent).toHaveLength(1);
      expect(await sendsOf(id)).toHaveLength(1);
      const keyed = async () =>
        (
          await t.adapter.select<{ keyDigest: string | null }>(
            "email_deliveries",
            {}
          )
        ).filter(row => row.keyDigest !== null).length;
      expect(await keyed()).toBeGreaterThan(0);

      await t.nextly.delete({ collection: "form-submissions", id });

      expect(await keyed()).toBe(0);
    }, 60_000);

    it("forgets them in a collection the host renamed", async () => {
      const { t, submit, sendsOf, queued } = await boot(
        dialect,
        "notification-records"
      );
      behaviour.mode = "retryable";
      const id = await submit("hello");
      const [send] = await sendsOf(id);
      expect(send).toBeDefined();

      await t.nextly.delete({ collection: "form-submissions", id });

      expect((await queued(send!.queuedId)).state).toBe("cancelled");
      expect(await sendsOf(id)).toEqual([]);
    }, 60_000);

    it("forgets every record of a submission with more than one batch of them", async () => {
      const { t, submit, sendsOf, sendsSlug } = await boot(dialect);
      const id = await submit("hello");
      // Records past the first batch, for sends that name nothing queued.
      for (let n = 0; n < DELETE_PAGE; n++) {
        await t.nextly.create({
          collection: sendsSlug,
          data: { submission: id, queuedId: `none-${n}`, sendKey: `key-${n}` },
        });
      }
      expect(await sendsOf(id)).toHaveLength(DELETE_PAGE + 1);

      await t.nextly.delete({ collection: "form-submissions", id });

      expect(await sendsOf(id)).toEqual([]);
    }, 120_000);

    it("forgets each one a bulk deletion takes, and no other", async () => {
      const { t, submit, sendsOf, queued } = await boot(dialect);
      behaviour.mode = "retryable";
      const [a, b, kept] = [
        await submit("a"),
        await submit("b"),
        await submit("kept"),
      ];
      const queuedOf = async (id: string) => (await sendsOf(id))[0]!.queuedId;
      const [qa, qb, qKept] = [
        await queuedOf(a),
        await queuedOf(b),
        await queuedOf(kept),
      ];

      await t.nextly.bulkDelete({
        collection: "form-submissions",
        ids: [a, b],
      });

      expect((await queued(qa)).state).toBe("cancelled");
      expect((await queued(qb)).state).toBe("cancelled");
      expect((await queued(qKept)).state).toBe("waiting");
    }, 60_000);

    it("deletes a form's submissions with it, forgetting what they sent", async () => {
      const { t, formId, submit, sendsOf, queued, trigger } =
        await boot(dialect);
      behaviour.mode = "retryable";
      const ids = [await submit("a"), await submit("b")];
      const queuedIds = await Promise.all(
        ids.map(async id => (await sendsOf(id))[0]!.queuedId)
      );

      await t.nextly.delete({ collection: "forms", id: formId });
      behaviour.mode = "send";
      await trigger();

      const { items } = await t.nextly.find({
        collection: "form-submissions",
        where: { form: { equals: formId } },
      });
      expect(items).toEqual([]);
      for (const queuedId of queuedIds) {
        expect((await queued(queuedId)).state).toBe("cancelled");
      }
      expect(sent).toEqual([]);
      for (const id of ids) expect(await sendsOf(id)).toEqual([]);
    }, 60_000);
  }
);
