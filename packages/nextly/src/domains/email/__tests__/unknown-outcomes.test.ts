/**
 * A provider call that may have reached the provider but brought back no
 * definite answer is reported as unknown, on every built-in adapter; one that
 * never reached it is reported as before, with no such mark.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createResendProvider } from "../services/providers/resend-provider";
import { createSendLayerProvider } from "../services/providers/sendlayer-provider";
import { createSmtpProvider } from "../services/providers/smtp-provider";
import type { EmailProviderAdapter } from "../types";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
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

const LOST = {
  retryable: true,
  reason: "The email provider's answer was lost.",
  unknown: true,
};
const UNREACHABLE = {
  retryable: true,
  reason: "The email provider could not be reached.",
};

async function failureOf(adapter: EmailProviderAdapter): Promise<unknown> {
  const thrown = await adapter.send(MESSAGE).then(
    () => undefined,
    (error: unknown) => error
  );
  return (thrown as { emailFailure?: unknown }).emailFailure;
}

/** A `fetch` rejection as undici gives it, with its cause's code. */
function fetchError(code?: string): Error {
  return Object.assign(new TypeError("fetch failed"), {
    ...(code ? { cause: Object.assign(new Error(code), { code }) } : {}),
  });
}

const http: Array<[string, () => EmailProviderAdapter]> = [
  ["Resend", () => createResendProvider({ apiKey: "re_test" })],
  ["SendLayer", () => createSendLayerProvider({ apiKey: "sl_test" })],
];

describe.each(http)("%s", (_name, adapter) => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const rejecting = (error: unknown) => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(error) as unknown as typeof fetch;
  };

  it.each(["ECONNRESET", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"])(
    "reports a request whose answer was lost (%s) as unknown",
    async code => {
      rejecting(fetchError(code));
      expect(await failureOf(adapter())).toEqual(LOST);
    }
  );

  it("reports a request cancelled at its deadline as unknown", async () => {
    rejecting(
      Object.assign(new Error("This operation was aborted"), {
        name: "AbortError",
      })
    );
    expect(await failureOf(adapter())).toEqual(LOST);
  });

  it.each([undefined, "ECONNREFUSED", "ENOTFOUND"])(
    "reports a provider that could not be reached (%s) as before, not unknown",
    async code => {
      rejecting(fetchError(code));
      expect(await failureOf(adapter())).toEqual(UNREACHABLE);
    }
  );
});

describe("SMTP", () => {
  const smtp = () =>
    createSmtpProvider({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
    });

  it.each(["ETIMEDOUT", "ESOCKET", "ECONNRESET"])(
    "reports a connection lost during DATA (%s) as unknown",
    async code => {
      mockSendMail.mockRejectedValueOnce(
        Object.assign(new Error("lost"), { code, command: "DATA" })
      );
      expect(await failureOf(smtp())).toEqual(LOST);
    }
  );

  it.each(["CONN", "EHLO", "RCPT TO"])(
    "reports a connection lost before DATA (%s) as before, not unknown",
    async command => {
      mockSendMail.mockRejectedValueOnce(
        Object.assign(new Error("lost"), { code: "ETIMEDOUT", command })
      );
      expect(await failureOf(smtp())).toEqual(UNREACHABLE);
    }
  );
});
