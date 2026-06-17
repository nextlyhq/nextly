/**
 * EmailService.sendWithTemplate — cc/bcc forwarding.
 *
 * The DB-template path already forwarded cc/bcc to the provider adapter; the
 * code-first template fallback path dropped them. Both paths are asserted here.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import type { EmailProviderAdapter } from "../types";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeAdapter(): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => ({}) as never,
    getCapabilities: () => ({ dialect: "sqlite" as const }) as never,
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
  } as unknown as DrizzleAdapter;
}

function makeProviderService(): EmailProviderService {
  return {
    getProviderDecrypted: vi.fn(),
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
      id: "p1",
      type: "resend",
      fromEmail: "no-reply@test.local",
      fromName: null,
      configuration: { apiKey: "k" },
      isActive: true,
    }),
  } as unknown as EmailProviderService;
}

const cc = ["cc@example.com"];
const bcc = ["bcc@example.com"];

describe("EmailService.sendWithTemplate — cc/bcc forwarding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards cc/bcc to the provider for a DB template", async () => {
    const adapterSend = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-db" });
    const providerAdapter: EmailProviderAdapter = { send: adapterSend };

    const templateRecord = {
      id: "t-1",
      name: "Welcome",
      slug: "welcome",
      subject: "Welcome {{name}}",
      htmlContent: "<p>hi</p>",
      plainTextContent: null,
      variables: null,
      useLayout: false,
      isActive: true,
      providerId: null,
      attachments: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies EmailTemplateRecord;

    const templateService = {
      getTemplateBySlug: vi.fn().mockResolvedValue(templateRecord),
      getLayout: vi.fn(),
    } as unknown as EmailTemplateService;

    const service = new EmailService(
      makeAdapter(),
      logger,
      makeProviderService(),
      templateService
    );
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => providerAdapter;

    await service.sendWithTemplate(
      "welcome",
      "u@e.com",
      { name: "Dev" },
      {
        cc,
        bcc,
      }
    );

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({ cc, bcc })
    );
  });

  it("forwards cc/bcc to the provider for a code-first template", async () => {
    const adapterSend = vi
      .fn<EmailProviderAdapter["send"]>()
      .mockResolvedValue({ success: true, messageId: "m-cf" });
    const providerAdapter: EmailProviderAdapter = { send: adapterSend };

    // DB lookup returns null so sendWithTemplate falls through to code-first.
    const templateService = {
      getTemplateBySlug: vi.fn().mockResolvedValue(null),
      getLayout: vi.fn(),
    } as unknown as EmailTemplateService;

    const emailConfig = {
      from: "no-reply@test.local",
      providerConfig: { provider: "resend" as const, apiKey: "k" },
      templates: {
        welcome: () => ({ subject: "Welcome!", html: "<p>hi</p>" }),
      },
    };

    const service = new EmailService(
      makeAdapter(),
      logger,
      makeProviderService(),
      templateService,
      emailConfig
    );
    (service as unknown as { createAdapterFromRecord: unknown })[
      "createAdapterFromRecord"
    ] = () => providerAdapter;

    await service.sendWithTemplate(
      "welcome",
      "u@e.com",
      { userName: "Dev" },
      {
        cc,
        bcc,
      }
    );

    expect(adapterSend).toHaveBeenCalledWith(
      expect.objectContaining({ cc, bcc })
    );
  });
});
