/**
 * Retrying a queued email now, as a person who may manage email deliveries,
 * through the Direct API on every dialect.
 *
 * The provider is a real one that captures, fails, refuses or holds as each
 * test asks, so an attempt in flight is one the provider is still answering.
 * Each retry and cancel is recorded in the activity log by who made it, with
 * no address.
 */
// Read through the env proxy by the seal and the digests: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { loadedDialect } from "../../../database/dialect-tables";
import { container } from "../../../di/container";
import {
  account,
  role,
  seedPermissions,
} from "../../../direct-api/__tests__/checked-access-fixtures";
import { Nextly } from "../../../direct-api/nextly";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const ADA = "ada@example.com";
const message = { subject: "Your answers", html: "<p>Thanks</p>" };

/** Every call the provider was handed, in order. */
const calls: SentOptions[] = [];

/** A promise and the function that settles it. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
}

/** What the provider does next. */
const behaviour: {
  failures: number;
  refusals: number;
  gate?: Promise<void>;
  reached?: () => void;
} = { failures: 0, refusals: 0 };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  calls.length = 0;
  behaviour.failures = 0;
  behaviour.refusals = 0;
  behaviour.gate = undefined;
  behaviour.reached = undefined;
});

const provider = definePlugin({
  name: "retry-capture",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "capturing-retry",
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
              // Classified by the provider: no retry of its own can help.
              throw Object.assign(new Error("refused"), {
                emailFailure: { retryable: false, reason: "Refused." },
              });
            }
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
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [provider] });
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-retry",
      fromEmail: "from@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  return current;
}

interface QueueRow {
  id: string;
  state: string;
  message: string | null;
  failure: string | null;
}

async function queued(t: TestNextly, id: string): Promise<QueueRow> {
  const [row] = await t.adapter.select<QueueRow>("email_queue", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  if (!row) throw new Error(`no queued email ${id}`);
  return row;
}

/** One jobs trigger, `ahead` past now: past any backoff when it is long. */
function trigger(t: TestNextly, ahead = 0) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    now: () => new Date(Date.now() + ahead),
  });
}

const ORIGIN = "http://localhost";

/** A session for user `id` holding `roleIds`, as the admin sends it. */
async function sessionOf(
  id: string,
  roleIds: string[]
): Promise<Record<string, string>> {
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${id}@retry.test`,
      name: id,
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}` };
}

/** One request through the REST catch-all. */
function call(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>
): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: { origin: ORIGIN, ...headers },
  });
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: path.split("/").filter(Boolean) }),
  });
}

/** Every activity-log row filed under the delivery log's namespace. */
async function deliveryEntries(
  t: TestNextly,
  dialect: TestDialect
): Promise<Array<Record<string, unknown>>> {
  const table = loadedDialect(dialect).tables.activityLog;
  const db = t.adapter.getDrizzle() as never as {
    select(): {
      from(table: unknown): {
        where(condition: unknown): Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  return db
    .select()
    .from(table)
    .where(eq(table.collection as never, "email-deliveries"));
}

describe.each(getConfiguredTestDialects())(
  "retrying a queued email now (%s)",
  dialect => {
    it("retries a failed email whose message is held, sending it at the next pass", async () => {
      const t = await boot(dialect);
      behaviour.refusals = 1;
      const { id } = await t.nextly.email.queue({ ...message, to: ADA });
      expect(await queued(t, id)).toMatchObject({ state: "failed" });
      expect((await queued(t, id)).message).not.toBeNull();

      const retried = await t.nextly.email.retryQueued({ id });
      expect(retried.item).toEqual({ id, state: "waiting" });
      // Its last failure stays until the next attempt, so it reads as
      // retrying.
      const waiting = await queued(t, id);
      expect(waiting.state).toBe("waiting");
      expect(waiting.failure).not.toBeNull();

      // Due now: no backoff to wait past.
      await trigger(t);
      expect(await queued(t, id)).toMatchObject({ state: "sent" });
      expect(calls).toHaveLength(2);
    });

    it("brings a retrying email's next attempt forward to now", async () => {
      const t = await boot(dialect);
      behaviour.failures = 1;
      const { id } = await t.nextly.email.queue({ ...message, to: ADA });
      expect(await queued(t, id)).toMatchObject({ state: "waiting" });

      // Its next attempt is backed off: a trigger now sends nothing.
      await trigger(t);
      expect(calls).toHaveLength(1);

      await t.nextly.email.retryQueued({ id });
      await trigger(t);
      expect(await queued(t, id)).toMatchObject({ state: "sent" });
      expect(calls).toHaveLength(2);
    });

    it("refuses a retry while an attempt is with the provider", async () => {
      const t = await boot(dialect);
      const arrived = latch();
      const held = latch();
      behaviour.gate = held.promise;
      behaviour.reached = arrived.open;
      const queuing = t.nextly.email.queue({ ...message, to: ADA });
      await arrived.promise;
      const [sending] = await t.adapter.select<QueueRow>("email_queue", {
        where: { and: [{ column: "state", op: "=", value: "sending" }] },
      });
      expect(sending).toBeDefined();

      await expect(
        t.nextly.email.retryQueued({ id: sending.id })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      behaviour.gate = undefined;
      held.open();
      await queuing;
      // The attempt in flight decided it, and only it went to the provider.
      expect(await queued(t, sending.id)).toMatchObject({ state: "sent" });
      expect(calls).toHaveLength(1);
    });

    it("refuses a retry of an email sent, cancelled or cleared, and of none", async () => {
      const t = await boot(dialect);
      const sent = await t.nextly.email.queue({ ...message, to: ADA });
      await expect(
        t.nextly.email.retryQueued({ id: sent.id })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const cancelled = await t.nextly.email.queue({ ...message, to: ADA });
      await t.nextly.email.cancelQueued({ id: cancelled.id });
      await expect(
        t.nextly.email.retryQueued({ id: cancelled.id })
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // Failed, then its message cleared, as an erasure clears it.
      behaviour.failures = 0;
      behaviour.refusals = 1;
      const cleared = await t.nextly.email.queue({ ...message, to: ADA });
      const queue = loadedDialect(dialect).tables.emailQueue;
      const db = t.adapter.getDrizzle() as never as {
        update(table: unknown): {
          set(values: unknown): { where(c: unknown): Promise<unknown> };
        };
      };
      await db
        .update(queue)
        .set({ message: null })
        .where(eq(queue.id as never, cleared.id));
      await expect(
        t.nextly.email.retryQueued({ id: cleared.id })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicMessage: expect.stringContaining("cleared"),
      });

      await expect(
        t.nextly.email.retryQueued({
          id: "00000000-0000-4000-8000-000000000000",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("sends a template-caused failure again from the template as fixed and saved", async () => {
      const t = await boot(dialect);
      const made = await t.nextly.emailTemplates.create({
        data: {
          name: "Contact",
          slug: "contact",
          subject: "Thanks",
          htmlContent: "<p>Thanks</p>",
          replyTo: "{{ replyTo }}",
        },
      });
      const { id } = await t.nextly.email.queueWithTemplate({
        template: "contact",
        to: ADA,
        variables: { replyTo: "not an address" },
      });
      expect(
        await t.nextly.emailDeliveries.findQueuedByID({ id })
      ).toMatchObject({ state: "failed", templateCaused: true });

      // Fixed and saved, then retried.
      await t.nextly.emailTemplates.update({
        id: made.item.id,
        data: { replyTo: "help@example.com" },
      });
      await t.nextly.email.retryQueued({ id });
      await trigger(t);

      expect(await queued(t, id)).toMatchObject({ state: "sent" });
      expect(calls.at(-1)?.replyTo).toBe("help@example.com");
    });

    it("asks manage-email-deliveries on the Direct API, and records each retry and cancel by who, with no address", async () => {
      const t = await boot(dialect);
      behaviour.refusals = 1;
      const failed = await t.nextly.email.queue({ ...message, to: ADA });
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const waiting = await t.nextly.email.queue({ ...message, to: ADA });

      await seedPermissions(t);
      const manager = await account(t, "manager@example.com", [
        await role(t, "delivery-manager", ["manage-email-deliveries"]),
      ]);
      const reader = await account(t, "reader@example.com", [
        await role(t, "delivery-reader", ["read-email-deliveries"]),
      ]);
      const before = await deliveryEntries(t, dialect);

      for (const userId of [reader]) {
        await expect(
          new Nextly({
            overrideAccess: false,
            user: { id: userId },
          }).email.retryQueued({ id: failed.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect((await queued(t, failed.id)).state).toBe("failed");

      const as = new Nextly({ overrideAccess: false, user: { id: manager } });
      await as.email.retryQueued({ id: failed.id });
      await as.email.cancelQueued({ id: waiting.id });

      const after = await deliveryEntries(t, dialect);
      const known = new Set(before.map(row => row.id));
      const added = after.filter(row => !known.has(row.id));
      const metadataOf = (row: Record<string, unknown>) =>
        typeof row.metadata === "string"
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : row.metadata;
      expect(
        added
          .map(row => ({
            action: row.action,
            entryId: row.entryId,
            userId: row.userId,
            metadata: metadataOf(row),
          }))
          .sort((a, b) => String(a.entryId).localeCompare(String(b.entryId)))
      ).toEqual(
        [
          {
            action: "update",
            entryId: failed.id,
            userId: manager,
            metadata: { operation: "retry", changedFields: ["state"] },
          },
          {
            action: "update",
            entryId: waiting.id,
            userId: manager,
            metadata: { operation: "cancel", changedFields: ["state"] },
          },
        ].sort((a, b) => a.entryId.localeCompare(b.entryId))
      );
      expect(JSON.stringify(added)).not.toContain(ADA);
    });

    it("offers retry and cancel on REST to a holder of manage-email-deliveries alone", async () => {
      const t = await boot(dialect);
      behaviour.refusals = 1;
      const failed = await t.nextly.email.queue({ ...message, to: ADA });
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const waiting = await t.nextly.email.queue({ ...message, to: ADA });

      await seedPermissions(t);
      const managerRole = await role(t, "delivery-manager", [
        "manage-email-deliveries",
      ]);
      const readerRole = await role(t, "delivery-reader", [
        "read-email-deliveries",
      ]);
      const strangerRole = await role(t, "user-reader", ["read-users"]);
      const manager = await sessionOf(
        await account(t, "manager@example.com", [managerRole]),
        [managerRole]
      );
      const reader = await sessionOf(
        await account(t, "reader@example.com", [readerRole]),
        [readerRole]
      );
      const stranger = await sessionOf(
        await account(t, "stranger@example.com", [strangerRole]),
        [strangerRole]
      );

      for (const headers of [reader, stranger, {}]) {
        for (const path of [
          `email-deliveries/queued/${failed.id}/retry`,
          `email-deliveries/queued/${waiting.id}/cancel`,
        ]) {
          const refused = await call("POST", path, headers);
          expect([401, 403], path).toContain(refused.status);
        }
      }
      expect((await queued(t, failed.id)).state).toBe("failed");
      expect((await queued(t, waiting.id)).state).toBe("waiting");

      const retried = await call(
        "POST",
        `email-deliveries/queued/${failed.id}/retry`,
        manager
      );
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({
        message: expect.any(String),
        item: { id: failed.id, state: "waiting" },
      });
      const cancelled = await call(
        "POST",
        `email-deliveries/queued/${waiting.id}/cancel`,
        manager
      );
      expect(cancelled.status).toBe(200);
      expect((await queued(t, waiting.id)).state).toBe("cancelled");

      // A refusal says why, as a conflict.
      const again = await call(
        "POST",
        `email-deliveries/queued/${waiting.id}/retry`,
        manager
      );
      expect(again.status).toBe(409);
      // A GET names no action.
      expect(
        (
          await call(
            "GET",
            `email-deliveries/queued/${failed.id}/retry`,
            manager
          )
        ).status
      ).not.toBe(200);
    });
  }
);
