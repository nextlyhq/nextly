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
vi.mock("../../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../auth/middleware", () => ({
  requireAuthentication: vi.fn().mockResolvedValue({ userId: "user-1" }),
  isErrorResponse: vi.fn().mockReturnValue(false),
}));

import { POST as postSend } from "../../../api/email-send";
import { POST as postSendTemplate } from "../../../api/email-send-template";
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
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
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

function post(body: unknown): Request {
  return new Request("http://x/api/email", {
    method: "POST",
    body: JSON.stringify(body),
  });
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

  it("POST /api/email/send and /send-with-template", async () => {
    build(refusing());

    const sent = await (await postSend(post(message))).json();
    const templated = await (
      await postSendTemplate(post({ to: "a@example.com", template: "alert" }))
    ).json();

    expect(sent).toEqual({
      message: "Email could not be sent.",
      success: false,
      failure: REFUSED,
    });
    expect(templated).toMatchObject({ success: false, failure: REFUSED });
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

describe("what the send path carried over from the recipient work", () => {
  const message = { to: "a@example.com", subject: "Hi", html: "<p>x</p>" };

  it("accepts a comma-joined to on the REST routes, as the service does", async () => {
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-1" });
    build({ maxToPerMessage: 10, send });

    const res = await postSend(
      post({ ...message, to: "a@example.com, b@example.com" })
    );

    expect(res.status).toBe(200);
    expect(send.mock.calls[0][0].toList).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("refuses a Reply-To that is not an address, the caller's or a filter's", async () => {
    const send = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-1" });
    const { service } = build({ send });

    await expect(
      service.send({ ...message, replyTo: "not-an-address" })
    ).rejects.toBeInstanceOf(NextlyError);

    getFilterRegistry().addFilter(
      FilterSeams.EmailBeforeSend,
      (payload: object) => ({ ...payload, replyTo: "also not one" })
    );
    await expect(
      service.send({ ...message, replyTo: "help@example.com" })
    ).rejects.toBeInstanceOf(NextlyError);
    expect(send).not.toHaveBeenCalled();
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
