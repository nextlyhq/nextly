/**
 * A queued email is stored with its caller's change, attempted once that
 * change commits, and retried through the job queue, on every configured
 * dialect.
 *
 * Queued with no jobs trigger, it is sent at once; queued in a plugin's
 * transaction, it is stored only if that commits and attempted after; stored
 * and never attempted, it goes at the next jobs run. A retryable failure is
 * retried up to the limit, one that is not fails at once, every attempt uses
 * one key, a template is rendered at its attempt, the message is held sealed
 * outside the job, and a queued email overdue because the trigger is not
 * running is warned about.
 *
 * @module domains/email/__tests__/queued-send.integration.test
 */

// Read through the env proxy by the seal and the digests: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { runPostInitTasks } from "../../../init/post-init-tasks";
import { env } from "../../../lib/env";
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
import type { Logger } from "../../../shared/types";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { linkedTransaction } from "../../../plugins/database/plugin-transaction-link";
import { staffPerson } from "../../../plugins/principals/ref";
import { pluginSettingsSecrets } from "../../plugins/settings-service";
import { withEmailFailure } from "../failure";
import { defineEmailProvider } from "../provider-definition";
import {
  LATE_QUEUED_EMAIL_MS,
  warnAboutLateQueuedEmail,
} from "../queued-email-warning";
import {
  QUEUED_EMAIL_JOB,
  QUEUED_EMAIL_MAX_ATTEMPTS,
} from "../queued-email-job";
import { storeQueuedEmail } from "../queued-send";
import { markHtml } from "../services/liquid-engine";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const SUBJECT = "Your order has shipped";

/** Every call the capturing provider was handed, in order. */
const calls: SentOptions[] = [];

/** What the provider's next calls do. */
const behaviour: {
  /** Calls that fail as retryable, unclassified as a thrown error is. */
  failures: number;
  /** Calls refused as not retryable. */
  refusals: number;
  /** Calls delivered whose answer is then lost. */
  lostResponses: number;
} = { failures: 0, refusals: 0, lostResponses: 0 };

/** Keys the provider delivered under, once each, as a provider that takes a key would. */
const delivered = new Set<string>();

/** Every warning the server logged. */
const warnings: string[] = [];

const logger: Logger = {
  debug() {},
  info() {},
  warn(message: string) {
    warnings.push(message);
  },
  error() {},
};

let context: PluginContext | undefined;
let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  context = undefined;
  calls.length = 0;
  delivered.clear();
  warnings.length = 0;
  behaviour.failures = 0;
  behaviour.refusals = 0;
  behaviour.lostResponses = 0;
});

/** A provider that takes a key, records every call, and fails as told. */
const capturing = defineEmailProvider<Record<string, never>>({
  type: "capturing-queued",
  label: "Capturing",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: () => ({
    acceptsIdempotencyKey: true,
    send: async (options: SentOptions) => {
      calls.push(options);
      if (behaviour.refusals > 0) {
        behaviour.refusals -= 1;
        throw withEmailFailure(new Error("refused"), {
          retryable: false,
          status: 422,
          reason: "The provider refused the address.",
        });
      }
      if (behaviour.failures > 0) {
        behaviour.failures -= 1;
        throw new Error("provider down");
      }
      // Delivered once per key: a repeat of a key is answered, not sent again.
      if (options.idempotencyKey !== undefined) {
        delivered.add(options.idempotencyKey);
      }
      if (behaviour.lostResponses > 0) {
        behaviour.lostResponses -= 1;
        throw new Error("connection reset before the answer");
      }
      return { success: true, messageId: `captured-${calls.length}` };
    },
  }),
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    logger,
    plugins: [
      definePlugin({
        name: "queuer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [capturing] },
        init(ctx: PluginContext) {
          context = ctx;
        },
      } as never),
    ],
  });
  current = t;
  await t.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-queued",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  await t.nextly.emailTemplates.create({
    data: {
      name: "Notice",
      slug: "notice",
      subject: "Hello {{ who }}",
      htmlContent: "<p>{{ note }} {{ plain }}</p>",
      isActive: true,
    },
  });
  return t;
}

function plugin(): PluginContext {
  if (!context) throw new Error("the plugin did not initialise");
  return context;
}

interface QueueRow {
  id: string;
  scope: string;
  state: string;
  jobId: string;
  message: string | null;
  failure: string | null;
  settledAt: number | null;
}

interface JobRow {
  id: string;
  slug: string;
  input: unknown;
  state: string;
  attemptCount: number;
  nextAttemptAt: Date | string | number | null;
}

async function queued(t: TestNextly): Promise<QueueRow[]> {
  return t.adapter.select<QueueRow>("email_queue");
}

async function emailJobs(t: TestNextly): Promise<JobRow[]> {
  return t.adapter.select<JobRow>("nextly_jobs", {
    where: { and: [{ column: "slug", op: "=", value: QUEUED_EMAIL_JOB }] },
  });
}

/** The job input as stored; JSON text on SQLite, a value elsewhere. */
function inputOf(job: JobRow): unknown {
  return typeof job.input === "string" ? JSON.parse(job.input) : job.input;
}

/** One jobs trigger, as `/api/jobs/run` makes it, at `now`. */
function trigger(t: TestNextly, now = new Date()) {
  return runJobsPass(t.adapter, t.getService("jobRegistry") as JobRegistry, {
    now: () => now,
  });
}

/** A time past any backoff the queue could have scheduled from now. */
function later(steps: number): Date {
  return new Date(Date.now() + steps * 2 * 60 * 60_000);
}

const message = { to: A, subject: SUBJECT, html: "<p>Shipped</p>" };

describe.each(getConfiguredTestDialects())("a queued email (%s)", dialect => {
  it("is sent at once with no jobs trigger, its message cleared and kept out of the job", async () => {
    const t = await boot(dialect);

    const result = await t.nextly.email.queue(message);

    expect(result).toEqual({ id: expect.any(String), state: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(A);
    const [row] = await queued(t);
    expect(row).toMatchObject({ id: result.id, scope: "site", state: "sent" });
    expect(row.settledAt).toEqual(expect.any(Number));
    // Sent, so nothing of it is held any longer.
    expect(row.message).toBeNull();
    // The job carries the email's id and nothing of its message.
    const [job] = await emailJobs(t);
    expect(job.id).toBe(row.jobId);
    expect(inputOf(job)).toEqual({ queuedId: result.id });
    expect(JSON.stringify(job)).not.toContain(A);
  });

  it("holds its message sealed while it waits, and clears it once sent", async () => {
    const t = await boot(dialect);
    behaviour.failures = 1;

    const result = await t.nextly.email.queue(message);
    expect(result.state).toBe("waiting");
    const [waiting] = await queued(t);
    // Sealed: neither the address nor the subject is readable at rest.
    expect(waiting.message).toMatch(/^sealed:v2:/);
    expect(waiting.message).not.toContain(A);
    expect(waiting.message).not.toContain(SUBJECT);

    await trigger(t, later(1));

    const [sent] = await queued(t);
    expect(sent.state).toBe("sent");
    expect(sent.message).toBeNull();
  });

  it("is removed by a jobs run seven days after it settles, and never while it waits", async () => {
    // By the queue's own sweep, so it holds whatever the delivery records'
    // retention is, kept for ever included.
    const t = await boot(dialect);
    const sent = await t.nextly.email.queue(message);
    behaviour.failures = Number.MAX_SAFE_INTEGER;
    const waiting = await t.nextly.email.queue(message);
    expect([sent.state, waiting.state]).toEqual(["sent", "waiting"]);
    const day = 24 * 60 * 60_000;
    const pass = (days: number) =>
      trigger(t, new Date(Date.now() + days * day));

    await pass(6);
    expect((await queued(t)).map(row => row.id).sort()).toEqual(
      [sent.id, waiting.id].sort()
    );

    await pass(8);
    expect((await queued(t)).map(row => row.id)).toEqual([waiting.id]);
  });

  it("stores and sends nothing when the plugin's transaction rolls back", async () => {
    const t = await boot(dialect);
    const failure = new Error("the plugin's own work failed");

    await expect(
      plugin().db.transaction(async tx => {
        await plugin().services.email.queue({ ...message, tx });
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(await queued(t)).toEqual([]);
    expect(await emailJobs(t)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("names a staff user the plugin's own transaction created", async () => {
    // Read in that transaction: on PostgreSQL and MySQL the pool cannot see
    // the user until it commits.
    const t = await boot(dialect);
    const id = "staff-in-transaction";
    const result = await plugin().db.transaction(async tx => {
      await linkedTransaction(tx, "test.user").run(adapterTx =>
        adapterTx.insert("users", {
          id,
          email: "new-staff@example.com",
          name: "New Staff",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
      return plugin().services.email.queue({
        ...message,
        to: "new-staff@example.com",
        person: staffPerson(id),
        tx,
      });
    });

    expect(result.state).toBe("waiting");
    expect(calls).toHaveLength(1);
    expect((await queued(t))[0].state).toBe("sent");
  });

  it("is attempted once the plugin's transaction commits, not before", async () => {
    const t = await boot(dialect);
    let inside: { state: string; calls: number } | undefined;

    await plugin().db.transaction(async tx => {
      const result = await plugin().services.email.queue({ ...message, tx });
      inside = { state: result.state, calls: calls.length };
    });

    expect(inside).toEqual({ state: "waiting", calls: 0 });
    expect(calls).toHaveLength(1);
    const [row] = await queued(t);
    expect(row).toMatchObject({ scope: "plugin:queuer", state: "sent" });
  });

  it("is sent at the next jobs run when it was stored and never attempted", async () => {
    const t = await boot(dialect);
    // As a process that stopped between the commit and the first attempt
    // leaves it: the row and its job, and no attempt.
    await t.adapter.transaction(ctx =>
      storeQueuedEmail(ctx, {
        scope: "site",
        message: { kind: "message", send: message },
        secrets: pluginSettingsSecrets(env),
        dialect: t.adapter.getCapabilities().dialect,
        now: new Date(),
      })
    );
    expect(calls).toEqual([]);

    await trigger(t);
    await trigger(t);

    expect(calls).toHaveLength(1);
    expect((await queued(t))[0].state).toBe("sent");
  });

  it("is failed, not left waiting, when every attempt throws before it can record one", async () => {
    // Here the send service itself cannot be reached, so the attempt throws
    // past its own failure handling, and the job queue alone counts attempts.
    const t = await boot(dialect);
    behaviour.failures = 1;
    const result = await t.nextly.email.queue(message);
    expect(result.state).toBe("waiting");
    const get = container.get.bind(container);
    vi.spyOn(container, "get").mockImplementation(((name: string) => {
      if (name === "emailService") {
        throw new Error("the send service is unavailable");
      }
      return get(name);
    }) as typeof container.get);

    for (let step = 1; step < QUEUED_EMAIL_MAX_ATTEMPTS + 3; step += 1) {
      await trigger(t, later(step));
    }

    const [row] = await queued(t);
    expect(row.state).toBe("failed");
    expect(row.settledAt).toEqual(expect.any(Number));
    const [job] = await emailJobs(t);
    expect(job.state).toBe("failed");
  }, 120_000);

  it("retries a retryable failure with backoff up to the limit, then fails it", async () => {
    const t = await boot(dialect);
    behaviour.failures = Number.MAX_SAFE_INTEGER;

    const result = await t.nextly.email.queue(message);

    expect(result.state).toBe("waiting");
    const [job] = await emailJobs(t);
    // A retry is scheduled by the backoff, not left due at once. (Its time is
    // whole seconds on SQLite, and the first backoff is under one, so it is
    // not compared with the clock.)
    expect(job).toMatchObject({ state: "pending", attemptCount: 1 });
    expect(job.nextAttemptAt).not.toBeNull();
    expect(JSON.parse((await queued(t))[0].failure ?? "null")).toMatchObject({
      retryable: true,
    });

    // Each run comes after the backoff the last attempt scheduled.
    for (let step = 1; step < QUEUED_EMAIL_MAX_ATTEMPTS + 3; step += 1) {
      await trigger(t, later(step));
    }

    expect(calls).toHaveLength(QUEUED_EMAIL_MAX_ATTEMPTS);
    expect((await queued(t))[0].state).toBe("failed");
  }, 120_000);

  it("fails at once, with no other attempt, when the provider refuses it", async () => {
    const t = await boot(dialect);
    behaviour.refusals = 1;

    const result = await t.nextly.email.queue(message);
    await trigger(t, later(1));

    expect(result.state).toBe("failed");
    expect(calls).toHaveLength(1);
    const [row] = await queued(t);
    // As the send describes the provider's refusal, never in its own words.
    expect(JSON.parse(row.failure ?? "null")).toEqual({
      retryable: false,
      status: 422,
      reason: "The email provider refused the message (status 422).",
    });
  });

  it("sends every attempt under one key, so a lost response is delivered once", async () => {
    const t = await boot(dialect);
    behaviour.lostResponses = 1;

    const result = await t.nextly.email.queue(message);
    expect(result.state).toBe("waiting");
    await trigger(t, later(1));

    expect(calls).toHaveLength(2);
    expect(calls[0].idempotencyKey).toEqual(expect.any(String));
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
    expect(delivered.size).toBe(1);
    expect((await queued(t))[0].state).toBe("sent");
  });

  it("renders a template at its attempt, from the template as saved then", async () => {
    const t = await boot(dialect);
    await t.adapter.transaction(ctx =>
      storeQueuedEmail(ctx, {
        scope: "site",
        message: {
          kind: "template",
          slug: "notice",
          to: A,
          variables: {
            who: "Sam",
            note: markHtml("<b>bold</b>"),
            // Shaped as a stored mark would be, and still only text.
            plain: { h: "<i>not trusted</i>" },
          },
          options: {},
        },
        secrets: pluginSettingsSecrets(env),
        dialect: t.adapter.getCapabilities().dialect,
        now: new Date(),
      })
    );
    const template = await t.nextly.emailTemplates.findBySlug({
      slug: "notice",
    });
    await t.nextly.emailTemplates.update({
      id: template!.id,
      data: { subject: "Fixed for {{ who }}" },
    } as never);

    await trigger(t);

    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toBe("Fixed for Sam");
    expect(calls[0].html).toContain("<b>bold</b>");
    expect(calls[0].html).not.toContain("<i>");
  });

  it("fails as refused when its template changed after an attempt the provider may have taken", async () => {
    // The key went out with the first message, so another message under it
    // is refused rather than sent.
    const t = await boot(dialect);
    behaviour.failures = 1;
    const result = await t.nextly.email.queueWithTemplate({
      template: "notice",
      to: A,
      variables: { who: "Sam", note: "n", plain: "p" },
    });
    expect(result.state).toBe("waiting");
    const template = await t.nextly.emailTemplates.findBySlug({
      slug: "notice",
    });
    await t.nextly.emailTemplates.update({
      id: template!.id,
      data: { subject: "Changed" },
    } as never);

    await trigger(t, later(1));

    expect(calls).toHaveLength(1);
    const [row] = await queued(t);
    expect(row.state).toBe("failed");
    expect(JSON.parse(row.failure ?? "null")).toMatchObject({
      retryable: false,
      status: 409,
    });
  });

  it("warns, on a queued send and at startup, when one is more than 15 minutes past due", async () => {
    const t = await boot(dialect);
    behaviour.failures = Number.MAX_SAFE_INTEGER;
    await t.nextly.email.queue(message);
    // Its retry is due in a moment, so nothing is late yet.
    expect(warnings.filter(w => /past due/.test(w))).toEqual([]);

    // The trigger never ran: the retry is now well past its due time.
    const [job] = await emailJobs(t);
    await t.adapter.update(
      "nextly_jobs",
      {
        // Created an hour ago, as a job retried this late was.
        createdAt: new Date(Date.now() - 60 * 60_000),
        nextAttemptAt: new Date(Date.now() - LATE_QUEUED_EMAIL_MS - 60_000),
      },
      { and: [{ column: "id", op: "=", value: job.id }] }
    );

    await t.nextly.email.queue(message);
    await runPostInitTasks();

    const late = warnings.filter(w => /past due/.test(w));
    expect(late).toHaveLength(2);
    expect(late[0]).toMatch(/^1 queued email is more than 15 minutes past due/);
    expect(late[0]).toContain("/api/jobs/run");
  }, 60_000);

  it("does not warn about one just stored whose first attempt has not run", async () => {
    // A job with no attempt yet has no due time of its own: it is late only
    // once it was created long enough ago.
    const t = await boot(dialect);
    await t.adapter.transaction(ctx =>
      storeQueuedEmail(ctx, {
        scope: "site",
        message: { kind: "message", send: message },
        secrets: pluginSettingsSecrets(env),
        dialect: t.adapter.getCapabilities().dialect,
        now: new Date(),
      })
    );

    await warnAboutLateQueuedEmail(t.adapter, logger);
    expect(warnings.filter(w => /past due/.test(w))).toEqual([]);

    await warnAboutLateQueuedEmail(
      t.adapter,
      logger,
      new Date(Date.now() + LATE_QUEUED_EMAIL_MS + 60_000)
    );
    expect(warnings.filter(w => /past due/.test(w))).toHaveLength(1);
  });

  it("does not warn about one less than 15 minutes past due", async () => {
    const t = await boot(dialect);
    behaviour.failures = Number.MAX_SAFE_INTEGER;
    await t.nextly.email.queue(message);
    const [job] = await emailJobs(t);
    await t.adapter.update(
      "nextly_jobs",
      {
        // Created an hour ago, as a job retried this late was.
        createdAt: new Date(Date.now() - 60 * 60_000),
        nextAttemptAt: new Date(Date.now() - LATE_QUEUED_EMAIL_MS + 60_000),
      },
      { and: [{ column: "id", op: "=", value: job.id }] }
    );

    await t.nextly.email.queue(message);

    expect(warnings.filter(w => /past due/.test(w))).toEqual([]);
  });
});
