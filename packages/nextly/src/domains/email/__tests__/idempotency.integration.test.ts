/**
 * A send with an idempotency key goes out once, on every configured dialect.
 *
 * Every public surface repeats a keyed send and sees one provider call; a
 * provider that takes a key is handed one derived from the caller's; a failed
 * first send is retried; a different message under the key is refused; two
 * sends at once reach the provider once; keys from two callers never meet;
 * and what is stored names nobody.
 *
 * @module domains/email/__tests__/idempotency.integration.test
 */

// Read through the env proxy by the digests: set before it is imported. A
// throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetEnvCache } from "../../../lib/env";
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
import { recipientDigest } from "../delivery-record";
import { defineEmailProvider } from "../provider-definition";
import { pruneEmailDataSafely, pruneSendClaims } from "../prune";
import { resolveEmailRetentionConfig } from "../retention-config";
import { CLAIM_TAKEOVER_MS } from "../send-claims";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const B = "b@example.com";
/** A key built from an address, as a caller's often is. */
const KEY = `order-1:${A}:confirmation`;

/** Every message a capturing provider was handed, in order. */
const messages: Array<{ provider: string; options: SentOptions }> = [];

/** What the next provider calls do: fail a number of times, or wait. */
const behaviour: {
  failures: number;
  gate?: Promise<void>;
  /** Fail only the call to this `to` address, while `failures` lasts. */
  failFor?: string;
  /** A copied address every call refuses, as an SMTP server would. */
  refuse?: string;
} = { failures: 0 };

const contexts: Record<string, PluginContext> = {};
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  messages.length = 0;
  behaviour.failures = 0;
  behaviour.gate = undefined;
  behaviour.failFor = undefined;
  behaviour.refuse = undefined;
});

/** A provider that records what it is handed, and accepts it unless told. */
function capturing(
  type: string,
  acceptsIdempotencyKey: boolean,
  maxToPerMessage = 10
) {
  return defineEmailProvider<Record<string, never>>({
    type,
    label: type,
    configFields: [],
    parseConfig: () => ({}),
    createAdapter: () => ({
      maxToPerMessage,
      ...(acceptsIdempotencyKey ? { acceptsIdempotencyKey } : {}),
      send: async (options: SentOptions) => {
        messages.push({ provider: type, options });
        if (behaviour.gate) await behaviour.gate;
        const failsThis =
          behaviour.failFor === undefined || behaviour.failFor === options.to;
        if (behaviour.failures > 0 && failsThis) {
          behaviour.failures -= 1;
          throw new Error("provider down");
        }
        const refused = [
          ...(options.toList ?? []),
          ...(options.cc ?? []),
          ...(options.bcc ?? []),
        ].filter(address => address === behaviour.refuse);
        return {
          success: true,
          messageId: `captured-${messages.length}`,
          ...(refused.length > 0
            ? {
                rejected: refused,
                refusals: refused.map(address => ({
                  address,
                  retryable: false,
                  status: 550,
                })),
              }
            : {}),
        };
      },
    }),
  });
}

function mailerPlugin(name: string, providers: ReturnType<typeof capturing>[]) {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { emailProviders: providers },
    init(context: PluginContext) {
      contexts[name] = context;
    },
  } as never);
}

async function boot(dialect: TestDialect): Promise<{
  t: TestNextly;
  keyless: string;
  oneAtATime: string;
  keyedOneAtATime: string;
}> {
  const t = await createTestNextly({
    dialect,
    plugins: [
      mailerPlugin("mailer", [
        capturing("capturing-keyed", true),
        capturing("capturing-keyless", false),
        // One `to` per message, so a send to two people is two calls.
        capturing("capturing-one", false, 1),
        // Takes a key and one `to` per message.
        capturing("capturing-keyed-one", true, 1),
      ]),
      mailerPlugin("other-mailer", []),
    ],
  });
  current = t;
  await t.nextly.emailProviders.create({
    data: {
      name: "Keyed",
      type: "capturing-keyed",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  const keyless = await t.nextly.emailProviders.create({
    data: {
      name: "Keyless",
      type: "capturing-keyless",
      fromEmail: "provider@example.com",
      configuration: {},
    },
  });
  await t.nextly.emailTemplates.create({
    data: {
      name: "Alert",
      slug: "alert",
      subject: "Alert",
      htmlContent: "<p>alert</p>",
      isActive: true,
    },
  });
  const one = await t.nextly.emailProviders.create({
    data: {
      name: "One",
      type: "capturing-one",
      fromEmail: "provider@example.com",
      configuration: {},
    },
  });
  const keyedOne = await t.nextly.emailProviders.create({
    data: {
      name: "Keyed one",
      type: "capturing-keyed-one",
      fromEmail: "provider@example.com",
      configuration: {},
    },
  });
  return {
    t,
    keyless: keyless.item.id,
    oneAtATime: one.item.id,
    keyedOneAtATime: keyedOne.item.id,
  };
}

function plugin(name = "mailer"): PluginContext {
  const context = contexts[name];
  if (!context) throw new Error(`${name} did not initialise`);
  return context;
}

interface Keyed {
  to: string[];
  idempotencyKey: string;
  subject?: string;
  providerId?: string;
}

/** One keyed send per surface, each the code a caller of it would write. */
function surfaces(
  t: TestNextly
): Record<string, (e: Keyed) => Promise<Record<string, unknown>>> {
  const raw = (e: Keyed) => ({
    ...e,
    subject: e.subject ?? "Hi",
    html: "<p>x</p>",
  });
  return {
    "nextly.email.send": async e =>
      ({ ...(await t.nextly.email.send(raw(e))) }) as Record<string, unknown>,
    "nextly.email.sendWithTemplate": async ({ subject: _s, ...e }) =>
      ({
        ...(await t.nextly.email.sendWithTemplate({ ...e, template: "alert" })),
      }) as Record<string, unknown>,
    "ctx.services.email.send": async e =>
      ({ ...(await plugin().services.email.send(raw(e))) }) as Record<
        string,
        unknown
      >,
    "ctx.services.email.sendWithTemplate": async ({
      to,
      subject: _s,
      ...options
    }) =>
      ({
        ...(await plugin().services.email.sendWithTemplate(
          "alert",
          to,
          {},
          options
        )),
      }) as Record<string, unknown>,
  };
}

const SURFACES = Object.keys(
  surfaces({} as TestNextly)
) as ReadonlyArray<string>;

interface ClaimRow {
  scope: string;
  keyDigest: string;
  messageDigest: string;
  state: string;
  result: string | null;
  leaseExpiresAt: number;
  settledAt: number | null;
}

interface DeliveryRow {
  recipientHash: string;
  keyDigest: string | null;
}

describe.each(getConfiguredTestDialects())(
  "a keyed send goes out once (%s)",
  dialect => {
    it.each(SURFACES)(
      "%s returns the first result for a repeat, without sending",
      async surface => {
        const { t } = await boot(dialect);
        const send = surfaces(t)[surface];

        const first = await send({ to: [A], idempotencyKey: KEY });
        const second = await send({ to: [A], idempotencyKey: KEY });

        expect(messages).toHaveLength(1);
        expect(first).toMatchObject({ success: true, messageId: "captured-1" });
        expect(first.repeat).toBeUndefined();
        expect(second).toMatchObject({
          success: true,
          messageId: "captured-1",
          repeat: true,
        });
      },
      120_000
    );

    it("hands a provider that takes a key one derived from the caller's, never the key itself", async () => {
      const { t, keyless } = await boot(dialect);

      await t.nextly.email.send({
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      });
      await t.nextly.email.send({
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: "another-key",
        providerId: keyless,
      });
      await t.nextly.email.send({ to: [A], subject: "Hi", html: "<p>x</p>" });

      const [keyed, keylessCall, unkeyed] = messages.map(m => m.options);
      expect(keyed.idempotencyKey).toMatch(/^nextly-[0-9a-f]{64}$/);
      expect(keyed.idempotencyKey).not.toContain(A);
      expect("idempotencyKey" in keylessCall).toBe(false);
      expect("idempotencyKey" in unkeyed).toBe(false);
    }, 120_000);

    it("lets a send whose first attempt failed try again, with the same provider key", async () => {
      const { t } = await boot(dialect);
      behaviour.failures = 1;
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      const failed = await t.nextly.email.send(keyed);
      const retried = await t.nextly.email.send(keyed);
      const repeated = await t.nextly.email.send(keyed);

      expect(failed).toMatchObject({ success: false });
      expect(retried).toMatchObject({ success: true, messageId: "captured-2" });
      expect(retried.repeat).toBeUndefined();
      expect(repeated).toMatchObject({ success: true, repeat: true });
      expect(messages).toHaveLength(2);
      expect(messages[1].options.idempotencyKey).toBe(
        messages[0].options.idempotencyKey
      );
    }, 120_000);

    it("sends a retry of a split send only to the calls not yet accepted, and keeps the claim meanwhile", async () => {
      const { t, oneAtATime } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;
      const keyed = {
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: oneAtATime,
      };

      const partly = await t.nextly.email.send(keyed);
      // A takeover period later the claim still records the accepted call.
      await pruneSendClaims(
        t.adapter as never,
        90 * 24 * 60 * 60 * 1000,
        new Date(Date.now() + CLAIM_TAKEOVER_MS + 1000)
      );
      const retried = await t.nextly.email.send(keyed);
      const repeated = await t.nextly.email.send(keyed);

      expect(partly).toMatchObject({ success: false });
      expect(retried).toMatchObject({ success: true });
      expect(repeated).toMatchObject({ repeat: true });
      // A once, B twice: the retry went to B alone.
      expect(messages.map(m => m.options.to)).toEqual([A, B, B]);
    }, 120_000);

    it("keeps the accepted calls of a partly delivered send whose retry stopped", async () => {
      const { t, oneAtATime } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;
      const keyed = {
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: oneAtATime,
      };
      await t.nextly.email.send(keyed);
      // As a retry that took the claim over and then stopped leaves it.
      await t.adapter.update(
        "email_send_claims",
        { state: "claimed", leaseExpiresAt: 0 },
        { and: [{ column: "state", op: "=", value: "partial" }] }
      );

      await pruneSendClaims(
        t.adapter as never,
        90 * 24 * 60 * 60 * 1000,
        new Date(Date.now() + CLAIM_TAKEOVER_MS + 1000)
      );
      await t.nextly.email.send(keyed);

      expect(messages.map(m => m.options.to)).toEqual([A, B, B]);
    }, 120_000);

    it("reports a partly delivered send recipient by recipient, and an all-accepted one as before", async () => {
      const { t, oneAtATime } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;

      const partly = await t.nextly.email.send({
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: oneAtATime,
      });
      const whole = await t.nextly.email.send({
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: "another-key",
        providerId: oneAtATime,
      });

      expect(partly).toMatchObject({
        success: false,
        partlyDelivered: true,
        recipients: [
          { kind: "to", position: 0, outcome: "accepted" },
          // A plain error is a failed call, not a lost answer.
          { kind: "to", position: 1, outcome: "refused", retryable: true },
        ],
      });
      // Exactly as a send of two was before: nothing added.
      expect(whole).toEqual({ success: true, messageId: "captured-3" });
    }, 120_000);

    it("retries through a provider that groups recipients differently, only to those not yet accepted", async () => {
      const { t, oneAtATime, keyless } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;
      const keyed = {
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      await t.nextly.email.send({ ...keyed, providerId: oneAtATime });
      const retried = await t.nextly.email.send({
        ...keyed,
        providerId: keyless,
      });

      expect(retried).toEqual({ success: true, messageId: "captured-3" });
      // A once through the first provider; B again through the batching one.
      expect(
        messages.map(m => [m.provider, m.options.toList ?? [m.options.to]])
      ).toEqual([
        ["capturing-one", [A]],
        ["capturing-one", [B]],
        ["capturing-keyless", [B]],
      ]);
    }, 120_000);

    it("keeps a refused copy's outcome on a keyed retry, at its place in the send", async () => {
      const { t, oneAtATime } = await boot(dialect);
      const C = "c@example.com";
      behaviour.failures = 1;
      behaviour.failFor = B;
      behaviour.refuse = C;
      const keyed = {
        to: [A, B],
        cc: [C],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: oneAtATime,
      };

      await t.nextly.email.send(keyed);
      const retried = await t.nextly.email.send(keyed);

      expect(retried).toMatchObject({
        success: true,
        refused: [{ kind: "cc", position: 0, retryable: false, status: 550 }],
      });
    }, 120_000);

    it("honours a partly delivered claim that recorded its accepted calls, as claims did before", async () => {
      const { t, keyedOneAtATime } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;
      const keyed = {
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: keyedOneAtATime,
      };
      await t.nextly.email.send(keyed);
      // As an earlier version wrote it: the call to A, by its provider key.
      await t.adapter.update(
        "email_send_claims",
        {
          result: JSON.stringify({
            acceptedLegs: [messages[0].options.idempotencyKey],
          }),
        },
        { and: [{ column: "state", op: "=", value: "partial" }] }
      );

      await t.nextly.email.send(keyed);

      expect(messages.map(m => m.options.to)).toEqual([A, B, B]);
    }, 120_000);

    it("writes a partly delivered claim's accepted calls too, for an instance of the earlier version", async () => {
      const { t, keyedOneAtATime } = await boot(dialect);
      behaviour.failures = 1;
      behaviour.failFor = B;

      await t.nextly.email.send({
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
        providerId: keyedOneAtATime,
      });

      const [claim] = await t.adapter.select<{ result: string }>(
        "email_send_claims"
      );
      expect(JSON.parse(claim.result)).toEqual({
        accepted: ["to:0"],
        acceptedLegs: [messages[0].options.idempotencyKey],
      });
    }, 120_000);

    it("writes a call that took some of its recipients as accepted, so an instance of the earlier version never sends it again", async () => {
      const { t } = await boot(dialect);
      // One call to both, which takes A and refuses B: the send is partly
      // delivered within the call. The earlier version knows calls only, so
      // the call is recorded as accepted: B is not retried there, and A is
      // never sent twice.
      behaviour.refuse = B;

      await t.nextly.email.send({
        to: [A, B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      });

      expect(messages).toHaveLength(1);
      const [claim] = await t.adapter.select<{ state: string; result: string }>(
        "email_send_claims"
      );
      expect(claim.state).toBe("partial");
      expect(JSON.parse(claim.result)).toEqual({
        accepted: ["to:0"],
        acceptedLegs: [messages[0].options.idempotencyKey],
      });
    }, 120_000);

    it("refuses the key with a different message, through the Direct API", async () => {
      const { t } = await boot(dialect);
      await t.nextly.email.send({
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      });

      await expect(
        t.nextly.email.send({
          to: [A, B],
          subject: "Hi",
          html: "<p>x</p>",
          idempotencyKey: KEY,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(messages).toHaveLength(1);
    }, 120_000);

    it("refuses the key once the template it rendered has been edited", async () => {
      const { t } = await boot(dialect);
      const send = () =>
        t.nextly.email.sendWithTemplate({
          to: [A],
          template: "alert",
          idempotencyKey: KEY,
        });
      await send();
      const template = await t.nextly.emailTemplates.findBySlug({
        slug: "alert",
      });
      await t.nextly.emailTemplates.update({
        id: template!.id,
        data: { htmlContent: "<p>edited</p>" },
      } as never);

      await expect(send()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(messages).toHaveLength(1);
    }, 120_000);

    it("lets exactly one of two sends at once reach the provider; the other reports it in progress", async () => {
      const { t } = await boot(dialect);
      let release!: () => void;
      behaviour.gate = new Promise(resolve => (release = resolve));
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      const first = t.nextly.email.send(keyed);
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      const second = await t.nextly.email.send(keyed);
      release();

      expect(second).toMatchObject({
        success: false,
        failure: { retryable: true },
      });
      await expect(first).resolves.toMatchObject({ success: true });
      await expect(t.nextly.email.send(keyed)).resolves.toMatchObject({
        repeat: true,
      });
      expect(messages).toHaveLength(1);
    }, 120_000);

    it("sends once when several sends with one key race", async () => {
      const { t } = await boot(dialect);
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => t.nextly.email.send(keyed))
      );

      expect(messages).toHaveLength(1);
      expect(results.filter(r => r.success && !r.repeat)).toHaveLength(1);
      for (const result of results) {
        expect(result.success || result.failure?.retryable).toBe(true);
      }
    }, 120_000);

    it("keeps keys from two plugins, and from a plugin and the site, apart", async () => {
      const { t } = await boot(dialect);
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      await plugin("mailer").services.email.send(keyed);
      await plugin("other-mailer").services.email.send(keyed);
      await t.nextly.email.send(keyed);
      const repeat = await plugin("other-mailer").services.email.send(keyed);

      expect(messages).toHaveLength(3);
      expect(repeat).toMatchObject({ repeat: true });
      const scopes = (
        await t.adapter.select<ClaimRow>("email_send_claims")
      ).map(row => row.scope);
      expect(scopes.sort()).toEqual(
        ["plugin:mailer", "plugin:other-mailer", "site"].sort()
      );
    }, 120_000);

    it("stores keyed digests only, the same key digest on every record of the send", async () => {
      const { t } = await boot(dialect);

      await t.nextly.email.send({
        to: [A],
        cc: [B],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      });

      const [claim] = await t.adapter.select<ClaimRow>("email_send_claims");
      const rows = await t.adapter.select<DeliveryRow>("email_deliveries");
      expect(claim).toMatchObject({ scope: "site", state: "sent" });
      expect(claim.keyDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(claim.messageDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(rows.map(row => row.keyDigest)).toEqual([
        claim.keyDigest,
        claim.keyDigest,
      ]);
      const stored = JSON.stringify([claim, rows]);
      for (const secret of [KEY, A, B, "order-1"]) {
        expect(stored).not.toContain(secret);
      }
    }, 120_000);

    it("recognises a key sent before the install's secret was rotated", async () => {
      const { t } = await boot(dialect);
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };
      const before = {
        current: process.env.NEXTLY_SECRET,
        previous: process.env.NEXTLY_SECRET_PREVIOUS,
      };
      await t.nextly.email.send(keyed);

      try {
        process.env.NEXTLY_SECRET_PREVIOUS = before.current;
        process.env.NEXTLY_SECRET =
          "a-rotated-secret-that-is-at-least-32-characters";
        _resetEnvCache();

        await expect(t.nextly.email.send(keyed)).resolves.toMatchObject({
          repeat: true,
        });
        expect(messages).toHaveLength(1);
      } finally {
        process.env.NEXTLY_SECRET = before.current;
        if (before.previous === undefined) {
          delete process.env.NEXTLY_SECRET_PREVIOUS;
        } else {
          process.env.NEXTLY_SECRET_PREVIOUS = before.previous;
        }
        _resetEnvCache();
      }
    }, 120_000);

    it("lets a later send take over a claim whose lease lapsed, with the same provider key", async () => {
      const { t } = await boot(dialect);
      let release!: () => void;
      behaviour.gate = new Promise(resolve => (release = resolve));
      const keyed = {
        to: [A],
        subject: "Hi",
        html: "<p>x</p>",
        idempotencyKey: KEY,
      };

      const stalled = t.nextly.email.send(keyed);
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      // As if the stalled send's process had stopped holding it.
      await t.adapter.update(
        "email_send_claims",
        { leaseExpiresAt: 0 },
        { and: [{ column: "state", op: "=", value: "claimed" }] }
      );
      const taken = t.nextly.email.send(keyed);
      await vi.waitFor(() => expect(messages).toHaveLength(2));
      release();

      await expect(taken).resolves.toMatchObject({ success: true });
      await expect(stalled).resolves.toMatchObject({ success: true });
      await expect(t.nextly.email.send(keyed)).resolves.toMatchObject({
        repeat: true,
      });
      expect(messages).toHaveLength(2);
      expect(messages[1].options.idempotencyKey).toBe(
        messages[0].options.idempotencyKey
      );
    }, 120_000);

    it("prunes a claim once its lifetime has passed", async () => {
      const { t } = await boot(dialect);
      behaviour.failures = 1;
      await t.nextly.email.send({
        to: [A],
        subject: "Failed",
        html: "<p>x</p>",
        idempotencyKey: "failed",
      });
      await t.nextly.email.send({
        to: [A],
        subject: "Sent",
        html: "<p>x</p>",
        idempotencyKey: "sent",
      });
      const day = 24 * 60 * 60 * 1000;
      const states = async () =>
        (await t.adapter.select<ClaimRow>("email_send_claims"))
          .map(row => row.state)
          .sort();

      const at = (offset: number) => new Date(Date.now() + offset);
      const adapter = t.adapter as never;

      await pruneSendClaims(adapter, 90 * day, at(0));
      expect(await states()).toEqual(["failed", "sent"]);
      await pruneSendClaims(adapter, 90 * day, at(CLAIM_TAKEOVER_MS + 1000));
      expect(await states()).toEqual(["sent"]);
      await pruneSendClaims(adapter, false, at(91 * day));
      expect(await states()).toEqual(["sent"]);
      await pruneSendClaims(adapter, 90 * day, at(91 * day));
      expect(await states()).toEqual([]);
    }, 120_000);

    it("prunes claims from the retention pass, whether or not keyed sends continue", async () => {
      const { t } = await boot(dialect);
      await t.nextly.email.send({
        to: [A],
        subject: "Sent",
        html: "<p>x</p>",
        idempotencyKey: "sent",
      });

      await pruneEmailDataSafely(
        {
          adapter: t.adapter as never,
          now: () => new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
        },
        resolveEmailRetentionConfig({ maxAgeMs: 30 * 24 * 60 * 60 * 1000 })
      );

      expect(await t.adapter.select("email_send_claims")).toEqual([]);
    }, 120_000);

    it("records a send without a key exactly as before", async () => {
      const { t } = await boot(dialect);

      await t.nextly.email.send({ to: [A], subject: "Hi", html: "<p>x</p>" });
      await t.nextly.email.send({ to: [A], subject: "Hi", html: "<p>x</p>" });

      expect(messages).toHaveLength(2);
      expect(await t.adapter.select("email_send_claims")).toEqual([]);
      const rows = await t.adapter.select<DeliveryRow>("email_deliveries");
      expect(rows.map(row => [row.recipientHash, row.keyDigest])).toEqual([
        [recipientDigest(A), null],
        [recipientDigest(A), null],
      ]);
    }, 120_000);
  }
);
