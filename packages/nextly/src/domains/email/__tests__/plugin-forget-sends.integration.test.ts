/**
 * A plugin forgetting the email it sent about something it deleted, on every
 * configured dialect: its queued emails among the ids are cancelled and
 * cleared, the delivery records of its keyed sends are erased, another
 * caller's ids and keys are left alone, and the work commits with the
 * plugin's own transaction (a `ctx.db.transaction` or an in-transaction
 * handler's) or not at all.
 *
 * @module domains/email/__tests__/plugin-forget-sends.integration.test
 */

// Read through the env proxy by the seal and the digests: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
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
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const NOTES = "forget_notes";
const message = { subject: "Your answers", html: "<p>Thanks, Ada</p>" };

/** Calls the capturing provider was handed, and how many more fail. */
const calls: SentOptions[] = [];
const behaviour = { failures: 0 };

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;
/** The queued email a note's deletion forgets, by the note's id. */
const queuedFor = new Map<string, string>();

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  calls.length = 0;
  behaviour.failures = 0;
  queuedFor.clear();
});

const forms = definePlugin({
  name: "forget-forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
    ],
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "capturing-forget",
        label: "Capturing",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (options: SentOptions) => {
            calls.push(options);
            if (behaviour.failures > 0) {
              behaviour.failures -= 1;
              throw new Error("provider down");
            }
            return { success: true, messageId: `captured-${calls.length}` };
          },
        }),
      }),
    ],
  },
  init(context: PluginContext) {
    ctx = context;
    // A note's deletion forgets the email queued about it, in its own
    // transaction.
    context.hooks.onInTransaction(NOTES, async write => {
      if (write.operation !== "delete") return;
      const queuedId = queuedFor.get(String(write.id));
      if (queuedId === undefined) return;
      await context.services.email.forgetSends(
        { queuedIds: [queuedId] },
        { tx: write.db }
      );
    });
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [forms] });
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-forget",
      fromEmail: "from@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  return current;
}

function plugin(): PluginContext {
  if (!ctx) throw new Error("not booted");
  return ctx;
}

interface QueueRow {
  id: string;
  state: string;
  message: string | null;
}

async function queued(t: TestNextly, id: string): Promise<QueueRow> {
  const [row] = await t.adapter.select<QueueRow>("email_queue", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  if (!row) throw new Error(`no queued email ${id}`);
  return row;
}

async function recipientsOf(t: TestNextly, id: string): Promise<string[]> {
  const rows = await t.adapter.select<{ recipientHash: string }>(
    "email_queue_recipients",
    { where: { and: [{ column: "queuedId", op: "=", value: id }] } }
  );
  return rows.map(row => row.recipientHash);
}

/** The delivery records to `address`, as stored. */
async function deliveriesTo(t: TestNextly, address: string) {
  return t.adapter.select<{ recipientHash: string; keyDigest: string | null }>(
    "email_deliveries",
    {
      where: {
        and: [
          { column: "recipientHash", op: "=", value: recipientDigest(address) },
        ],
      },
    }
  );
}

async function erasedCount(t: TestNextly): Promise<number> {
  return (
    await t.adapter.select<{ id: string }>("email_deliveries", {
      where: {
        and: [
          { column: "recipientHash", op: "=", value: ERASED_RECIPIENT_HASH },
        ],
      },
    })
  ).length;
}

/** One jobs trigger, past any backoff the queue scheduled. */
function trigger(t: TestNextly) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    now: () => new Date(Date.now() + 2 * 60 * 60_000),
  });
}

/** A queued email that failed its first attempt and waits to retry. */
async function waiting(to: string): Promise<string> {
  behaviour.failures = Number.MAX_SAFE_INTEGER;
  const result = await plugin().services.email.queue({ ...message, to });
  expect(result.state).toBe("waiting");
  return result.id;
}

describe.each(getConfiguredTestDialects())(
  "a plugin forgetting its sends (%s)",
  dialect => {
    it("cancels and clears its own queued emails, and no one else's", async () => {
      const t = await boot(dialect);
      const own = await waiting("ada@example.com");
      const site = await t.nextly.email.queue({
        ...message,
        to: "grace@example.com",
      });
      const before = await queued(t, site.id);

      await plugin().services.email.forgetSends({
        queuedIds: [own, site.id],
      });
      // The site's, among the ids, is not the plugin's to forget.
      expect(await queued(t, site.id)).toEqual(before);

      const toAda = () =>
        calls.filter(call => JSON.stringify(call.to).includes("ada@")).length;
      const attempts = toAda();
      await trigger(t);

      expect(await queued(t, own)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(await recipientsOf(t, own)).toEqual([]);
      // No attempt follows for the forgotten one.
      expect(toAda()).toBe(attempts);
    });

    it("leaves a plugin's whose name differs only by an accent", async () => {
      const t = await boot(dialect);
      const theirs = await waiting("ada@example.com");
      // As another plugin's queued email, one MySQL's default collation
      // reads as equal to this plugin's scope.
      await t.adapter.update(
        "email_queue",
        { scope: "plugin:forget-förms" },
        { and: [{ column: "id", op: "=", value: theirs }] }
      );
      const before = await queued(t, theirs);

      await plugin().services.email.forgetSends({ queuedIds: [theirs] });

      expect(await queued(t, theirs)).toEqual(before);
    });

    it("erases the records of its keyed sends, and no one else's with the key", async () => {
      const t = await boot(dialect);
      await plugin().services.email.send({
        ...message,
        to: "ada@example.com",
        idempotencyKey: "submission-1",
      });
      // The same key from another caller is another send.
      await t.nextly.email.send({
        ...message,
        to: "grace@example.com",
        idempotencyKey: "submission-1",
      });
      await plugin().services.email.send({
        ...message,
        to: "linus@example.com",
        idempotencyKey: "submission-2",
      });
      const [forgotten] = await deliveriesTo(t, "ada@example.com");
      const digest = forgotten?.keyDigest;
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      const carrying = async (table: string) =>
        (
          await t.adapter.select<{ id: string }>(table, {
            where: { and: [{ column: "keyDigest", op: "=", value: digest }] },
          })
        ).length;
      expect(await carrying("email_send_claims")).toBe(1);

      await plugin().services.email.forgetSends({
        idempotencyKeys: ["submission-1"],
      });

      expect(await deliveriesTo(t, "ada@example.com")).toEqual([]);
      // The send's key digest is gone from its records and from its claim,
      // so nothing ties the erased record to the key any more.
      expect(await carrying("email_deliveries")).toBe(0);
      expect(await carrying("email_send_claims")).toBe(0);
      expect(await erasedCount(t)).toBe(1);
      expect(await deliveriesTo(t, "grace@example.com")).toHaveLength(1);
      const [kept] = await deliveriesTo(t, "linus@example.com");
      expect(kept?.keyDigest).toMatch(/^[0-9a-f]{64}$/);
    });

    it("commits with the plugin's transaction, and not when it rolls back", async () => {
      const t = await boot(dialect);
      const kept = await waiting("ada@example.com");
      const forgotten = await waiting("grace@example.com");

      await expect(
        plugin().db.transaction(async tx => {
          await plugin().services.email.forgetSends(
            { queuedIds: [kept] },
            { tx }
          );
          throw new Error("the deletion failed");
        })
      ).rejects.toThrow("the deletion failed");
      await plugin().db.transaction(async tx => {
        await plugin().services.email.forgetSends(
          { queuedIds: [forgotten] },
          { tx }
        );
      });

      expect((await queued(t, kept)).state).toBe("waiting");
      expect((await queued(t, forgotten)).state).toBe("cancelled");
    });

    it("is refused inside an open transaction it is not handed", async () => {
      const t = await boot(dialect);
      const id = await waiting("ada@example.com");
      await expect(
        plugin().db.transaction(async () => {
          await plugin().services.email.forgetSends({ queuedIds: [id] });
        })
      ).rejects.toThrow();
      expect((await queued(t, id)).state).toBe("waiting");
    });

    it("forgets inside an in-transaction handler, with the deletion", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: NOTES,
        data: { title: "Ada's answers" },
      });
      const noteId = String(created.item.id);
      const id = await waiting("ada@example.com");
      queuedFor.set(noteId, id);

      await t.nextly.delete({ collection: NOTES, id: noteId });

      expect(await queued(t, id)).toMatchObject({
        state: "cancelled",
        message: null,
      });
    });
  }
);
