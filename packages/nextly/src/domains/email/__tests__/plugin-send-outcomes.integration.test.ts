/**
 * What a plugin is told of its own queued emails, and how it sends one
 * again to the recipients who did not get it, on every configured dialect:
 *
 * - each change (an attempt starting, a retryable failure, sent, failed,
 *   cancelled with why) reaches the plugin inside the change's transaction,
 *   with every final recipient's line, outcome, masked hint and the plugin's
 *   own digest, and no address;
 * - a handler that throws undoes the change, and the next attempt makes it
 *   again without sending twice;
 * - a cancel tells it who or what cancelled: a person (after
 *   `manage-email-deliveries`), the plugin itself, or a request that reached
 *   an attempt in flight; an erasure tells it nothing and is read instead;
 * - `excludeRecipients` leaves recipients out by that digest after the
 *   `email.beforeSend` filters, across a rotation of the install's secret,
 *   and sends each remaining copy alone when no `to` is left;
 * - `readQueued` reads where its own emails stand, and nobody else's.
 *
 * The provider is a real one that captures, fails, refuses or holds as each
 * case says, so every send goes through the queue, its job and the service.
 *
 * @module domains/email/__tests__/plugin-send-outcomes.integration.test
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
  account,
  role,
  seedPermissions,
} from "../../../direct-api/__tests__/checked-access-fixtures";
import { Nextly } from "../../../direct-api/nextly";
import {
  FilterSeams,
  getFilterRegistry,
  type EmailPayloadFilterValue,
} from "../../../filters";
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
import { _resetEnvCache } from "../../../shared/lib/env";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import type { QueuedEmailChange } from "../queued-send-changes";
import { defineEmailProvider } from "../provider-definition";
import type { EmailDeliveryService } from "../services/email-delivery-service";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const OUTCOMES = "send_outcomes";
const ADA = "ada@example.com";
const GRACE = "grace@example.com";
const LINUS = "linus@example.com";
const AUDIT = "audit@example.com";
const message = { subject: "Your answers", html: "<p>Thanks</p>" };

/** Every call the provider was handed, in order. */
const calls: SentOptions[] = [];
/** Every change the plugin's handler finished, in order. */
const changes: QueuedEmailChange[] = [];

/** A promise and the function that settles it. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
}

/** What the provider and the plugin's handler do next. */
const behaviour: {
  failures: number;
  refusals: number;
  /** Mailboxes the provider refuses while taking the message. */
  refuse: Set<string>;
  gate?: Promise<void>;
  reached?: () => void;
  /** The handler throws once on this state, after writing its row. */
  throwOn?: QueuedEmailChange["state"];
} = { failures: 0, refusals: 0, refuse: new Set() };

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  calls.length = 0;
  changes.length = 0;
  behaviour.failures = 0;
  behaviour.refusals = 0;
  behaviour.refuse = new Set();
  behaviour.gate = undefined;
  behaviour.reached = undefined;
  behaviour.throwOn = undefined;
});

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const forms = definePlugin({
  name: "outcomes-forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: OUTCOMES,
        fields: [text({ name: "queuedId" }), text({ name: "state" })],
      }),
    ],
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "capturing-outcomes",
        label: "Capturing",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: async (options: SentOptions) => {
            calls.push(options);
            if (behaviour.gate) {
              behaviour.reached?.();
              await behaviour.gate;
            }
            if (behaviour.refusals > 0) {
              behaviour.refusals -= 1;
              // Classified by the provider: no retry can help.
              throw Object.assign(new Error("refused"), {
                emailFailure: { retryable: false, reason: "Refused." },
              });
            }
            if (behaviour.failures > 0) {
              behaviour.failures -= 1;
              throw new Error("provider down");
            }
            const everyone = [options.to, options.cc, options.bcc].flatMap(
              value => list(value as string | string[] | undefined)
            );
            const rejected = everyone.filter(address =>
              behaviour.refuse.has(address)
            );
            return {
              success: true,
              messageId: `captured-${calls.length}`,
              ...(rejected.length > 0 ? { rejected } : {}),
            };
          },
        }),
      }),
    ],
  },
  init(context: PluginContext) {
    ctx = context;
    context.services.email.onQueuedEmailChange(
      async (change, { transaction }) => {
        // Its own record of the change, in the change's transaction.
        await context.services.collections.createEntryInTransaction(
          transaction,
          OUTCOMES,
          { queuedId: change.queuedId, state: change.state }
        );
        if (behaviour.throwOn === change.state) {
          behaviour.throwOn = undefined;
          throw new Error("stopped before the record committed");
        }
        changes.push(change);
      }
    );
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [forms] });
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-outcomes",
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

/** The plugin's committed records of one email's changes, by state. */
async function recordedStates(t: TestNextly, id: string): Promise<string[]> {
  const { items } = await t.nextly.find({
    collection: OUTCOMES,
    where: { queuedId: { equals: id } },
    limit: 100,
  });
  return (items as Array<{ state: string }>).map(row => row.state).sort();
}

/** One jobs trigger, past any backoff the queue scheduled. */
function trigger(t: TestNextly) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    now: () => new Date(Date.now() + 2 * 60 * 60_000),
  });
}

const changesOf = (id: string) =>
  changes.filter(change => change.queuedId === id);

/** The states of an email's changes, in order. */
const statesOf = (id: string) => changesOf(id).map(change => change.state);

/** The last change of an email. */
const lastOf = (id: string): QueuedEmailChange => {
  const found = changesOf(id).at(-1);
  if (!found) throw new Error(`no change of ${id}`);
  return found;
};

const digestOf = (address: string) =>
  plugin().services.email.recipientDigest(address);

describe.each(getConfiguredTestDialects())(
  "a plugin told of its queued emails (%s)",
  dialect => {
    it("tells each change as it happens, by final recipient and with no address", async () => {
      const t = await boot(dialect);
      const arrived = latch();
      const held = latch();
      behaviour.gate = held.promise;
      behaviour.reached = arrived.open;
      const queuing = plugin().services.email.queue({
        ...message,
        to: ADA,
        idempotencyKey: "submission-1:team",
      });
      await arrived.promise;
      const sending = changes.at(-1);
      expect(sending).toMatchObject({
        state: "sending",
        attempt: 1,
        idempotencyKey: "submission-1:team",
      });
      expect(
        await plugin().services.email.readQueued([sending!.queuedId])
      ).toEqual([expect.objectContaining({ state: "sending", attempts: 1 })]);

      held.open();
      const { id } = await queuing;

      expect(statesOf(id)).toEqual(["sending", "sent"]);
      expect(lastOf(id)).toMatchObject({
        attempt: 1,
        recipients: [
          {
            kind: "to",
            outcome: "accepted",
            hint: "a•••@example.com",
            digest: await digestOf(ADA),
          },
        ],
      });
      expect(JSON.stringify(changes)).not.toContain("ada@");
      expect(await recordedStates(t, id)).toEqual(["sending", "sent"]);
      expect(await plugin().services.email.readQueued([id])).toEqual([
        expect.objectContaining({
          state: "sent",
          attempts: 1,
          messageHeld: false,
        }),
      ]);
    });

    it("tells a failure retried once, then the send after it", async () => {
      const t = await boot(dialect);
      behaviour.failures = 1;
      const { id, state } = await plugin().services.email.queue({
        ...message,
        to: ADA,
      });
      expect(state).toBe("waiting");
      expect(lastOf(id)).toMatchObject({
        state: "retrying",
        attempt: 1,
        failure: { retryable: true },
      });
      expect(lastOf(id).recipients?.[0]?.outcome).not.toBe("accepted");
      expect(await plugin().services.email.readQueued([id])).toEqual([
        expect.objectContaining({ state: "retrying", messageHeld: true }),
      ]);

      await trigger(t);

      expect(statesOf(id)).toEqual(["sending", "retrying", "sending", "sent"]);
      expect(lastOf(id)).toMatchObject({
        attempt: 2,
        recipients: [expect.objectContaining({ outcome: "accepted" })],
      });
    });

    it("tells a failure no retry can help as failed", async () => {
      await boot(dialect);
      behaviour.refusals = 1;
      const { id } = await plugin().services.email.queue({
        ...message,
        to: ADA,
      });
      expect(statesOf(id)).toEqual(["sending", "failed"]);
      expect(lastOf(id).failure).toMatchObject({ retryable: false });
    });

    it("tells a recipient accepted and another refused apart", async () => {
      await boot(dialect);
      behaviour.refuse = new Set([GRACE]);
      const { id } = await plugin().services.email.queue({
        ...message,
        to: ADA,
        cc: [GRACE],
      });
      expect(lastOf(id)).toMatchObject({
        state: "sent",
        recipients: [
          expect.objectContaining({ kind: "to", outcome: "accepted" }),
          expect.objectContaining({
            kind: "cc",
            outcome: "refused",
            digest: await digestOf(GRACE),
          }),
        ],
      });
    });

    it("tells a cancel by the plugin itself, and by a person allowed to", async () => {
      const t = await boot(dialect);
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const forgotten = await plugin().services.email.queue({
        ...message,
        to: ADA,
      });
      const byPerson = await plugin().services.email.queue({
        ...message,
        to: GRACE,
      });

      await plugin().services.email.forgetSends({ queuedIds: [forgotten.id] });
      expect(lastOf(forgotten.id)).toMatchObject({
        state: "cancelled",
        cancel: { by: "sender" },
        attempt: 1,
      });

      await seedPermissions(t);
      const manager = await account(t, "manager@example.com", [
        await role(t, "delivery-manager", ["manage-email-deliveries"]),
      ]);
      const lacker = await account(t, "lacker@example.com", [
        await role(t, "user-reader", ["read-users"]),
      ]);
      await expect(
        new Nextly({
          overrideAccess: false,
          user: { id: lacker },
        }).email.cancelQueued({ id: byPerson.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await queued(t, byPerson.id)).state).toBe("waiting");

      await new Nextly({
        overrideAccess: false,
        user: { id: manager },
      }).email.cancelQueued({ id: byPerson.id });

      expect(await queued(t, byPerson.id)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(lastOf(byPerson.id)).toMatchObject({
        state: "cancelled",
        cancel: { by: "person", userId: manager },
      });
    });

    it("tells a cancel reaching an attempt in flight as a request, which ends cancelled when it fails", async () => {
      const t = await boot(dialect);
      const arrived = latch();
      const held = latch();
      behaviour.gate = held.promise;
      behaviour.reached = arrived.open;
      const queuing = plugin().services.email.queue({ ...message, to: ADA });
      await arrived.promise;
      const id = changes.at(-1)!.queuedId;

      await plugin().services.email.forgetSends({ queuedIds: [id] });
      expect(lastOf(id)).toMatchObject({
        state: "sending",
        cancelRequested: { by: "sender" },
      });

      behaviour.failures = 1;
      behaviour.gate = undefined;
      held.open();
      await queuing;
      await trigger(t);

      expect(lastOf(id)).toMatchObject({
        state: "cancelled",
        cancel: { by: "request" },
      });
      expect(statesOf(id)).not.toContain("retrying");
      expect(calls).toHaveLength(1);
    });

    it("tells nothing of an erasure, which a read finds", async () => {
      const t = await boot(dialect);
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const { id } = await plugin().services.email.queue({
        ...message,
        to: ADA,
      });
      const told = changesOf(id).length;

      await t
        .getService<EmailDeliveryService>("emailDeliveryService")
        .eraseRecipient(ADA);

      expect(changesOf(id)).toHaveLength(told);
      expect(await plugin().services.email.readQueued([id])).toEqual([
        expect.objectContaining({ state: "cancelled", messageHeld: false }),
      ]);
    });

    it("undoes a change whose handler throws, and makes it again without sending twice", async () => {
      const t = await boot(dialect);
      behaviour.throwOn = "sent";
      const { id } = await plugin().services.email.queue({
        ...message,
        to: ADA,
      });

      // The provider took it; its record, and the change, were undone.
      expect(calls).toHaveLength(1);
      expect((await queued(t, id)).state).toBe("sending");
      expect(await recordedStates(t, id)).toEqual(["sending"]);
      expect(await plugin().services.email.readQueued([id])).toEqual([
        expect.objectContaining({ state: "sending" }),
      ]);

      await trigger(t);

      expect((await queued(t, id)).state).toBe("sent");
      expect(await recordedStates(t, id)).toEqual([
        "sending",
        "sending",
        "sent",
      ]);
      expect(lastOf(id).recipients).toEqual([
        expect.objectContaining({ outcome: "accepted" }),
      ]);
      expect(calls).toHaveLength(1);

      // Sent again leaving out who the record says got it: nothing goes.
      const again = await plugin().services.email.queue({
        ...message,
        to: ADA,
        excludeRecipients: [lastOf(id).recipients![0]!.digest],
      });
      expect(calls).toHaveLength(1);
      expect(lastOf(again.id)).toMatchObject({
        state: "sent",
        recipients: [expect.objectContaining({ outcome: "skipped" })],
      });
    });

    it("leaves out a recipient by a digest taken before the secret rotated", async () => {
      await boot(dialect);
      const reached = await digestOf(ADA);
      const original = process.env.NEXTLY_SECRET;
      const previous = process.env.NEXTLY_SECRET_PREVIOUS;
      try {
        process.env.NEXTLY_SECRET =
          "rotated-secret-at-least-32-characters-long!!";
        process.env.NEXTLY_SECRET_PREVIOUS = JSON.stringify([original]);
        _resetEnvCache();

        const { id } = await plugin().services.email.queue({
          ...message,
          to: [ADA, GRACE],
          excludeRecipients: [reached],
        });

        expect(calls.map(call => list(call.to))).toEqual([[GRACE]]);
        expect(lastOf(id).recipients).toEqual([
          expect.objectContaining({ kind: "to", outcome: "accepted" }),
          expect.objectContaining({
            kind: "to",
            outcome: "skipped",
            digest: reached,
          }),
        ]);
      } finally {
        process.env.NEXTLY_SECRET = original;
        if (previous === undefined) delete process.env.NEXTLY_SECRET_PREVIOUS;
        else process.env.NEXTLY_SECRET_PREVIOUS = previous;
        _resetEnvCache();
      }
    });

    it("lists and leaves out a recipient a send filter adds", async () => {
      await boot(dialect);
      const addAudit = (value: EmailPayloadFilterValue) => ({
        ...value,
        bcc: [...(value.bcc ?? []), AUDIT],
      });
      getFilterRegistry().addFilter(FilterSeams.EmailBeforeSend, addAudit);
      try {
        const first = await plugin().services.email.queue({
          ...message,
          to: ADA,
        });
        const audit = lastOf(first.id).recipients?.find(
          recipient => recipient.kind === "bcc"
        );
        expect(audit).toMatchObject({
          outcome: "accepted",
          digest: await digestOf(AUDIT),
        });

        const second = await plugin().services.email.queue({
          ...message,
          to: GRACE,
          excludeRecipients: [audit!.digest],
        });

        expect(list(calls[1]!.bcc as string[] | undefined)).not.toContain(
          AUDIT
        );
        expect(lastOf(second.id).recipients).toEqual([
          expect.objectContaining({ kind: "to", outcome: "accepted" }),
          expect.objectContaining({ kind: "bcc", outcome: "skipped" }),
        ]);
      } finally {
        getFilterRegistry().removeFilter(FilterSeams.EmailBeforeSend, addAudit);
      }
    });

    it("sends each copy alone when every `to` is left out", async () => {
      await boot(dialect);
      const { id } = await plugin().services.email.queue({
        ...message,
        to: ADA,
        cc: [GRACE],
        bcc: [LINUS],
        excludeRecipients: [await digestOf(ADA)],
      });

      expect(
        calls.map(call => ({
          to: list(call.to),
          cc: list(call.cc as string[] | undefined),
          bcc: list(call.bcc as string[] | undefined),
        }))
      ).toEqual([
        { to: [GRACE], cc: [], bcc: [] },
        { to: [LINUS], cc: [], bcc: [] },
      ]);
      expect(lastOf(id).recipients).toEqual([
        expect.objectContaining({ kind: "cc", outcome: "accepted" }),
        expect.objectContaining({ kind: "bcc", outcome: "accepted" }),
        expect.objectContaining({ kind: "to", outcome: "skipped" }),
      ]);
    });

    it("tells and reads its own emails only", async () => {
      const t = await boot(dialect);
      const site = await t.nextly.email.queue({ ...message, to: ADA });
      const own = await plugin().services.email.queue({ ...message, to: ADA });

      expect(changesOf(site.id)).toEqual([]);
      expect(
        (await plugin().services.email.readQueued([site.id, own.id])).map(
          status => status.id
        )
      ).toEqual([own.id]);
    });
  }
);
