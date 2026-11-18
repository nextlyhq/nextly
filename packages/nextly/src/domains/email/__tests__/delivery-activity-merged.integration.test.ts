/**
 * The merged Activity, on every configured dialect: queued emails and the
 * deliveries of sends that were not queued, newest first under one cursor
 * and one set of filters, with each provider's origin, each queued email's
 * template and recipient kinds, and nothing personal.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { env } from "../../../lib/env";
import { loadedDialect } from "../../../database/dialect-tables";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { rowLockServer } from "../../audit/audit-log-writer";
import { pluginSettingsSecrets } from "../../plugins/settings-service";
import type { ActivityEntry } from "../delivery-activity";
import { defineEmailProvider } from "../provider-definition";
import { storeQueuedEmail } from "../queued-send";
import type { EmailDeliveryService } from "../services/email-delivery-service";
import type { EmailProviderAdapter } from "../types";

const SUBJECT = "A subject naming Alice";
const BODY = "<p>A body for Alice</p>";

/** Every field a merged row has, and no other. */
const ENTRY_FIELDS = [
  "attempts",
  "createdAt",
  "erased",
  "failureReason",
  "id",
  "kind",
  "nextAttemptAt",
  "provider",
  "recipientKinds",
  "status",
  "template",
].sort();

const capturing = defineEmailProvider<Record<string, never>>({
  type: "capturing-merged",
  label: "Capturing",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: (): EmailProviderAdapter => ({
    send: async () => ({ success: true, messageId: `m-${Math.random()}` }),
  }),
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  return (current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "mailer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [capturing] },
      } as never),
    ],
  }));
}

/** A stored provider of the capturing type. */
async function provider(t: TestNextly, isDefault: boolean): Promise<string> {
  const made = await t.nextly.emailProviders.create({
    data: {
      name: isDefault ? "Default" : "Other",
      type: "capturing-merged",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault,
    },
  });
  return made.item.id;
}

const ids = (entries: ActivityEntry[]) => entries.map(entry => entry.id);

for (const dialect of getConfiguredTestDialects()) {
  describe(`the merged Activity — ${dialect}`, () => {
    it("lists queued emails and unqueued sends newest first, a queued email's deliveries inside it, and nothing personal", async () => {
      const t = await boot(dialect);
      await provider(t, true);
      await t.nextly.email.send({
        to: "alice@example.com",
        subject: SUBJECT,
        html: BODY,
      });
      const queued = await t.nextly.email.queue({
        to: "bob@example.com",
        cc: ["carol@example.com"],
        subject: SUBJECT,
        html: BODY,
      });

      const page = await t.nextly.emailDeliveries.activity({});
      for (const entry of page.items) {
        expect(Object.keys(entry).sort()).toEqual(ENTRY_FIELDS);
      }
      // The queued email is one row; its two deliveries are its timeline.
      expect(page.items.map(entry => entry.kind)).toEqual([
        "queued",
        "delivery",
      ]);
      expect(page.items[0]).toMatchObject({
        id: queued.id,
        status: "sent",
        template: "none",
        recipientKinds: ["to", "cc"],
        provider: { type: "capturing-merged", origin: "stored" },
        attempts: 1,
        erased: false,
      });
      expect(page.items[1]).toMatchObject({
        status: "sent",
        template: "none",
        recipientKinds: ["to"],
        provider: { type: "capturing-merged", origin: "stored" },
        attempts: null,
      });
      const text = JSON.stringify(page);
      for (const leaked of [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
        SUBJECT,
        BODY,
      ]) {
        expect(text).not.toContain(leaked);
      }
    });

    it("reads each provider's origin, and filters by it, on every dialect", async () => {
      const t = await boot(dialect);
      // Before any stored provider: the site's configured one carries it.
      await t.nextly.email.send({
        to: "a@example.com",
        subject: "S",
        html: "<p>x</p>",
      });
      await provider(t, true);
      const other = await provider(t, false);
      await t.nextly.email.send({
        to: "a@example.com",
        subject: "S",
        html: "<p>x</p>",
        providerId: other,
      });
      await t.nextly.email.send({
        to: "a@example.com",
        subject: "S",
        html: "<p>x</p>",
      });
      // The other provider is deleted: PostgreSQL and SQLite null the id,
      // MySQL keeps it dangling; it reads deleted either way.
      await t.nextly.emailProviders.delete({ id: other });
      // A record from before origins were written, with no provider id.
      const deliveries = t.getService(
        "emailDeliveryService"
      ) as unknown as EmailDeliveryService;
      await deliveries.record({
        to: "a@example.com",
        providerType: "smtp",
        status: "sent",
      });

      const all = (await t.nextly.emailDeliveries.activity({})).items;
      expect(all.map(entry => entry.provider?.origin)).toEqual([
        "not-recorded",
        "stored",
        "deleted",
        "code",
      ]);
      const deleted = all[2];
      expect(deleted.provider).toEqual({
        id: null,
        type: "capturing-merged",
        origin: "deleted",
      });
      expect(all[1].provider?.id).toEqual(expect.any(String));

      for (const origin of ["stored", "code", "deleted"] as const) {
        const { items } = await t.nextly.emailDeliveries.activity({
          providerOrigin: origin,
        });
        expect(items.map(entry => entry.provider?.origin)).toEqual([origin]);
      }
      // A row not recorded matches no origin, only the unfiltered list.
      expect(
        (
          await t.nextly.emailDeliveries.activity({
            providerType: "smtp",
            providerOrigin: "code",
          })
        ).items
      ).toEqual([]);
    });

    it("tells a queued email's template and recipients, and an older one's as not recorded", async () => {
      const t = await boot(dialect);
      await provider(t, true);
      const templated = await t.nextly.email.queueWithTemplate({
        template: "no-such-template",
        to: "a@example.com",
      });
      const plain = await t.nextly.email.queue({
        to: "a@example.com",
        bcc: ["b@example.com"],
        subject: "S",
        html: "<p>x</p>",
      });
      // One queued before its shape was recorded.
      const older = await t.nextly.email.queue({
        to: "a@example.com",
        subject: "S",
        html: "<p>x</p>",
      });
      const queue = loadedDialect(dialect).tables.emailQueue;
      const db = t.adapter.getDrizzle() as never as {
        update(table: unknown): {
          set(values: unknown): { where(c: unknown): Promise<unknown> };
        };
      };
      await db
        .update(queue)
        .set({ messageKind: null, recipientKinds: null, templateSlug: null })
        .where(eq(queue.id as never, older.id));

      const byId = new Map(
        (await t.nextly.emailDeliveries.activity({})).items.map(entry => [
          entry.id,
          entry,
        ])
      );
      expect(byId.get(templated.id)).toMatchObject({
        template: { slug: "no-such-template" },
        recipientKinds: ["to"],
        status: "failed",
      });
      expect(byId.get(plain.id)).toMatchObject({
        template: "none",
        recipientKinds: ["to", "bcc"],
      });
      expect(byId.get(older.id)).toMatchObject({
        template: "not-recorded",
        recipientKinds: null,
      });
    });

    it("shows a queued email not yet tried with no provider", async () => {
      const t = await boot(dialect);
      await provider(t, true);
      const dialectName = t.adapter.getCapabilities().dialect;
      const stored = await t.adapter.transaction(ctx =>
        storeQueuedEmail(ctx, {
          scope: "site",
          message: {
            kind: "message",
            send: { to: "a@example.com", subject: "S", html: "<p>x</p>" },
          },
          person: null,
          secrets: pluginSettingsSecrets(env),
          lockServer: rowLockServer(t.adapter, dialectName),
          dialect: dialectName,
          now: new Date(),
        })
      );
      const [entry] = (await t.nextly.emailDeliveries.activity({})).items;
      expect(entry).toMatchObject({
        id: stored.id,
        kind: "queued",
        status: "waiting",
        provider: null,
        attempts: 0,
      });
      // No origin is filtered in: it has no provider yet.
      expect(
        (await t.nextly.emailDeliveries.activity({ providerOrigin: "stored" }))
          .items
      ).toEqual([]);
    });

    it("pages both kinds under one cursor, and filters them as one", async () => {
      const t = await boot(dialect);
      await provider(t, true);
      const made: string[] = [];
      for (let n = 0; n < 3; n++) {
        await t.nextly.email.send({
          to: "a@example.com",
          subject: "S",
          html: "<p>x</p>",
        });
        made.push(
          (
            await t.nextly.email.queue({
              to: "a@example.com",
              subject: "S",
              html: "<p>x</p>",
            })
          ).id
        );
      }
      const all = ids((await t.nextly.emailDeliveries.activity({})).items);
      expect(all).toHaveLength(6);

      const walked: string[] = [];
      let before: string | undefined;
      do {
        const page = await t.nextly.emailDeliveries.activity({
          limit: 2,
          before,
        });
        walked.push(...ids(page.items));
        before = page.meta.nextBefore;
      } while (before);
      expect(walked).toEqual(all);

      // A state only a queued email has matches no delivery.
      const waiting = await t.nextly.emailDeliveries.activity({
        status: "sent",
      });
      expect(waiting.items).toHaveLength(6);
      expect(
        (await t.nextly.emailDeliveries.activity({ status: "waiting" })).items
      ).toEqual([]);
      expect(
        (await t.nextly.emailDeliveries.activity({ providerType: "other" }))
          .items
      ).toEqual([]);
      expect(
        (
          await t.nextly.emailDeliveries.activity({
            from: "2099-01-01T00:00:00.000Z",
          })
        ).items
      ).toEqual([]);
      expect(made.every(id => all.includes(id))).toBe(true);
    });
  });
}
