/**
 * `canSendTemplate` must answer with the provider the send would actually use.
 *
 * `sendWithTemplate` prefers the template's own `providerId` over the default,
 * so asking "is any provider configured" is the wrong question for a caller
 * about to send one specific template — and answering it wrongly refuses work
 * that would have succeeded.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import type { EmailProviderService } from "../email-provider-service";
import { EmailService } from "../email-service";
import type { EmailTemplateService } from "../email-template-service";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const adapter = {
  getDb: () => ({}),
  getCapabilities: () => ({ dialect: "postgresql" }),
} as unknown as DrizzleAdapter;

const providerRecord = {
  id: "p-specific",
  type: "smtp",
  fromEmail: "no-reply@example.com",
  fromName: "Example",
  isActive: true,
  config: {},
};

function buildService(opts: {
  defaultProvider?: unknown;
  templateProviderId?: string | null;
  templateActive?: boolean;
  templateThrows?: boolean;
}) {
  const providerService = {
    getDefaultProviderDecrypted: vi
      .fn()
      .mockResolvedValue(opts.defaultProvider ?? null),
    getProviderDecrypted: vi.fn().mockResolvedValue(providerRecord),
  } as unknown as EmailProviderService;

  const templateService = {
    getTemplateBySlug: opts.templateThrows
      ? vi.fn().mockRejectedValue(new Error("db not ready"))
      : vi.fn().mockResolvedValue(
          opts.templateProviderId === undefined
            ? null
            : {
                slug: "email-verification",
                isActive: opts.templateActive ?? true,
                providerId: opts.templateProviderId,
              }
        ),
  } as unknown as EmailTemplateService;

  const service = new EmailService(
    adapter,
    logger,
    providerService,
    templateService
  );

  // The adapter is never built in these tests — only provider resolution is
  // under test, and resolution succeeding is the whole answer.
  vi.spyOn(
    service as unknown as { createAdapterFromRecord: () => unknown },
    "createAdapterFromRecord"
  ).mockReturnValue({ send: vi.fn() });

  return { service, providerService, templateService };
}

describe("canSendTemplate", () => {
  it("says yes when the template names a provider and there is no default", async () => {
    // The case the preflight used to get wrong: `isConfigured()` looks only at
    // the default, so this install was refused a user it could have created.
    const { service, providerService } = buildService({
      defaultProvider: null,
      templateProviderId: "p-specific",
    });

    await expect(service.canSendTemplate("email-verification")).resolves.toBe(
      true
    );
    expect(providerService.getProviderDecrypted).toHaveBeenCalledWith(
      "p-specific"
    );
  });

  it("says no when nothing is configured at all", async () => {
    const { service } = buildService({
      defaultProvider: null,
      templateProviderId: null,
    });

    await expect(service.canSendTemplate("email-verification")).resolves.toBe(
      false
    );
  });

  it("falls back to the default when the template names no provider", async () => {
    const { service, providerService } = buildService({
      defaultProvider: providerRecord,
      templateProviderId: null,
    });

    await expect(service.canSendTemplate("email-verification")).resolves.toBe(
      true
    );
    expect(providerService.getProviderDecrypted).not.toHaveBeenCalled();
  });

  it("ignores an inactive template's provider, as the send does", async () => {
    const { service, providerService } = buildService({
      defaultProvider: null,
      templateProviderId: "p-specific",
      templateActive: false,
    });

    await expect(service.canSendTemplate("email-verification")).resolves.toBe(
      false
    );
    expect(providerService.getProviderDecrypted).not.toHaveBeenCalled();
  });

  it("falls back to the default when the template cannot be read", async () => {
    const { service } = buildService({
      defaultProvider: providerRecord,
      templateThrows: true,
    });

    await expect(service.canSendTemplate("email-verification")).resolves.toBe(
      true
    );
  });
});
