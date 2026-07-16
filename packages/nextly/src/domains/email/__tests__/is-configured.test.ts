/**
 * EmailService.isConfigured — asking whether mail works, without trying.
 *
 * `resolveProvider` throws when nothing is configured, so the only way to find
 * out used to be to attempt a send and catch the failure. A caught failure is
 * one nobody sees: creating a user whose only way in arrives by email did
 * exactly that, and answered "User created." to an admin whose site could not
 * send mail. Knowing before the user exists is the point.
 */
import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../services/shared";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const adapter = {
  getDrizzle: () => ({}),
  dialect: "sqlite",
} as unknown as DrizzleAdapter;

const templateService = {
  getTemplateBySlug: vi.fn(),
  getLayout: vi.fn(),
} as unknown as EmailTemplateService;

/** An EmailService whose provider lookup finds `provider`, or nothing. */
function serviceWith(provider: unknown) {
  // The decrypted variants are what resolveProvider actually calls.
  const providerService = {
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue(provider),
    getProviderDecrypted: vi.fn().mockResolvedValue(provider),
  } as unknown as EmailProviderService;

  return new EmailService(
    adapter,
    logger,
    providerService,
    templateService,
    undefined,
    undefined
  );
}

const A_PROVIDER = {
  id: "p1",
  type: "resend",
  fromEmail: "no-reply@test.local",
  fromName: null,
  configuration: { apiKey: "k" },
  isActive: true,
};

describe("isConfigured", () => {
  it("is true when a provider is set up", async () => {
    await expect(serviceWith(A_PROVIDER).isConfigured()).resolves.toBe(true);
  });

  it("is false when none is, rather than throwing", async () => {
    const service = serviceWith(null);

    // The distinction that matters: a caller asking "can I send?" gets an
    // answer, not an exception it has to catch and then decide about.
    await expect(service.isConfigured()).resolves.toBe(false);
  });

  it("does not send anything to find out", async () => {
    const providerService = {
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue(A_PROVIDER),
    } as unknown as EmailProviderService;
    const service = new EmailService(
      adapter,
      logger,
      providerService,
      templateService,
      undefined,
      undefined
    );
    const send = vi.fn();
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => ({ send });

    await service.isConfigured();

    expect(send).not.toHaveBeenCalled();
  });
});
