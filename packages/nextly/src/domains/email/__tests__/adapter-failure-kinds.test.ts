/**
 * The SMTP and SendLayer adapters classify their failures as Resend's does: a
 * refusal of the message itself is not retryable; a timeout, rate limit,
 * server error, temporary SMTP reply or network failure is. An SMTP server
 * that takes a message but refuses one `RCPT TO` is reported per recipient,
 * classified, in the result and on the delivery records.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetFilterRegistry } from "../../../filters";
import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { createSendLayerProvider } from "../services/providers/sendlayer-provider";
import { createSmtpProvider } from "../services/providers/smtp-provider";
import type { EmailProviderAdapter } from "../types";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const mockSendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

const MESSAGE = {
  to: "recipient@example.com",
  from: "App <noreply@example.com>",
  subject: "Hello",
  html: "<p>Hello</p>",
};

const smtp = () =>
  createSmtpProvider({
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "u", pass: "p" },
  });

async function failureOfSend(adapter: EmailProviderAdapter): Promise<unknown> {
  const thrown = await adapter.send(MESSAGE).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(Error);
  return (thrown as { emailFailure?: unknown }).emailFailure;
}

/** An error as nodemailer throws it, with its SMTP reply code or its code. */
function smtpError(fields: { responseCode?: number; code?: string }) {
  return Object.assign(new Error("smtp said no"), fields);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFilterRegistry();
});

describe("SMTP failures", () => {
  it.each([550, 553, 554])(
    "are not retryable on a %i reply, which refuses the message",
    async responseCode => {
      mockSendMail.mockRejectedValueOnce(smtpError({ responseCode }));
      expect(await failureOfSend(smtp())).toMatchObject({
        retryable: false,
        status: responseCode,
      });
    }
  );

  it.each([421, 450, 451, 452])(
    "are retryable on a %i reply, which is temporary",
    async responseCode => {
      mockSendMail.mockRejectedValueOnce(smtpError({ responseCode }));
      expect(await failureOfSend(smtp())).toMatchObject({
        retryable: true,
        status: responseCode,
      });
    }
  );

  it.each(["ECONNECTION", "ETIMEDOUT", "ESOCKET"])(
    "are retryable when the connection fails (%s)",
    async code => {
      mockSendMail.mockRejectedValueOnce(smtpError({ code }));
      expect(await failureOfSend(smtp())).toEqual({
        retryable: true,
        reason: "The email provider could not be reached.",
      });
    }
  );

  it("keep the error's message as it was", async () => {
    mockSendMail.mockRejectedValueOnce(smtpError({ responseCode: 550 }));
    await expect(smtp().send(MESSAGE)).rejects.toThrow(
      "SMTP provider error: smtp said no"
    );
  });
});

describe("SendLayer failures", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function answering(status: number) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: "Error",
      text: async () => '{"Errors":[{"Code":20}]}',
    }) as unknown as typeof fetch;
  }

  const sendlayer = () => createSendLayerProvider({ apiKey: "sl_test" });

  it.each([400, 401, 422])("are not retryable on a %i", async status => {
    answering(status);
    expect(await failureOfSend(sendlayer())).toMatchObject({
      retryable: false,
      status,
    });
  });

  it.each([408, 429, 500, 503])("are retryable on a %i", async status => {
    answering(status);
    expect(await failureOfSend(sendlayer())).toMatchObject({
      retryable: true,
      status,
    });
  });

  it("are retryable when SendLayer cannot be reached", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("fetch failed")
      ) as unknown as typeof fetch;
    expect(await failureOfSend(sendlayer())).toMatchObject({ retryable: true });
  });
});

describe("an SMTP server refusing one RCPT TO", () => {
  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  function build(adapter: EmailProviderAdapter) {
    const recorded: Array<Record<string, unknown>> = [];
    const service = new EmailService(
      {} as DrizzleAdapter,
      logger,
      {
        getProviderDecrypted: vi.fn(),
        getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
          id: "p1",
          type: "smtp",
          fromEmail: "no-reply@test.local",
          fromName: null,
          configuration: {},
          isActive: true,
        }),
      } as unknown as EmailProviderService,
      { getTemplateBySlug: vi.fn() } as unknown as EmailTemplateService,
      undefined,
      undefined,
      {
        recordAll: vi.fn(async (rows: Array<Record<string, unknown>>) => {
          recorded.push(...rows);
        }),
      } as never
    );
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => adapter;
    return { service, recorded };
  }

  it("says which recipient was refused, classified, in the result and on its record", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "<m@mail.test>",
      rejected: ["temp@example.com", "gone@example.com"],
      rejectedErrors: [
        Object.assign(new Error("try later"), {
          recipient: "temp@example.com",
          responseCode: 450,
        }),
        Object.assign(new Error("no such user"), {
          recipient: "gone@example.com",
          responseCode: 550,
        }),
      ],
    });
    const { service, recorded } = build(smtp());

    const result = await service.send({
      to: ["ok@example.com", "temp@example.com"],
      cc: ["gone@example.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    // Not delivered to every `to`, and why, from the refused `to` itself.
    expect(result.success).toBe(false);
    expect(result.failure).toMatchObject({ retryable: true, status: 450 });
    expect(result.refused).toEqual([
      { kind: "to", position: 1, retryable: true, status: 450 },
      { kind: "cc", position: 0, retryable: false, status: 550 },
    ]);
    // No address in the result: a refusal is named by line and position.
    expect(JSON.stringify(result)).not.toMatch(/@example\.com/);
    expect(recorded.map(row => [row.to, row.status, row.error])).toEqual([
      ["ok@example.com", "sent", null],
      [
        "temp@example.com",
        "failed",
        "Recipient refused by the provider (retryable, 450)",
      ],
      [
        "gone@example.com",
        "failed",
        "Recipient refused by the provider (not retryable, 550)",
      ],
    ]);
  });
});
