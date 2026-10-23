/**
 * Every surface a caller sends through reports a failed send's kind: whether a
 * retry can help, the provider's status where it gave one, and a short reason
 * free of configuration and secrets. The plugin service, the Direct API and
 * both REST send routes each read the same outcome from the email service.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors";
import {
  FilterSeams,
  getFilterRegistry,
  resetFilterRegistry,
} from "../../../filters";
import { methodFacade } from "../../../plugins/service-facade";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../shared/types";
import { withEmailFailure } from "../failure";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { renderTemplate } from "../services/render-template";
import { createSendLayerProvider } from "../services/providers/sendlayer-provider";
import type { EmailProviderAdapter } from "../types";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const containerGet = vi.hoisted(() => vi.fn());
vi.mock("../../../di", () => ({ container: { get: containerGet } }));

import type { NextlyContext } from "../../../direct-api/namespaces/context";
import { createEmailNamespace } from "../../../direct-api/namespaces/email";

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const TEMPLATE = {
  id: "t-1",
  name: "Alert",
  slug: "alert",
  subject: "Alert",
  htmlContent: "<p>alert</p>",
  plainTextContent: null,
  variables: null,
  useLayout: false,
  isActive: true,
  providerId: null,
  attachments: null,
  preheader: null,
  kind: "template",
  format: "code",
  blocks: null,
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  cc: null,
  bcc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  owner: { kind: "site" },
  carriesSecret: false,
  overridden: false,
  ownerChanged: false,
  setInCode: false,
} satisfies EmailTemplateRecord;

/** A service that sends through `adapter`, and every surface over it. */
function build(
  adapter: EmailProviderAdapter,
  recordAll: (rows: unknown[]) => Promise<void> = async () => {}
) {
  const service = new EmailService(
    {} as DrizzleAdapter,
    logger,
    {
      getProviderDecrypted: vi.fn(),
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
        id: "p1",
        type: "resend",
        fromEmail: "no-reply@test.local",
        fromName: null,
        configuration: { apiKey: "k" },
        isActive: true,
      }),
    } as unknown as EmailProviderService,
    {
      getTemplateBySlug: vi.fn().mockResolvedValue(TEMPLATE),
      resolveForSend: vi
        .fn()
        .mockResolvedValue({ template: TEMPLATE, preferCode: false }),
      renderStored: (
        template: Parameters<typeof renderTemplate>[0],
        data: Record<string, unknown>
      ) =>
        Promise.resolve(
          renderTemplate(template, null, data, { appName: "Nextly" })
        ),
      getLayout: vi.fn(),
    } as unknown as EmailTemplateService,
    undefined,
    undefined,
    { recordAll: vi.fn(recordAll) } as never
  );
  (service as unknown as { createAdapterFromRecord: unknown })[
    "createAdapterFromRecord"
  ] = () => adapter;
  containerGet.mockReturnValue(service);
  return {
    service,
    plugin: methodFacade(service, ["send", "sendWithTemplate"] as const),
    direct: createEmailNamespace({
      emailSendService: service,
    } as unknown as NextlyContext),
  };
}

const REFUSED = {
  retryable: false,
  status: 422,
  reason: "The email provider refused the message (status 422).",
};

/** An adapter that refuses every message, classified. */
function refusing(): EmailProviderAdapter {
  return {
    send: () =>
      Promise.reject(withEmailFailure(new Error("HTTP 422: bad"), REFUSED)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFilterRegistry();
});

describe("every surface reports a failed send's kind", () => {
  const message = { to: "a@example.com", subject: "Hi", html: "<p>x</p>" };

  it("ctx.services.email.send and sendWithTemplate", async () => {
    const { plugin } = build(refusing());

    expect(await plugin.send(message)).toEqual({
      success: false,
      failure: REFUSED,
    });
    expect(await plugin.sendWithTemplate("alert", "a@example.com", {})).toEqual(
      { success: false, failure: REFUSED }
    );
  });

  it("nextly.email.send and sendWithTemplate, with error as the reason", async () => {
    const { direct } = build(refusing());
    const expected = {
      success: false,
      messageId: undefined,
      error: REFUSED.reason,
      failure: REFUSED,
    };

    expect(await direct.send(message)).toEqual(expected);
    expect(
      await direct.sendWithTemplate({ to: "a@example.com", template: "alert" })
    ).toEqual(expected);
  });

  it("reports a plain thrown error as retryable", async () => {
    const { plugin } = build({
      send: () => Promise.reject(new Error("socket hang up")),
    });

    expect((await plugin.send(message)).failure).toEqual({
      retryable: true,
      reason: "The email provider failed.",
    });
  });

  it("keeps the classification through a registered provider, its secret taken out", async () => {
    // A contributed provider is wrapped so a credential cannot leave through
    // its errors; the classification crosses that wrapper, contained.
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "classifying-mailer",
      label: "Classifying",
      configFields: [
        {
          name: "apiKey",
          label: "API key",
          kind: "password",
          required: true,
          secret: true,
        },
      ],
      parseConfig: input => input as { apiKey: string },
      createAdapter: config => ({
        send: () =>
          Promise.reject(
            withEmailFailure(new Error(`rejected key ${config.apiKey}`), {
              retryable: false,
              status: 401,
              reason: `The key ${config.apiKey} was refused.`,
            })
          ),
      }),
    });
    const adapter = provider.createAdapterFrom({
      apiKey: "sk_live_very_secret_value",
    });
    const { plugin } = build(adapter);

    const result = await plugin.send(message);

    expect(result.failure).toMatchObject({ retryable: false, status: 401 });
    expect(JSON.stringify(result)).not.toContain("sk_live_very_secret_value");
  });
});

describe("what a provider's own answer may and may not carry", () => {
  const message = { to: "a@example.com", subject: "Hi", html: "<p>x</p>" };

  it("reports a refused to's own classification, even when the provider also said it did not send", async () => {
    // The result's failure and its refused entry describe the same refusal.
    const { plugin } = build({
      send: () =>
        Promise.resolve({
          success: false,
          rejected: ["a@example.com"],
          refusals: [
            { address: "a@example.com", retryable: false, status: 550 },
          ],
        }),
    });

    const result = await plugin.send(message);

    expect(result.failure).toMatchObject({ retryable: false, status: 550 });
    expect(result.refused).toEqual([
      { kind: "to", position: 0, retryable: false, status: 550 },
    ]);
  });

  it("reads a malformed refusals entry as no classification, never throwing", async () => {
    const { plugin } = build({
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "m-1",
          rejected: ["a@example.com"],
          refusals: [null, { retryable: false }, { address: 7 }] as never,
        }),
    });

    const result = await plugin.send(message);

    // The refused primary recipient is still reported, as retryable.
    expect(result.success).toBe(false);
    expect(result.failure).toMatchObject({ retryable: true });
  });

  it("counts a refusal's position on its line as the send gave it, duplicates included", async () => {
    const { plugin } = build({
      maxToPerMessage: 10,
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "m-1",
          rejected: ["bad@example.com"],
        }),
    });

    const result = await plugin.send({
      ...message,
      cc: ["x@example.com", "x@example.com", "bad@example.com"],
    });

    expect(result.refused).toEqual([
      { kind: "cc", position: 2, retryable: true },
    ]);
  });

  it("reports a registered provider's accepted message as sent, whatever it put in refusals", async () => {
    // Read after the provider answered: a throw there would report a message
    // it took as failed and retryable, and a retry would send it twice.
    for (const refusals of [{ length: 1 }, [null, 7], "x"]) {
      const provider = defineEmailProvider<{ apiKey: string }>({
        type: "odd-mailer",
        label: "Odd",
        configFields: [
          {
            name: "apiKey",
            label: "API key",
            kind: "password",
            required: true,
            secret: true,
          },
        ],
        parseConfig: input => input as { apiKey: string },
        createAdapter: () => ({
          send: () =>
            Promise.resolve({
              success: true,
              messageId: "m-1",
              refusals: refusals as never,
            }),
        }),
      });
      const { plugin } = build(
        provider.createAdapterFrom({ apiKey: "sk_live_long_enough_value" })
      );

      expect(await plugin.send(message)).toEqual({
        success: true,
        messageId: "m-1",
      });
    }
  });

  it("never reports a number that is not a status", async () => {
    const { plugin } = build({
      send: () =>
        Promise.reject(
          withEmailFailure(new Error("x"), {
            retryable: false,
            status: 987654321,
            reason: "The email provider refused the message.",
          })
        ),
    });

    expect((await plugin.send(message)).failure).toEqual({
      retryable: false,
      reason: "The email provider refused the message.",
    });
  });

  it("withholds a status that could be a provider's declared credential", async () => {
    // A credential too short to compare could be any number, so no status
    // from this provider is passed on.
    const provider = defineEmailProvider<{ pin: string }>({
      type: "pin-mailer",
      label: "PIN",
      configFields: [
        {
          name: "pin",
          label: "PIN",
          kind: "password",
          required: true,
          secret: true,
        },
      ],
      parseConfig: input => input as { pin: string },
      createAdapter: config => ({
        send: () =>
          Promise.reject(
            withEmailFailure(new Error("refused"), {
              retryable: false,
              status: Number(config.pin),
              reason: "The email provider refused the message.",
            })
          ),
      }),
    });
    const { plugin } = build(provider.createAdapterFrom({ pin: "451" }));

    const result = await plugin.send(message);

    expect(result.failure).toEqual({
      retryable: false,
      reason: "The email provider refused the message.",
    });
    expect(JSON.stringify(result)).not.toContain("451");
  });

  it("withholds such a status from a refusal that gave no reason", async () => {
    const provider = defineEmailProvider<{ pin: string }>({
      type: "pin-refuser",
      label: "PIN",
      configFields: [
        {
          name: "pin",
          label: "PIN",
          kind: "password",
          required: true,
          secret: true,
        },
      ],
      parseConfig: input => input as { pin: string },
      createAdapter: config => ({
        send: () =>
          Promise.resolve({
            success: true,
            messageId: "m-1",
            rejected: ["a@example.com"],
            refusals: [
              {
                address: "a@example.com",
                retryable: false,
                status: Number(config.pin),
              },
            ],
          }),
      }),
    });
    const { plugin } = build(provider.createAdapterFrom({ pin: "451" }));

    const result = await plugin.send(message);

    expect(result.failure).toEqual({
      retryable: false,
      reason: "The email provider refused the message.",
    });
    expect(result.refused).toEqual([
      { kind: "to", position: 0, retryable: false },
    ]);
    expect(JSON.stringify(result)).not.toContain("451");
  });

  it("is retryable when any refused to recipient can still be sent to", async () => {
    // A permanent refusal first, then a temporary one: the send can still
    // reach the second recipient, so a caller must be told to retry.
    const { plugin } = build({
      maxToPerMessage: 10,
      send: () =>
        Promise.resolve({
          success: true,
          messageId: "m-1",
          rejected: ["a@example.com", "b@example.com"],
          refusals: [
            { address: "a@example.com", retryable: false, status: 550 },
            { address: "b@example.com", retryable: true, status: 450 },
          ],
        }),
    });

    const result = await plugin.send({
      ...message,
      to: ["a@example.com", "b@example.com"],
    });

    expect(result.success).toBe(false);
    expect(result.failure).toEqual({
      retryable: true,
      status: 450,
      reason:
        "The email provider could not take the message right now (status 450).",
    });
  });

  it.each([
    [
      "a refusal described as unreachable",
      {
        retryable: false,
        reason: "The email provider could not be reached.",
      },
      {
        retryable: false,
        reason: "The email provider refused the message.",
      },
    ],
    [
      "a sentence naming another status",
      {
        retryable: false,
        status: 401,
        reason: "The email provider refused the message (status 500).",
      },
      {
        retryable: false,
        status: 401,
        reason: "The email provider refused the message (status 401).",
      },
    ],
  ])(
    "replaces %s with the sentence its fields give",
    async (_case, given, reported) => {
      const { plugin } = build({
        send: () =>
          Promise.reject(withEmailFailure(new Error("x"), given as never)),
      });

      expect((await plugin.send(message)).failure).toEqual(reported);
    }
  );
});

describe("what the send path carried over from the recipient work", () => {
  const message = { to: "a@example.com", subject: "Hi", html: "<p>x</p>" };

  it("refuses a Reply-To with a line break, the caller's or a filter's", async () => {
    // A Reply-To becomes a header; a line break would let it add another.
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-1" });
    const { service } = build({ send });

    await expect(
      service.send({
        ...message,
        replyTo: "help@example.com\r\nBcc: attacker@example.com",
      })
    ).rejects.toBeInstanceOf(NextlyError);

    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: object) => ({
        ...payload,
        replyTo: "help@example.com\nBcc: attacker@example.com",
      })
    );
    await expect(
      service.send({ ...message, replyTo: "help@example.com" })
    ).rejects.toBeInstanceOf(NextlyError);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a split send's retryable failure whole, status and reason with it", async () => {
    // The first message is refused for good, the second can be retried: the
    // send is retryable, and every field of its failure describes the
    // retryable one.
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockRejectedValueOnce(
        withEmailFailure(new Error("550"), {
          retryable: false,
          status: 550,
          reason: "The email provider refused the message (status 550).",
        })
      )
      .mockRejectedValueOnce(
        withEmailFailure(new Error("421"), {
          retryable: true,
          status: 421,
          reason:
            "The email provider could not take the message right now (status 421).",
        })
      );
    const { service } = build({ send });

    const result = await service.send({
      ...message,
      to: ["a@example.com", "b@example.com"],
    });

    expect(result.failure).toEqual({
      retryable: true,
      status: 421,
      reason:
        "The email provider could not take the message right now (status 421).",
    });
  });

  it("passes any other Reply-To through to the provider, as before", async () => {
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-1" });
    const { service } = build({ send });

    await service.send({ ...message, replyTo: "not-an-address" });

    expect(send.mock.calls[0][0].replyTo).toBe("not-an-address");
  });

  it("still sends with an empty Reply-To, or one naming several", async () => {
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-1" });
    const { service } = build({ send });

    await service.send({ ...message, replyTo: "" });
    await service.send({
      ...message,
      replyTo: "help@example.com, sales@example.com",
    });

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends a split send's later messages when the recorder and logger fail on an earlier one", async () => {
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockRejectedValueOnce(new Error("first refused"))
      .mockResolvedValue({ success: true, messageId: "m-2" });
    const { service } = build({ send }, async () => {
      throw new Error("database down");
    });
    vi.mocked(logger.error).mockImplementationOnce(() => {
      throw new Error("log transport down");
    });

    const result = await service.send({
      ...message,
      to: ["a@example.com", "b@example.com"],
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      failure: { retryable: true },
    });
  });

  it("splits a SendLayer display name with a quoted < into name and mailbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ MessageID: "m-1" }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const { service } = build(createSendLayerProvider({ apiKey: "sl" }));

      await service.send({ ...message, to: '"A < B" <ab@example.com>' });

      const body = JSON.parse(
        String((fetchMock.mock.calls[0][1] as RequestInit).body)
      ) as { To: unknown };
      expect(body.To).toEqual([{ name: '"A < B"', email: "ab@example.com" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
