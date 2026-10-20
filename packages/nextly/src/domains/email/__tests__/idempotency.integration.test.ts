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

vi.mock("../../../auth/middleware", async importActual => {
  const actual =
    await importActual<typeof import("../../../auth/middleware")>();
  return {
    ...actual,
    requireAuthentication: vi.fn(async () => ({
      userId: "u1",
      userEmail: "u@x.test",
      userName: "U",
      authMethod: "session" as const,
      permissions: [] as string[],
      claims: {},
    })),
  };
});
vi.mock("../../../init", async importActual => {
  const actual = await importActual<typeof import("../../../init")>();
  return { ...actual, getCachedNextly: vi.fn(async () => undefined) };
});

import { POST as postSend } from "../../../api/email-send";
import { POST as postSendTemplate } from "../../../api/email-send-template";
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
import { CLAIM_TAKEOVER_MS, sweepSendClaims } from "../send-claims";
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const B = "b@example.com";
/** A key built from an address, as a caller's often is. */
const KEY = `order-1:${A}:confirmation`;

/** Every message a capturing provider was handed, in order. */
const messages: Array<{ provider: string; options: SentOptions }> = [];

/** What the next provider calls do: fail a number of times, or wait. */
const behaviour: { failures: number; gate?: Promise<void> } = { failures: 0 };

const contexts: Record<string, PluginContext> = {};
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  messages.length = 0;
  behaviour.failures = 0;
  behaviour.gate = undefined;
});

/** A provider that records what it is handed, and accepts it unless told. */
function capturing(type: string, acceptsIdempotencyKey: boolean) {
  return defineEmailProvider<Record<string, never>>({
    type,
    label: type,
    configFields: [],
    parseConfig: () => ({}),
    createAdapter: () => ({
      maxToPerMessage: 10,
      ...(acceptsIdempotencyKey ? { acceptsIdempotencyKey } : {}),
      send: async (options: SentOptions) => {
        messages.push({ provider: type, options });
        if (behaviour.gate) await behaviour.gate;
        if (behaviour.failures > 0) {
          behaviour.failures -= 1;
          throw new Error("provider down");
        }
        return { success: true, messageId: `captured-${messages.length}` };
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
}> {
  const t = await createTestNextly({
    dialect,
    plugins: [
      mailerPlugin("mailer", [
        capturing("capturing-keyed", true),
        capturing("capturing-keyless", false),
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
  return { t, keyless: keyless.item.id };
}

function plugin(name = "mailer"): PluginContext {
  const context = contexts[name];
  if (!context) throw new Error(`${name} did not initialise`);
  return context;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    "POST /api/email/send": async e => {
      const res = await postSend(post("/api/email/send", raw(e)));
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    },
    "POST /api/email/send-with-template": async ({ subject: _s, ...e }) => {
      const res = await postSendTemplate(
        post("/api/email/send-with-template", { ...e, template: "alert" })
      );
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    },
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

    it("refuses the key with a different message, through the Direct API and REST", async () => {
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
      const res = await postSend(
        post("/api/email/send", {
          to: A,
          subject: "Changed",
          html: "<p>x</p>",
          idempotencyKey: KEY,
        })
      );
      expect(res.status).toBe(409);
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

      await sweepSendClaims(t.adapter as never, 90 * day, Date.now());
      expect(await states()).toEqual(["failed", "sent"]);
      await sweepSendClaims(
        t.adapter as never,
        90 * day,
        Date.now() + CLAIM_TAKEOVER_MS + 1000
      );
      expect(await states()).toEqual(["sent"]);
      await sweepSendClaims(t.adapter as never, false, Date.now() + 91 * day);
      expect(await states()).toEqual(["sent"]);
      await sweepSendClaims(
        t.adapter as never,
        90 * day,
        Date.now() + 91 * day
      );
      expect(await states()).toEqual([]);
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
