/**
 * One email to several `to` addresses, through every surface, on every
 * configured dialect.
 *
 * The Direct API, a plugin's `ctx.services.email` and both REST send routes
 * each send to a list of recipients through a capturing provider. Every
 * recipient is on the message the provider received, or on a message of their
 * own through a provider written to the one-`to` contract, and every recipient
 * has a delivery record. The send's From and Reply-To reach the message ahead
 * of the template's, which come ahead of the provider's.
 *
 * @module domains/email/__tests__/multi-recipient.integration.test
 */

// Read through the env proxy by the address digest: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

// The REST routes authenticate the caller and boot through the cached
// instance; the test instance below is the one booted, so both are stubbed
// and the routes run as written against it.
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
import type { EmailProviderAdapter } from "../types";

type SentOptions = Parameters<EmailProviderAdapter["send"]>[0];

const A = "a@example.com";
const B = "b@example.com";
const STAFF = "staff@example.com";

/** Every message a capturing provider was handed, in order. */
const messages: Array<{ provider: string; options: SentOptions }> = [];

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  messages.length = 0;
});

/** A provider that records what it is handed and accepts it. */
function capturing(type: string, maxToPerMessage?: number) {
  return defineEmailProvider<Record<string, never>>({
    type,
    label: type,
    configFields: [],
    parseConfig: () => ({}),
    createAdapter: () => ({
      ...(maxToPerMessage !== undefined ? { maxToPerMessage } : {}),
      send: async (options: SentOptions) => {
        messages.push({ provider: type, options });
        return { success: true, messageId: `captured-${messages.length}` };
      },
    }),
  });
}

const mailer = definePlugin({
  name: "mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      // Declares several `to` addresses, as the built-in API providers do.
      capturing("capturing-several", 10),
      // Written to the earlier contract: one `to` per message.
      capturing("capturing-one"),
    ],
  },
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect): Promise<{
  t: TestNextly;
  oneAtATime: string;
}> {
  const t = await createTestNextly({ dialect, plugins: [mailer] });
  current = t;
  if (!ctx) throw new Error("the plugin's init did not run");
  await t.nextly.emailProviders.create({
    data: {
      name: "Several",
      type: "capturing-several",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
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
  await t.nextly.emailTemplates.create({
    data: {
      name: "Alert",
      slug: "alert",
      subject: "Alert",
      htmlContent: "<p>alert</p>",
      fromOverride: "Template <template@example.com>",
      replyTo: "template-reply@example.com",
      isActive: true,
    },
  });
  return { t, oneAtATime: one.item.id };
}

function plugin(): PluginContext {
  if (!ctx) throw new Error("not booted");
  return ctx;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Envelope {
  to: string[];
  cc?: string[];
  from?: string;
  replyTo?: string;
  providerId?: string;
}

/**
 * One send per surface, each to the same envelope. Every one is the code a
 * caller would write, through the entry point that caller has.
 */
function surfaces(
  t: TestNextly
): Record<string, (e: Envelope) => Promise<unknown>> {
  return {
    "nextly.email.send": e =>
      t.nextly.email.send({ ...e, subject: "Hi", html: "<p>x</p>" }),
    "nextly.email.sendWithTemplate": e =>
      t.nextly.email.sendWithTemplate({ ...e, template: "alert" }),
    "ctx.services.email.send": e =>
      plugin().services.email.send({ ...e, subject: "Hi", html: "<p>x</p>" }),
    "ctx.services.email.sendWithTemplate": ({ to, ...options }) =>
      plugin().services.email.sendWithTemplate("alert", to, {}, options),
    "POST /api/email/send": async e => {
      const res = await postSend(
        post("/api/email/send", { ...e, subject: "Hi", html: "<p>x</p>" })
      );
      expect(res.status).toBe(200);
      return res.json();
    },
    "POST /api/email/send-with-template": async e => {
      const res = await postSendTemplate(
        post("/api/email/send-with-template", { ...e, template: "alert" })
      );
      expect(res.status).toBe(200);
      return res.json();
    },
  };
}

const SURFACES = Object.keys(
  surfaces({} as TestNextly)
) as ReadonlyArray<string>;

interface DeliveryRow {
  recipientHash: string;
  recipientKind: string;
  status: string;
}

describe.each(getConfiguredTestDialects())(
  "one email to several recipients (%s)",
  dialect => {
    it.each(SURFACES)(
      "%s sends one message to every recipient and records each",
      async surface => {
        const { t } = await boot(dialect);

        const result = await surfaces(t)[surface]({ to: [A, B], cc: [STAFF] });

        expect(result).toMatchObject({ success: true });
        expect(messages).toHaveLength(1);
        expect(messages[0].options).toMatchObject({
          to: A,
          toList: [A, B],
          cc: [STAFF],
        });
        const rows = await t.adapter.select<DeliveryRow>("email_deliveries");
        expect(
          rows
            .map(row => [row.recipientHash, row.recipientKind, row.status])
            .sort()
        ).toEqual(
          [
            [recipientDigest(A), "to", "sent"],
            [recipientDigest(B), "to", "sent"],
            [recipientDigest(STAFF), "cc", "sent"],
          ].sort()
        );
      },
      120_000
    );

    it.each(SURFACES)(
      "%s sends one message per recipient through a provider that takes one, copying the cc once",
      async surface => {
        const { t, oneAtATime } = await boot(dialect);

        await surfaces(t)[surface]({
          to: [A, B],
          cc: [STAFF],
          providerId: oneAtATime,
        });

        expect(
          messages.map(({ provider, options }) => [
            provider,
            options.to,
            options.cc,
          ])
        ).toEqual([
          ["capturing-one", A, [STAFF]],
          ["capturing-one", B, undefined],
        ]);
        expect(messages.some(({ options }) => "toList" in options)).toBe(false);
        const rows = await t.adapter.select<DeliveryRow>("email_deliveries");
        expect(rows).toHaveLength(3);
      },
      120_000
    );

    it.each(SURFACES)(
      "%s uses the send's from and replyTo",
      async surface => {
        const { t } = await boot(dialect);

        await surfaces(t)[surface]({
          to: [A],
          from: "Send <send@example.com>",
          replyTo: "send-reply@example.com",
        });

        expect(messages[0].options).toMatchObject({
          from: "Send <send@example.com>",
          replyTo: "send-reply@example.com",
        });
      },
      120_000
    );

    it.each(SURFACES.filter(name => name.includes("emplate")))(
      "%s falls back to the template's from and replyTo, ahead of the provider's",
      async surface => {
        const { t } = await boot(dialect);

        await surfaces(t)[surface]({ to: [A] });

        expect(messages[0].options).toMatchObject({
          from: "Template <template@example.com>",
          replyTo: "template-reply@example.com",
        });
      },
      120_000
    );

    it.each(SURFACES.filter(name => !name.includes("emplate")))(
      "%s falls back to the provider's from with no replyTo",
      async surface => {
        const { t } = await boot(dialect);

        await surfaces(t)[surface]({ to: [A] });

        expect(messages[0].options.from).toBe("provider@example.com");
        expect(messages[0].options.replyTo).toBeUndefined();
      },
      120_000
    );
  }
);
