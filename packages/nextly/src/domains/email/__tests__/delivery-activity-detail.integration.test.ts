/**
 * What the Activity detail sheet reads, on every configured dialect:
 *
 * - each delivery records the version of the template it was sent from (its
 *   owner, whether the site had overridden it, and a digest of the version as
 *   saved), that it had none, or, for a row from before, that it was not
 *   recorded;
 * - each failure records the provider's structured answer (its kind and
 *   status) and never the provider's own text, which can quote an address,
 *   the message or a credential;
 * - a queued email's attempts are linked to it, read as a timeline, and a
 *   failure its template caused says so, for "Fix template".
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { loadedDialect } from "../../../database/dialect-tables";
import { container } from "../../../di/container";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { withEmailFailure } from "../failure";
import { defineEmailProvider } from "../provider-definition";
import type { EmailDeliveryService } from "../services/email-delivery-service";
import type { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { versionDigest } from "../template-ownership";
import type { EmailProviderAdapter } from "../types";

const SECRET = "sk_live_DO_NOT_STORE_0123456789";
const SUBJECT = "A subject naming Alice";
const BODY = "<p>A body for Alice</p>";

/** What the scripted provider answers next; it sends when none is queued. */
const answers: Array<"refuse" | "fail-once"> = [];

const scripted = defineEmailProvider<Record<string, never>>({
  type: "scripted-activity",
  label: "Scripted",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: (): EmailProviderAdapter => ({
    send: async options => {
      const next = answers.shift();
      const to = [options.to].flat().join(", ");
      if (next === "refuse") {
        throw withEmailFailure(
          new Error(
            `550 5.1.1 <${to}> rejected "${options.subject}" ${String(options.html)} key=${SECRET}`
          ),
          { retryable: false, status: 550, reason: `refused ${to}` }
        );
      }
      if (next === "fail-once") {
        throw withEmailFailure(
          new Error(`421 try later for ${to} key=${SECRET}`),
          { retryable: true, status: 421, reason: "later" }
        );
      }
      return { success: true, messageId: `msg-${Math.random()}` };
    },
  }),
});

let current: TestNextly | undefined;

afterEach(async () => {
  answers.length = 0;
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = (current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "mailer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [scripted] },
      } as never),
    ],
  }));
  await t.nextly.emailProviders.create({
    data: {
      name: "Scripted",
      type: "scripted-activity",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  return t;
}

/** Every stored column of every delivery row, as text, for leak checks. */
async function storedText(t: TestNextly, dialect: TestDialect) {
  const table = loadedDialect(dialect).tables.emailDeliveries;
  const db = t.adapter.getDrizzle() as never as {
    select(): { from(table: unknown): Promise<unknown[]> };
  };
  return JSON.stringify(await db.select().from(table));
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`the Activity detail — ${dialect}`, () => {
    it("records the template version each delivery was sent from, none, or not recorded", async () => {
      const t = await boot(dialect);
      const made = await t.nextly.emailTemplates.create({
        data: {
          name: "Newsletter",
          slug: "newsletter",
          subject: "News for {{name}}",
          htmlContent: "<p>Hello {{name}}</p>",
        },
      });
      await t.nextly.email.sendWithTemplate({
        template: "newsletter",
        to: "a@example.com",
        variables: { name: "Alice" },
      });
      await t.nextly.emailTemplates.update({
        id: made.item.id,
        data: { subject: "Fresh news for {{name}}" },
      });
      await t.nextly.email.sendWithTemplate({
        template: "newsletter",
        to: "a@example.com",
        variables: { name: "Alice" },
      });
      await t.nextly.email.send({
        to: "a@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      // A row written before versions were recorded.
      const deliveries = t.getService(
        "emailDeliveryService"
      ) as unknown as EmailDeliveryService;
      await deliveries.record({
        to: "b@example.com",
        providerType: "smtp",
        templateSlug: "newsletter",
        status: "sent",
      });

      const page = await t.nextly.emailDeliveries.find({ limit: 10 });
      const versions = page.items.map(item => item.templateVersion);
      const first = versionDigest({
        subject: "News for {{name}}",
        htmlContent: "<p>Hello {{name}}</p>",
        plainTextContent: null,
        preheader: null,
      });
      const second = versionDigest({
        subject: "Fresh news for {{name}}",
        htmlContent: "<p>Hello {{name}}</p>",
        plainTextContent: null,
        preheader: null,
      });
      expect(versions).toEqual([
        "not-recorded",
        "none",
        { owner: "site", overridden: false, digest: second },
        { owner: "site", overridden: false, digest: first },
      ]);
      // Nothing of the rendered message is kept with it.
      const stored = await storedText(t, dialect);
      expect(stored).not.toContain("Alice");
      expect(stored).not.toContain("a@example.com");
    });

    it("records an owned template as its owner's, and as overridden once the site edits it", async () => {
      const t = await boot(dialect);
      // Core's own templates, as the first boot on a site stores them.
      await (
        t.getService("emailTemplateService") as unknown as EmailTemplateService
      ).ensureBuiltInTemplates();
      const reset = await t.nextly.emailTemplates.findBySlug({
        slug: "password-reset",
      });
      expect(reset).not.toBeNull();
      const send = () =>
        t.nextly.email.sendWithTemplate({
          template: "password-reset",
          to: "a@example.com",
          variables: { resetLink: "https://example.com/r", userName: "A" },
        });
      await send();
      await t.nextly.emailTemplates.override({ id: String(reset!.id) });
      await t.nextly.emailTemplates.update({
        id: String(reset!.id),
        data: { subject: "Our own reset wording" },
      });
      await send();

      const [overridden, owned] = (
        await t.nextly.emailDeliveries.find({ template: "password-reset" })
      ).items.map(item => item.templateVersion);
      expect(owned).toMatchObject({ owner: "core", overridden: false });
      expect(overridden).toMatchObject({ owner: "core", overridden: true });
      expect(
        (overridden as { digest: string }).digest !==
          (owned as { digest: string }).digest
      ).toBe(true);
    });

    it("stores a refusal's kind and status, never the provider's own text", async () => {
      const t = await boot(dialect);
      answers.push("refuse");
      const result = await t.nextly.email.send({
        to: "carol@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      expect(result.success).toBe(false);

      const [item] = (await t.nextly.emailDeliveries.find({})).items;
      expect(item).toMatchObject({
        outcome: "failed",
        failureKind: "refused",
        failureStatus: 550,
      });
      const detail = await t.nextly.emailDeliveries.findByID({ id: item.id });
      expect(detail?.timeline).toEqual([
        expect.objectContaining({
          outcome: "failed",
          failureKind: "refused",
          failureStatus: 550,
        }),
      ]);
      // The stored row holds none of what the provider said.
      const stored = await storedText(t, dialect);
      for (const leaked of [SECRET, "carol@example.com", SUBJECT, BODY]) {
        expect(stored).not.toContain(leaked);
      }
      expect(JSON.stringify(detail)).not.toContain(SECRET);
    });

    it("links a queued email's attempts to it, as a timeline", async () => {
      const t = await boot(dialect);
      answers.push("fail-once");
      const queued = await t.nextly.email.queue({
        to: "dana@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      // The first attempt failed; the retry is the job queue's.
      const later = new Date(Date.now() + 4 * 60 * 60_000);
      await runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
        now: () => later,
      });

      const detail = await t.nextly.emailDeliveries.findQueuedByID({
        id: queued.id,
      });
      expect(detail).toMatchObject({
        id: queued.id,
        state: "sent",
        templateCaused: false,
        templateVersion: "none",
      });
      expect(
        detail?.timeline.map(a => [a.outcome, a.failureKind ?? null])
      ).toEqual([
        ["failed", "retryable"],
        ["sent", null],
      ]);
      // Each delivery names the queued email it was an attempt of.
      const { items } = await t.nextly.emailDeliveries.find({});
      expect(items.map(item => item.queuedId)).toEqual([queued.id, queued.id]);
      const sent = await t.nextly.emailDeliveries.findByID({
        id: items[0].id,
      });
      expect(sent?.timeline.map(a => a.outcome)).toEqual(["failed", "sent"]);
      // Its id in capitals names the same delivery, and the same email.
      expect(
        (
          await t.nextly.emailDeliveries.findByID({
            id: items[0].id.toUpperCase(),
          })
        )?.id
      ).toBe(items[0].id);
      expect(
        (
          await t.nextly.emailDeliveries.findQueuedByID({
            id: queued.id.toUpperCase(),
          })
        )?.id
      ).toBe(queued.id);
      expect(JSON.stringify(detail)).not.toContain("dana@example.com");
    });

    it("says a queued email's failure came from its template", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: {
          name: "Contact",
          slug: "contact",
          subject: "Thanks",
          htmlContent: "<p>Thanks</p>",
          replyTo: "{{ replyTo }}",
        },
      });
      const queued = await t.nextly.email.queueWithTemplate({
        template: "contact",
        to: "erin@example.com",
        variables: { replyTo: "not an address" },
      });
      const failed = await t.nextly.emailDeliveries.findQueuedByID({
        id: queued.id,
      });
      expect(failed).toMatchObject({
        state: "failed",
        templateCaused: true,
        messageHeld: true,
        timeline: [],
      });

      // A provider's refusal is not the template's.
      answers.push("refuse");
      const refused = await t.nextly.email.queue({
        to: "erin@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      expect(
        await t.nextly.emailDeliveries.findQueuedByID({ id: refused.id })
      ).toMatchObject({ state: "failed", templateCaused: false });
    });

    it("answers null for an id it does not know, whatever its shape", async () => {
      const t = await boot(dialect);
      for (const id of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
        expect(await t.nextly.emailDeliveries.findByID({ id })).toBeNull();
        expect(
          await t.nextly.emailDeliveries.findQueuedByID({ id })
        ).toBeNull();
      }
    });

    it("reads an erased recipient's delivery in its queued email's whole timeline", async () => {
      const t = await boot(dialect);
      const queued = await t.nextly.email.queue({
        to: ["first@example.com", "second@example.com"],
        subject: SUBJECT,
        html: BODY,
      });
      const deliveries = t.getService(
        "emailDeliveryService"
      ) as unknown as EmailDeliveryService;
      await deliveries.eraseRecipient("first@example.com");
      await deliveries.eraseRecipient("second@example.com");

      const { items } = await t.nextly.emailDeliveries.find({});
      const ours = items.filter(item => item.queuedId === queued.id);
      expect(ours).toHaveLength(2);
      for (const item of ours) {
        expect(item.erased).toBe(true);
        const detail = await t.nextly.emailDeliveries.findByID({ id: item.id });
        // Every record of the email, each marked erased, this one among them:
        // nothing left on them says which were the same person.
        expect(detail?.timeline.map(attempt => attempt.id).sort()).toEqual(
          ours.map(other => other.id).sort()
        );
        expect(detail?.timeline.every(attempt => attempt.erased)).toBe(true);
        expect(detail?.timelineTruncated).toBe(false);
      }
    });

    it("reads a queued email's whole timeline, past one page of records", async () => {
      const t = await boot(dialect);
      const queued = await t.nextly.email.queue({
        to: "dana@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      // As many records as a page and more, each naming this email.
      const deliveries = t.getService(
        "emailDeliveryService"
      ) as unknown as EmailDeliveryService;
      await deliveries.recordAll(
        Array.from({ length: 600 }, (_, n) => ({
          to: `r${n}@example.com`,
          providerType: "scripted-activity",
          status: "sent" as const,
          queuedId: queued.id,
        }))
      );

      const detail = await t.nextly.emailDeliveries.findQueuedByID({
        id: queued.id,
      });
      expect(detail?.timeline).toHaveLength(601);
      expect(detail?.timelineTruncated).toBe(false);
      expect(new Set(detail?.timeline.map(attempt => attempt.id)).size).toBe(
        601
      );
    }, 120_000);

    it("records a test of the editor's unsaved fields as a draft, not a saved version", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: {
          name: "Newsletter",
          slug: "newsletter",
          subject: "News",
          htmlContent: "<p>News</p>",
        },
      });
      const emails = t.getService("emailService") as unknown as EmailService;
      await emails.sendTemplateTest(
        "newsletter",
        "a@example.com",
        {},
        {
          subject: "Unsaved news",
        }
      );

      const [item] = (await t.nextly.emailDeliveries.find({})).items;
      expect(item.templateVersion).toEqual({
        owner: "site",
        overridden: false,
        digest: null,
        draft: true,
      });
    });
  });
}
