/**
 * Erasure reaches queued email, and a held message outlives secret
 * rotations, on every configured dialect.
 *
 * Deleting a person, a plugin's or a staff user, cancels and clears every
 * queued email naming them; erasing an address cancels and clears every one
 * to it that names nobody. A queued email committing after its person's
 * deletion is cancelled without an attempt, in either order of the two
 * transactions, and an attempt already with the provider finishes and is
 * recorded erased. A held message is sealed again under each rotated secret
 * and is never written to a log.
 *
 * @module domains/email/__tests__/queued-email-erasure.integration.test
 */

// Read through the env proxy by the seal and the digests: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { env } from "../../../lib/env";
import { _resetEnvCache } from "../../../shared/lib/env";
import {
  type NextlyLogger,
  setNextlyLogger,
} from "../../../observability/logger";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import { staffPerson } from "../../../plugins/principals/ref";
import type { PrincipalRef } from "../../../plugins/principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../shared/types";
import { rowLockServer } from "../../audit/audit-log-writer";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { pluginSettingsSecrets } from "../../plugins/settings-service";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";
import { defineEmailProvider } from "../provider-definition";
import {
  attemptQueuedEmail,
  openQueuedMessage,
  resealQueuedMessages,
  storeQueuedEmail,
} from "../queued-send";
import { scopedSender } from "../send-claims";
import type { EmailService } from "../services/email-service";
import { EmailDeliveryService } from "../services/email-delivery-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { sealSetting } from "../../plugins/settings-crypto";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const KIND = "accounts:account";
const SHARED = "shared@example.com";
const SUBJECT = "Your order has shipped";
const BODY = "<p>Order 4417 is on its way</p>";

/** Every call the capturing provider was handed, in order. */
const calls: SentOptions[] = [];
const behaviour: {
  /** Calls that fail as retryable. */
  failures: number;
  /** Held until released, once `reached` has said the call arrived. */
  gate?: Promise<void>;
  reached?: () => void;
} = { failures: 0 };

/** Every line the server logger and the Nextly logger were given. */
const logged: string[] = [];
const logger: Logger = {
  debug: (m, meta) => logged.push(`${m} ${JSON.stringify(meta ?? null)}`),
  info: (m, meta) => logged.push(`${m} ${JSON.stringify(meta ?? null)}`),
  warn: (m, meta) => logged.push(`${m} ${JSON.stringify(meta ?? null)}`),
  error: (m, meta) => logged.push(`${m} ${JSON.stringify(meta ?? null)}`),
};

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  setNextlyLogger(undefined);
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  calls.length = 0;
  logged.length = 0;
  behaviour.failures = 0;
  behaviour.gate = undefined;
  behaviour.reached = undefined;
});

const accounts = definePlugin({
  name: "accounts",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve: async () => null,
        lookup: async (id: string) => ({ id, attributes: { verified: true } }),
      },
    ],
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "capturing-erasure",
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
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, logger, plugins: [accounts] });
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-erasure",
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

async function person(id: string): Promise<PrincipalRef> {
  const found = await plugin().principals!.byId("account", id);
  if (!found) throw new Error(`no person ${id}`);
  return found;
}

interface QueueRow {
  id: string;
  state: string;
  jobId: string | null;
  message: string | null;
  principalKind: string | null;
  principalId: string | null;
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
  return rows.map(row => row.recipientHash).sort();
}

/** One jobs trigger, past any backoff the queue scheduled. */
function trigger(t: TestNextly) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    now: () => new Date(Date.now() + 2 * 60 * 60_000),
  });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A promise and the function that settles it. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>(resolve => (open = resolve));
  return { promise, open };
}

const message = { subject: SUBJECT, html: BODY };

/** A template every boot seeds, for a call that never gets as far as it. */
const SHARED_TEMPLATE = "welcome";

describe.each(getConfiguredTestDialects())(
  "queued email and erasure (%s)",
  dialect => {
    it("keeps each recipient's digest while it is held, never the address", async () => {
      const t = await boot(dialect);
      behaviour.failures = 1;

      const result = await t.nextly.email.queue({
        ...message,
        to: SHARED,
        cc: ["copy@example.com"],
      });

      expect(result.state).toBe("waiting");
      expect(await recipientsOf(t, result.id)).toEqual(
        [recipientDigest(SHARED), recipientDigest("copy@example.com")].sort()
      );
    });

    it("is cancelled and cleared when the plugin reports its person deleted", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_gone");
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const result = await plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: gone,
      });
      expect(result.state).toBe("waiting");
      expect(await queued(t, result.id)).toMatchObject({
        principalKind: KIND,
        principalId: "acc_gone",
      });

      await plugin().principals!.reportDeleted(gone);
      const attempts = calls.length;
      await trigger(t);

      const row = await queued(t, result.id);
      expect(row).toMatchObject({ state: "cancelled", message: null });
      expect(row.principalId).toMatch(/^[0-9a-f]{64}$/);
      expect(await recipientsOf(t, result.id)).toEqual([]);
      expect(calls).toHaveLength(attempts);
    });

    it("is cancelled and cleared when its staff user is deleted", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.users.create({
        data: {
          email: "staff-member@example.com",
          name: "Staff Member",
          password: "CorrectHorseBattery1!",
        },
      } as never);
      const userId = String((created as { item: { id: unknown } }).item.id);
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const result = await t.nextly.email.queue({
        ...message,
        to: "staff-member@example.com",
        person: staffPerson(userId),
      });
      expect(result.state).toBe("waiting");

      await t.nextly.users.delete({ id: userId } as never);

      const row = await queued(t, result.id);
      expect(row).toMatchObject({ state: "cancelled", message: null });
      expect(row.principalId).toMatch(/^[0-9a-f]{64}$/);
      expect(await recipientsOf(t, result.id)).toEqual([]);
    });

    it("is cancelled and cleared when its address is erased, unless it names a person", async () => {
      const t = await boot(dialect);
      const someone = await person("acc_kept");
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const unnamed = await t.nextly.email.queue({ ...message, to: SHARED });
      const named = await plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: someone,
      });
      const elsewhere = await t.nextly.email.queue({
        ...message,
        to: "other@example.com",
      });

      await new EmailDeliveryService(
        t.adapter as never,
        logger as never
      ).eraseRecipient(SHARED);

      expect(await queued(t, unnamed.id)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(await recipientsOf(t, unnamed.id)).toEqual([]);
      // One naming a person is theirs, and goes with their deletion.
      expect((await queued(t, named.id)).state).toBe("waiting");
      expect(await recipientsOf(t, named.id)).toEqual([
        recipientDigest(SHARED),
      ]);
      expect((await queued(t, elsewhere.id)).state).toBe("waiting");
    });

    it("is cancelled when a copied address is erased, though it names a person", async () => {
      // The person named is the email's `to`; a copy is someone else, and
      // erasing them must stop the email reaching them.
      const t = await boot(dialect);
      const someone = await person("acc_with_copy");
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const result = await plugin().services.email.queue({
        ...message,
        to: SHARED,
        cc: ["copied@example.com"],
        person: someone,
      });

      await new EmailDeliveryService(
        t.adapter as never,
        logger as never
      ).eraseRecipient("copied@example.com");

      expect(await queued(t, result.id)).toMatchObject({
        state: "cancelled",
        message: null,
      });
      expect(await recipientsOf(t, result.id)).toEqual([]);
    });

    it("is cancelled when a copy its template adds is erased", async () => {
      // A template's own cc and bcc are added at send time; queued, the
      // email must still be found by them.
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: {
          name: "With copies",
          slug: "with-copies",
          subject: "Hello",
          htmlContent: "<p>hi</p>",
          isActive: true,
          cc: ["template-copy@example.com"],
        },
      } as never);
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const result = await t.nextly.email.queueWithTemplate({
        template: "with-copies",
        to: SHARED,
        variables: {},
      });
      expect(result.state).toBe("waiting");
      // The first attempt did copy the template's address.
      expect(calls[0]?.cc).toEqual(["template-copy@example.com"]);

      // And it is still found after the secret rotates and the message is
      // sealed again, which re-keys every recipient's digest.
      const original = process.env.NEXTLY_SECRET ?? "";
      const rotated = "rotated-secret-at-least-32-characters-long!!";
      try {
        process.env.NEXTLY_SECRET = rotated;
        _resetEnvCache();
        expect(
          await resealQueuedMessages(t.adapter, [rotated, original])
        ).toEqual({ resealed: 1, unreadable: 0 });
        await new EmailDeliveryService(
          t.adapter as never,
          logger as never
        ).eraseRecipient("template-copy@example.com");
      } finally {
        process.env.NEXTLY_SECRET = original;
        _resetEnvCache();
      }

      expect(await queued(t, result.id)).toMatchObject({
        state: "cancelled",
        message: null,
      });
    });

    it("sends the copies its template had when it was queued, not ones edited in since", async () => {
      // What is indexed for erasure is what is sent: a copy added to the
      // template after the email was queued never reaches it.
      const t = await boot(dialect);
      const created = (await t.nextly.emailTemplates.create({
        data: {
          name: "Copies edited",
          slug: "copies-edited",
          subject: "Hello",
          htmlContent: "<p>hi</p>",
          isActive: true,
          cc: ["first-copy@example.com"],
        },
      } as never)) as { item: { id: string } };
      behaviour.failures = 1;
      const result = await t.nextly.email.queueWithTemplate({
        template: "copies-edited",
        to: SHARED,
        variables: {},
      });
      expect(result.state).toBe("waiting");
      await t.nextly.emailTemplates.update({
        id: created.item.id,
        data: { cc: ["added-later@example.com"] },
      } as never);

      await trigger(t);

      expect(calls).toHaveLength(2);
      expect(calls[1]?.cc).toEqual(["first-copy@example.com"]);
      expect((await queued(t, result.id)).state).toBe("sent");
    });

    it("sends none of its frozen copies once its template carries a secret", async () => {
      // An owner redeploys the template marked as carrying a secret between
      // attempts: the retry renders that content, so the copies frozen when
      // the email was queued must not receive it.
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: {
          name: "Turns secret",
          slug: "turns-secret",
          subject: "Hello",
          htmlContent: "<p>hi</p>",
          isActive: true,
          cc: ["copied@example.com"],
        },
      } as never);
      behaviour.failures = 1;
      const result = await t.nextly.email.queueWithTemplate({
        template: "turns-secret",
        to: SHARED,
        variables: {},
      });
      expect(result.state).toBe("waiting");
      expect(calls[0]?.cc).toEqual(["copied@example.com"]);
      await t.adapter.update(
        "email_templates",
        { carriesSecret: true },
        { and: [{ column: "slug", op: "=", value: "turns-secret" }] }
      );

      await trigger(t);

      // Without its copies the message differs from the one its key went
      // out with, so the retry is refused rather than sent: the copy never
      // receives what the template now carries.
      expect(calls).toHaveLength(1);
      const row = await queued(t, result.id);
      expect(row.state).toBe("failed");
      expect(
        JSON.parse((row as unknown as { failure: string }).failure)
      ).toMatchObject({ retryable: false, status: 409 });
    });

    it("refuses a template email queued in an open transaction without tx, before reading the template", async () => {
      // Read on the pool from inside the transaction, the lookup could wait
      // on that transaction's own connection.
      const t = await boot(dialect);
      const lookup = vi.spyOn(
        container.get<EmailTemplateService>("emailTemplateService"),
        "resolveForSend"
      );
      await expect(
        plugin().db.transaction(async () => {
          await plugin().services.email.queueWithTemplate(
            SHARED_TEMPLATE,
            SHARED,
            {}
          );
        })
      ).rejects.toThrow();
      expect(lookup).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    });

    it("has its recipients' digests removed with it when it is pruned", async () => {
      const t = await boot(dialect);
      const result = await t.nextly.email.queue({ ...message, to: SHARED });
      expect(result.state).toBe("sent");
      expect(await recipientsOf(t, result.id)).toHaveLength(1);

      await runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
        now: () => new Date(Date.now() + 8 * 24 * 60 * 60_000),
      });

      const rows = await t.adapter.select("email_queue", {
        where: { and: [{ column: "id", op: "=", value: result.id }] },
      });
      expect(rows).toEqual([]);
      expect(await recipientsOf(t, result.id)).toEqual([]);
    });

    it("is stored cancelled, and never sent, when its person was deleted first", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_first");
      await plugin().principals!.reportDeleted(gone);

      const result = await plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: gone,
      });
      await trigger(t);

      expect(result.state).toBe("cancelled");
      expect(calls).toEqual([]);
      const row = await queued(t, result.id);
      expect(row).toMatchObject({
        state: "cancelled",
        message: null,
        jobId: null,
      });
      expect(row.principalId).toMatch(/^[0-9a-f]{64}$/);
      expect(await recipientsOf(t, result.id)).toEqual([]);
    });

    it("is cancelled when its person's deletion starts before it commits", async () => {
      // Queued first, still uncommitted when the deletion starts: the
      // deletion waits for it, then finds it and cancels it.
      const t = await boot(dialect);
      const gone = await person("acc_race_queued");
      behaviour.failures = Number.MAX_SAFE_INTEGER;
      const held = latch();
      let id = "";
      const queuing = plugin().db.transaction(async tx => {
        id = (
          await plugin().services.email.queue({
            ...message,
            to: SHARED,
            person: gone,
            tx,
          })
        ).id;
        await held.promise;
      });
      await sleep(300);
      const reporting = plugin().principals!.reportDeleted(gone);
      await sleep(750);
      held.open();
      await queuing;
      await reporting;
      const attempts = calls.length;
      await trigger(t);

      expect((await queued(t, id)).state).toBe("cancelled");
      expect(await recipientsOf(t, id)).toEqual([]);
      expect(calls).toHaveLength(attempts);
    }, 120_000);

    it("is stored cancelled when it commits after its person's deletion started", async () => {
      // The deletion first, still uncommitted when the email is queued: the
      // queue waits for it, then stores the email cancelled.
      const t = await boot(dialect);
      const gone = await person("acc_race_deleted");
      const held = latch();
      const reporting = plugin().db.transaction(async tx => {
        await plugin().principals!.reportDeleted(gone, { tx });
        await held.promise;
      });
      await sleep(300);
      const queuing = plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: gone,
      });
      await sleep(750);
      held.open();
      await reporting;
      const result = await queuing;
      await trigger(t);

      expect(result.state).toBe("cancelled");
      expect(calls).toEqual([]);
    }, 120_000);

    it("sends nothing when its person is deleted between an attempt's first read and its claim", async () => {
      // The attempt reads the email waiting, the deletion then commits, and
      // only then does the attempt claim it: it must find it cancelled, not
      // send the message it would have read first.
      const t = await boot(dialect);
      const gone = await person("acc_between");
      behaviour.failures = 1;
      const result = await plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: gone,
      });
      expect(result.state).toBe("waiting");
      const attempts = calls.length;

      await attemptQueuedEmail(
        {
          adapter: deletingAfterFirstRead(t, () =>
            plugin().principals!.reportDeleted(gone)
          ) as never,
          sender: scope =>
            scopedSender(t.getService("emailService") as EmailService, scope),
          secrets: pluginSettingsSecrets(env),
        },
        { queuedId: result.id },
        { attempt: 2, now: new Date() }
      );

      expect(calls).toHaveLength(attempts);
      expect((await queued(t, result.id)).state).toBe("cancelled");
    });

    it("lets an attempt already with the provider finish, and records it erased", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_in_flight");
      const arrived = latch();
      const held = latch();
      behaviour.gate = held.promise;
      behaviour.reached = arrived.open;
      const queuing = plugin().services.email.queue({
        ...message,
        to: SHARED,
        person: gone,
      });
      await arrived.promise;

      await plugin().principals!.reportDeleted(gone);
      held.open();
      const result = await queuing;

      expect(result.state).toBe("sent");
      expect(calls).toHaveLength(1);
      const row = await queued(t, result.id);
      expect(row.message).toBeNull();
      expect(row.principalId).toMatch(/^[0-9a-f]{64}$/);
      const deliveries = await t.adapter.select<{ recipientHash: string }>(
        "email_deliveries"
      );
      expect(deliveries.map(d => d.recipientHash)).toEqual([
        ERASED_RECIPIENT_HASH,
      ]);
    }, 120_000);

    it("stays deliverable across two rotations of the secret", async () => {
      const t = await boot(dialect);
      const [first, second, third] = [
        "first-secret-at-least-32-characters-long!!!",
        "second-secret-at-least-32-characters-long!!",
        "third-secret-at-least-32-characters-long!!!",
      ];
      const dialectName = t.adapter.getCapabilities().dialect;
      const stored = await t.adapter.transaction(ctx =>
        storeQueuedEmail(ctx, {
          scope: "site",
          message: { kind: "message", send: { ...message, to: SHARED } },
          person: null,
          secrets: [first],
          lockServer: rowLockServer(t.adapter, dialectName),
          dialect: dialectName,
          now: new Date(),
        })
      );
      const opens = async (secrets: string[]) =>
        openQueuedMessage(
          (await queued(t, stored.id)).message ?? "",
          stored.id,
          secrets
        ) !== undefined;

      // The install's secret as each boot after a rotation has it, which is
      // what the recipients' digests are keyed with.
      const original = process.env.NEXTLY_SECRET;
      const rotateTo = (secret: string) => {
        process.env.NEXTLY_SECRET = secret;
        _resetEnvCache();
      };
      const digests = async () => recipientsOf(t, stored.id);
      try {
        // The first boot after a rotation, with the old secret kept as previous.
        rotateTo(second);
        expect(await resealQueuedMessages(t.adapter, [second, first])).toEqual({
          resealed: 1,
          unreadable: 0,
        });
        expect(await opens([second])).toBe(true);
        expect(await digests()).toEqual([recipientDigest(SHARED)]);
        // A second rotation soon after: the first secret is gone by now, and
        // an erasure must still find the email by its address.
        rotateTo(third);
        expect(await resealQueuedMessages(t.adapter, [third, second])).toEqual({
          resealed: 1,
          unreadable: 0,
        });
        expect(await opens([third])).toBe(true);
        expect(await digests()).toEqual([recipientDigest(SHARED)]);
      } finally {
        process.env.NEXTLY_SECRET = original;
        _resetEnvCache();
      }
      // Nothing left to move, and a boot that does not know the secret says so.
      expect(await resealQueuedMessages(t.adapter, [third, second])).toEqual({
        resealed: 0,
        unreadable: 0,
      });
      expect(await resealQueuedMessages(t.adapter, [first])).toEqual({
        resealed: 0,
        unreadable: 1,
      });
    });

    it("re-seals the rest when one held message opens but does not parse", async () => {
      const t = await boot(dialect);
      const [old, current] = [
        "old-secret-at-least-32-characters-long!!!!!",
        "current-secret-at-least-32-characters-long!",
      ];
      const dialectName = t.adapter.getCapabilities().dialect;
      const store = () =>
        t.adapter.transaction(ctx =>
          storeQueuedEmail(ctx, {
            scope: "site",
            message: { kind: "message", send: { ...message, to: SHARED } },
            person: null,
            secrets: [old],
            lockServer: rowLockServer(t.adapter, dialectName),
            dialect: dialectName,
            now: new Date(),
          })
        );
      const damaged = await store();
      const sound = await store();
      // Sealed under the old secret, authenticated, and not a message.
      await t.adapter.update(
        "email_queue",
        {
          message: `sealed:${sealSetting("not a message", old, "nextly core", ["email_queue", damaged.id])}`,
        },
        { and: [{ column: "id", op: "=", value: damaged.id }] }
      );

      expect(await resealQueuedMessages(t.adapter, [current, old])).toEqual({
        resealed: 1,
        unreadable: 1,
      });
      expect(
        openQueuedMessage((await queued(t, sound.id)).message ?? "", sound.id, [
          current,
        ])
      ).toBeDefined();
    });

    it("never writes its address, subject or body to a log", async () => {
      const t = await boot(dialect);
      const captured: NextlyLogger = {
        error: p => logged.push(JSON.stringify(p)),
        warn: p => logged.push(JSON.stringify(p)),
        info: p => logged.push(JSON.stringify(p)),
        debug: p => logged.push(JSON.stringify(p)),
      };
      setNextlyLogger(captured);
      behaviour.failures = 1;
      const result = await t.nextly.email.queue({ ...message, to: SHARED });
      await trigger(t);

      expect((await queued(t, result.id)).state).toBe("sent");
      // A positive control: the failed attempt was logged at all.
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(SHARED);
        expect(line).not.toContain(SUBJECT);
        expect(line).not.toContain("Order 4417");
      }
      // And the secret's value was never needed to say any of it.
      expect(pluginSettingsSecrets(env).length).toBeGreaterThan(0);
    });
  }
);

/**
 * The booted adapter, whose Drizzle handle runs `between` once, after the
 * first read of `email_queue` returns its rows and before the attempt goes
 * on. Every step of a query builder is wrapped, since Drizzle's builders are
 * thenable at every step and `limit` is where a read ends.
 */
function deletingAfterFirstRead(
  t: TestNextly,
  between: () => Promise<unknown>
): unknown {
  const real = t.adapter as unknown as {
    getCapabilities(): unknown;
    getDrizzle(relations?: unknown): object;
  };
  let done = false;
  const tableName = (table: unknown): string =>
    String(
      (table as Record<symbol, unknown> | undefined)?.[
        Symbol.for("drizzle:Name")
      ] ?? ""
    );
  const wrap = (builder: object, readingQueue: boolean): object =>
    new Proxy(builder, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (typeof value !== "function") return value;
        // A promise's own methods run on the promise, not on this wrapper.
        if (prop === "then" || prop === "catch" || prop === "finally") {
          return (value as (...a: unknown[]) => unknown).bind(target);
        }
        return (...args: unknown[]) => {
          const next = (value as (...a: unknown[]) => unknown).apply(
            target,
            args
          );
          const queue =
            prop === "from"
              ? tableName(args[0]) === "email_queue"
              : readingQueue;
          if (prop === "limit" && queue && !done) {
            done = true;
            return Promise.resolve(next).then(async rows => {
              await between();
              return rows;
            });
          }
          return next !== null && typeof next === "object"
            ? wrap(next, queue)
            : next;
        };
      },
    });
  return {
    getCapabilities: () => real.getCapabilities(),
    getDrizzle: (relations?: unknown) =>
      wrap(real.getDrizzle(relations), false),
  };
}
