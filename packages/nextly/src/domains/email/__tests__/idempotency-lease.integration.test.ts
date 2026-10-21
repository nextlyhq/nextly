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
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const KEY = "order-1:confirmation";

const calls: SentOptions[] = [];
/** Calls wait on this while it is set; `release` lets them answer. */
const hold: { until?: Promise<void>; release?: () => void } = {};

let current: TestNextly | undefined;

afterEach(async () => {
  hold.release?.();
  await current?.destroy();
  current = undefined;
  calls.length = 0;
  hold.until = undefined;
  hold.release = undefined;
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
            if (waiting) await waiting;
            return { success: true, messageId: `slow-${calls.length}` };
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
  return t;
}

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
