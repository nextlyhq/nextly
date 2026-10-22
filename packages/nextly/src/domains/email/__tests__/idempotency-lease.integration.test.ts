/**
 * A keyed send whose provider call outlives its deadline, on every configured
 * dialect, with the deadline, lease and limit shortened to milliseconds.
 *
 * The caller hears at the deadline that the call has no answer yet, and the
 * adapter is told to stop. While the call is unsettled the claim is renewed,
 * so a later send with the key is told the send is in progress, past the
 * takeover period too; when the call answers, the claim records it. A call
 * that never answers is let go at the lease limit, and a later send takes the
 * claim over with the same provider key.
 *
 * @module domains/email/__tests__/idempotency-lease.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../send-timing", () => ({
  CALL_DEADLINE_MS: 150,
  LEASE_LIMIT_MS: 1_500,
  LEASE_RENEWAL_MS: 100,
  CLAIM_TAKEOVER_MS: 400,
}));

import { container } from "../../../di/container";
import {
  FilterSeams,
  getFilterRegistry,
  resetFilterRegistry,
} from "../../../filters";
import type { EmailAfterSendValue } from "../../../filters/seams";
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
import { withEmailFailure } from "../failure";
import { defineEmailProvider } from "../provider-definition";
import type { EmailDeliveryService } from "../services/email-delivery-service";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const B = "b@example.com";
const KEY = "order-1:confirmation";

const calls: SentOptions[] = [];
/**
 * Calls wait on this while it is set; `release` lets them answer. With `only`,
 * only the call to that address waits.
 */
const hold: { until?: Promise<void>; release?: () => void; only?: string } = {};

let current: TestNextly | undefined;

afterEach(async () => {
  hold.release?.();
  await current?.destroy();
  current = undefined;
  calls.length = 0;
  hold.until = undefined;
  hold.release = undefined;
  hold.only = undefined;
  resetFilterRegistry();
});

function holdCalls(): void {
  hold.until = new Promise(resolve => (hold.release = resolve));
}

const slowMailer = definePlugin({
  name: "slow-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<Record<string, never>>({
        type: "slow-keyed",
        label: "Slow",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          acceptsIdempotencyKey: true,
          // Ignores its cancellation signal, as a careless adapter would.
          send: async (options: SentOptions) => {
            calls.push(options);
            const waiting = hold.until;
            if (waiting && (!hold.only || hold.only === options.to)) {
              await waiting;
            }
            return { success: true, messageId: `slow-${calls.length}` };
          },
        }),
      }),
      defineEmailProvider<Record<string, never>>({
        type: "stopping-keyless",
        label: "Stopping",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          // Takes no key, and stops when told: its request may still be
          // processing at the provider, so it reports the answer as lost.
          send: (options: SentOptions) => {
            calls.push(options);
            return new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () =>
                reject(
                  withEmailFailure(new Error("stopped"), {
                    retryable: true,
                    unknown: true,
                    reason: "The email provider's answer was lost.",
                  })
                )
              );
            });
          },
        }),
      }),
    ],
  },
  init(_context: PluginContext) {},
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({ dialect, plugins: [slowMailer] });
  current = t;
  await t.nextly.emailProviders.create({
    data: {
      name: "Slow",
      type: "slow-keyed",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  const stopping = await t.nextly.emailProviders.create({
    data: {
      name: "Stopping",
      type: "stopping-keyless",
      fromEmail: "provider@example.com",
      configuration: {},
    },
  });
  stoppingProvider = stopping.item.id;
  return t;
}

let stoppingProvider = "";

const keyed = {
  to: [A],
  subject: "Hi",
  html: "<p>x</p>",
  idempotencyKey: KEY,
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.each(getConfiguredTestDialects())(
  "a keyed send whose call outlives its deadline (%s)",
  dialect => {
    it("reports no answer at the deadline, tells the adapter to stop, and sends nothing again while the call lives", async () => {
      const t = await boot(dialect);
      holdCalls();

      const first = await t.nextly.email.send(keyed);
      expect(first).toMatchObject({
        success: false,
        failure: {
          retryable: true,
          unknown: true,
          reason: "The email provider did not answer in time.",
        },
      });
      expect(calls[0].signal?.aborted).toBe(true);

      // Well past the takeover period: the live call's claim is renewed.
      await wait(800);
      await expect(t.nextly.email.send(keyed)).resolves.toMatchObject({
        success: false,
        failure: { retryable: true },
      });
      expect(calls).toHaveLength(1);

      // The call answers after all: the claim records it, and a repeat
      // returns its result.
      hold.release?.();
      await wait(300);
      await expect(t.nextly.email.send(keyed)).resolves.toMatchObject({
        success: true,
        messageId: "slow-1",
        repeat: true,
      });
      expect(calls).toHaveLength(1);
    }, 120_000);

    it("commits a definite outcome with its delivery records, or neither, and a retry completes both", async () => {
      const t = await boot(dialect);
      const deliveries = container.get<EmailDeliveryService>(
        "emailDeliveryService"
      );
      const settle = deliveries.settleWithin.bind(deliveries);
      // The process stops after the provider answered, before the commit.
      deliveries.settleWithin = async () => {
        deliveries.settleWithin = settle;
        throw new Error("stopped before the commit");
      };

      const first = await t.nextly.email.send(keyed);
      expect(first).toMatchObject({ success: true });
      expect(await t.adapter.select("email_deliveries")).toEqual([]);
      expect(await t.adapter.select("email_send_claims")).toEqual([
        expect.objectContaining({ state: "claimed" }),
      ]);

      // Its lease lapses; the retry takes the claim over and completes both.
      await wait(500);
      const retried = await t.nextly.email.send(keyed);

      expect(retried).toMatchObject({ success: true });
      expect(calls).toHaveLength(2);
      expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
      expect(await t.adapter.select("email_deliveries")).toHaveLength(1);
      expect(await t.adapter.select("email_send_claims")).toEqual([
        expect.objectContaining({ state: "sent" }),
      ]);
    }, 120_000);

    it("runs a keyed send's after-send actions only once its outcome is committed", async () => {
      const t = await boot(dialect);
      const seen: string[] = [];
      getFilterRegistry().addAction(FilterSeams.EmailAfterSend, async () => {
        const [claim] = await t.adapter.select<{ state: string }>(
          "email_send_claims"
        );
        seen.push(claim?.state ?? "none");
      });

      await t.nextly.email.send(keyed);

      expect(seen).toEqual(["sent"]);
    }, 120_000);

    it("runs no after-send action for a keyed send whose commit failed, and runs it once on the retry", async () => {
      const t = await boot(dialect);
      const actions: unknown[] = [];
      getFilterRegistry().addAction(FilterSeams.EmailAfterSend, value => {
        actions.push((value as EmailAfterSendValue).to);
      });
      const deliveries = container.get<EmailDeliveryService>(
        "emailDeliveryService"
      );
      const settle = deliveries.settleWithin.bind(deliveries);
      deliveries.settleWithin = async () => {
        deliveries.settleWithin = settle;
        throw new Error("stopped before the commit");
      };

      await t.nextly.email.send(keyed);
      expect(actions).toEqual([]);

      await wait(500);
      await t.nextly.email.send(keyed);
      expect(actions).toEqual([A]);
    }, 120_000);

    it("commits nothing and runs no action for a late call whose claim another send took over", async () => {
      const t = await boot(dialect);
      const actions: unknown[] = [];
      getFilterRegistry().addAction(FilterSeams.EmailAfterSend, value => {
        actions.push((value as EmailAfterSendValue).to);
      });
      holdCalls();

      await t.nextly.email.send(keyed);
      // As a send that took the claim over while this call was still out
      // leaves it: that send owns the outcome now.
      await t.adapter.update(
        "email_send_claims",
        { holder: "another-send" },
        { and: [{ column: "state", op: "=", value: "claimed" }] }
      );
      hold.release?.();
      await wait(300);

      expect(actions).toEqual([]);
      expect(await t.adapter.select("email_deliveries")).toEqual([]);
      expect(await t.adapter.select("email_send_claims")).toEqual([
        expect.objectContaining({ holder: "another-send", state: "claimed" }),
      ]);
    }, 120_000);

    it("runs the after-send action of a split send's call that answers late", async () => {
      const t = await boot(dialect);
      const actions: unknown[] = [];
      getFilterRegistry().addAction(FilterSeams.EmailAfterSend, value => {
        actions.push((value as EmailAfterSendValue).to);
      });
      holdCalls();
      hold.only = B;

      await t.nextly.email.send({ ...keyed, to: [A, B] });
      // A keyed send's actions wait for its commit, after the late call.
      expect(actions).toEqual([]);
      hold.release?.();
      await wait(300);

      expect(actions).toEqual([A, B]);
    }, 120_000);

    it("holds the claim of a call its adapter stopped, as unknown, to the lease limit", async () => {
      const t = await boot(dialect);
      const send = () =>
        t.nextly.email.send({ ...keyed, providerId: stoppingProvider });

      const first = await send();
      expect(first).toMatchObject({ failure: { unknown: true } });
      // Past the takeover period, before the lease limit: still held.
      await wait(800);
      await expect(send()).resolves.toMatchObject({
        success: false,
        failure: { retryable: true },
      });
      expect(calls).toHaveLength(1);
    }, 120_000);

    it("lets a later send take over a call that never answers, after the lease limit, with the same provider key", async () => {
      const t = await boot(dialect);
      holdCalls();

      await t.nextly.email.send(keyed);
      await wait(1_900);
      // The held call never answers; this one does.
      hold.until = undefined;
      const taken = await t.nextly.email.send(keyed);

      expect(taken).toMatchObject({ success: true });
      expect(calls).toHaveLength(2);
      expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
    }, 120_000);
  }
);
