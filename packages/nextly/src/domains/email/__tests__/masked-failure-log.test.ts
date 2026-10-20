/**
 * A failed send whose provider error quotes the recipient logs no full
 * address outside development and test.
 *
 * SMTP servers and email APIs commonly name the rejected address in their
 * error ("550 5.1.1 <john@example.com>: user unknown"), and the service logs
 * that error and its cause so the provider's diagnostic is not lost. Driven
 * through the real EmailService, a registered provider whose send rejects that
 * way, and the logger the service was given, so what is checked is what
 * reaches that logger, whatever logger an app supplied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../services/shared";
import { defineEmailProvider } from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";

const RECIPIENT = "john@example.com";
const TYPE = "bouncing-for-masking-test";

/** Every line the service wrote, as one searchable string. */
function captured(logger: Record<string, ReturnType<typeof vi.fn>>): string {
  return JSON.stringify(
    Object.values(logger).flatMap(fn => fn.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? { message: value.message, cause: value.cause, stack: value.stack }
        : value
  );
}

describe("a failed send that quotes the recipient", () => {
  let logger: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    getEmailProviderRegistry().reset();
    getEmailProviderRegistry().register(
      defineEmailProvider({
        type: TYPE,
        label: "Bouncing",
        configFields: [],
        parseConfig: input => input as Record<string, unknown>,
        createAdapter: () => ({
          send: () =>
            Promise.reject(
              new Error("Delivery refused", {
                cause: new Error(`550 5.1.1 <${RECIPIENT}>: user unknown`),
              })
            ),
        }),
      })
    );
  });

  afterEach(() => {
    getEmailProviderRegistry().reset();
    vi.unstubAllEnvs();
  });

  async function sendAndFail(): Promise<void> {
    const providerService = {
      getProviderDecrypted: vi.fn().mockResolvedValue({
        id: "provider-1",
        type: TYPE,
        configuration: {},
        fromEmail: "orders@shop.example",
        fromName: null,
        isActive: true,
      }),
    } as unknown as EmailProviderService;
    const service = new EmailService(
      {
        getDrizzle: () => ({}),
        dialect: "sqlite",
      } as unknown as DrizzleAdapter,
      logger as unknown as Logger,
      providerService,
      {} as EmailTemplateService,
      undefined,
      undefined
    );
    const result = await service.send({
      to: RECIPIENT,
      subject: "Your order",
      html: "<p>Thanks</p>",
      providerId: "provider-1",
    });
    expect(result.success).toBe(false);
  }

  it("logs the failure with the address masked in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await sendAndFail();
    const written = captured(logger);
    // The control: the failure was logged, and its diagnostic survived.
    expect(written).toContain("email.failed");
    expect(written).toContain("user unknown");
    expect(written).not.toContain(RECIPIENT);
    expect(written).toContain("j***@example.com");
  });

  it("logs the address whole in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await sendAndFail();
    expect(captured(logger)).toContain(RECIPIENT);
  });
});
